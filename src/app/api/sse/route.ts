import { NextRequest } from "next/server";
import { getSSEManager } from "@/lib/sse/sse-manager";
import { getSession } from "@/features/auth";
import { createServiceContext } from "@/utils/service-utils";

const { log, handleError } = createServiceContext("SSERoute");

export async function GET(request: NextRequest) {
  console.log("🔌 SSE Route: Request received at", new Date().toISOString());
  console.log("🔌 SSE Route: Request URL:", request.url);

  try {
    console.log("🔌 SSE Route: Processing connection request...");

    const session = await getSession();
    const userId = session?.user?.id;

    if (!userId) {
      log.warn("Unauthenticated SSE connection attempt", {
        ip:
          request.headers.get("x-forwarded-for") ||
          request.headers.get("x-real-ip") ||
          "unknown",
        userAgent: request.headers.get("user-agent") || "unknown",
      });

      return new Response(
        JSON.stringify({
          error: "Authentication required",
          message: "You must be logged in to establish an SSE connection",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    let sessionId = searchParams.get("sessionId") || undefined;
    const metadata: Record<string, unknown> = {};

    // Parse any additional metadata from query params
    for (const [key, value] of searchParams.entries()) {
      if (key !== "sessionId") {
        metadata[key] = value;
      }
    }

    if (!sessionId) {
      sessionId = `auth_${userId}_${Date.now()}`;
      log.info("Generated authenticated session ID", {
        sessionId,
        userId,
      });
    }

    metadata.ip =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";
    metadata.userAgent = request.headers.get("user-agent") || "unknown";
    metadata.isAuthenticated = true; // Always true now
    metadata.connectionTime = new Date().toISOString();
    metadata.userEmail = session?.user?.email;
    metadata.userName = session?.user?.name;

    log.info("Authenticated SSE connection request", {
      userId,
      sessionId,
      isAuthenticated: true,
      metadata: {
        ip: metadata.ip,
        userAgent:
          typeof metadata.userAgent === "string"
            ? metadata.userAgent.slice(0, 50) + "..."
            : metadata.userAgent,
        userEmail: metadata.userEmail,
      },
    });

    const sseManager = getSSEManager();

    const { connection, stream } = sseManager.createConnection({
      userId,
      sessionId,
      metadata,
    });

    console.log(
      "🔌 SSE Route: Total connections now:",
      sseManager.getStats().totalConnections,
    );

    // Set appropriate headers for SSE
    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    });

    const stats = sseManager.getStats();

    log.info(`Authenticated SSE connection established: ${connection.id}`, {
      userId,
      sessionId,
      isAuthenticated: true,
      totalConnections: stats.totalConnections,
      authenticatedUsers: Object.keys(stats.connectionsByUser).length,
    });

    return new Response(stream, { headers });
  } catch (error) {
    handleError("establishing authenticated SSE connection", error);

    return new Response(
      JSON.stringify({
        error: "Failed to establish SSE connection",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// Handle preflight requests for CORS
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Cache-Control",
    },
  });
}
