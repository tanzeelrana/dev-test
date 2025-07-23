import { NextRequest } from "next/server";
import { broadcastNotification, notifyUser } from "@/lib/sse/utils";
import { getSession } from "@/features/auth";
import { createServiceContext } from "@/utils/service-utils";

const { log, handleError } = createServiceContext("SSETestRoute");

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    const isAuthenticated = !!session?.user;
    const userId = session?.user?.id;

    if (!isAuthenticated || !userId) {
      log.warn("Unauthenticated notification attempt", {
        ip:
          request.headers.get("x-forwarded-for") ||
          request.headers.get("x-real-ip") ||
          "unknown",
        userAgent: request.headers.get("user-agent") || "unknown",
      });

      return new Response(
        JSON.stringify({
          error: "Authentication required",
          message: "You must be logged in to send notifications",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const body = await request.json();
    const { eventType, data, target, options } = body;

    if (!eventType || !data) {
      return new Response(
        JSON.stringify({ error: "eventType and data are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let result;

    if (target?.userId) {
      result = await notifyUser(target.userId, eventType, data, {
        id: options?.id,
        retry: options?.retry,
      });
      log.info(
        `Authenticated user ${userId} sent notification to user ${target.userId}`,
        {
          eventType,
          result,
          requesterId: userId,
        },
      );
    } else {
      // Broadcast to all connected clients (authenticated users only)
      result = await broadcastNotification(
        eventType,
        {
          ...data,
          // Add context about who sent it
          sentBy: "authenticated_user",
          senderId: userId,
          senderEmail: session?.user?.email,
          senderName: session?.user?.name,
          timestamp: new Date().toISOString(),
        },
        {
          id: options?.id,
          retry: options?.retry,
        },
      );

      log.info("Authenticated user sent broadcast notification", {
        eventType,
        result,
        requesterId: userId,
        requesterEmail: session?.user?.email,
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
          isAuthenticated: true,
          userId: userId,
          userEmail: session?.user?.email,
          userName: session?.user?.name,
          type: "authenticated",
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    handleError("sending authenticated SSE notification", error);

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
