import { NextRequest } from "next/server";
import { broadcastNotification, notifyUser } from "@/lib/sse/utils";
import { getSession } from "@/features/auth";
import { createServiceContext } from "@/utils/service-utils";

const { log, handleError } = createServiceContext("SSETestRoute");

export async function POST(request: NextRequest) {
  try {
    // Get session but don't require authentication for testing
    const session = await getSession();
    const isAuthenticated = !!session?.user;
    const userId = session?.user?.id;

    const body = await request.json();
    const { eventType, data, target } = body;

    if (!eventType || !data) {
      return new Response(
        JSON.stringify({ error: "eventType and data are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let result;

    // Determine how to send the notification
    if (target?.userId && isAuthenticated) {
      // Send to specific user (only if requester is authenticated)
      result = await notifyUser(target.userId, eventType, data);
      log.info(`Test notification sent to user ${target.userId}`, {
        eventType,
        result,
        requesterId: userId,
      });
    } else {
      // Broadcast to all connected clients (works for both auth states)
      result = await broadcastNotification(eventType, {
        ...data,
        // Add context about who sent it
        sentBy: isAuthenticated ? "authenticated_user" : "anonymous_user",
        senderId: userId || "anonymous",
        timestamp: new Date().toISOString(),
      });

      log.info("Test notification broadcasted", {
        eventType,
        result,
        isAuthenticated,
        requesterId: userId || "anonymous",
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        eventType,
        sent: result.sent,
        failed: result.failed,
        message: `Notification sent to ${result.sent} connection(s)`,
        senderInfo: {
          isAuthenticated,
          userId: userId || null,
          type: isAuthenticated ? "authenticated" : "anonymous",
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    handleError("sending test SSE notification", error);

    return new Response(
      JSON.stringify({
        error: "Failed to send notification",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
