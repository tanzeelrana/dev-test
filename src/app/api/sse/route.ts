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

    // Get session for user identification
    const session = await getSession();
    const userId = session?.user?.id;

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

    // Generate session ID for anonymous users if not provided
    if (!sessionId && !userId) {
      // Create a session ID based on IP and user agent for anonymous users
      const ip =
        request.headers.get("x-forwarded-for") ||
        request.headers.get("x-real-ip") ||
        "unknown";
      const userAgent = request.headers.get("user-agent") || "unknown";
      const timestamp = Date.now();

      // Create a simple hash for anonymous session
      sessionId = `anon_${Buffer.from(`${ip}_${userAgent}_${timestamp}`).toString("base64").slice(0, 16)}`;

      log.info("Generated anonymous session ID", {
        sessionId,
        ip: ip.slice(0, 10) + "...",
      });
    }

    // Add connection metadata
    metadata.ip =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";
    metadata.userAgent = request.headers.get("user-agent") || "unknown";
    metadata.isAuthenticated = !!userId;
    metadata.connectionTime = new Date().toISOString();

    log.info("SSE connection request", {
      userId: userId || "anonymous",
      sessionId,
      isAuthenticated: !!userId,
      metadata: {
        ip: metadata.ip,
        userAgent:
          typeof metadata.userAgent === "string"
            ? metadata.userAgent.slice(0, 50) + "..."
            : metadata.userAgent,
      },
    });

    const sseManager = getSSEManager();

    // Create the SSE connection
    const { connection, stream } = sseManager.createConnection({
      userId,
      sessionId,
      metadata,
    });

    console.log("🔌 SSE Route: Connection created:", connection.id);
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

    log.info(`SSE connection established: ${connection.id}`, {
      userId: userId || "anonymous",
      sessionId,
      isAuthenticated: !!userId,
      totalConnections: stats.totalConnections,
      authenticatedUsers: Object.keys(stats.connectionsByUser).length,
    });

    return new Response(stream, { headers });
  } catch (error) {
    handleError("establishing SSE connection", error);

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
