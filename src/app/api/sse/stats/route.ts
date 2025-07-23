import { NextRequest } from "next/server";
import { getSSEManager } from "@/lib/sse/sse-manager";
import { getSession } from "@/features/auth";
import { createServiceContext } from "@/utils/service-utils";

const { log, handleError } = createServiceContext("SSEStatsRoute");

export async function GET(request: NextRequest) {
  try {
    // Check if user is authenticated (you might want to add admin check here)
    const session = await getSession();
    const isAuthenticated = !!session?.user;

    const sseManager = getSSEManager();
    const stats = sseManager.getStats();

    // Get query parameters for filtering connections
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId") || undefined;
    const sessionId = searchParams.get("sessionId") || undefined;
    const showConnections = searchParams.get("showConnections") === "true";

    let connections: Array<{
      id: string;
      userId?: string;
      sessionId?: string;
      lastPing: number;
      metadata?: Record<string, unknown>;
      isAuthenticated: boolean;
      connectionAge: number;
    }> = [];

    if (showConnections || userId || sessionId) {
      connections = sseManager
        .getConnections({ userId, sessionId })
        .map((conn) => ({
          id: conn.id,
          userId: conn.userId,
          sessionId: conn.sessionId,
          lastPing: conn.lastPing,
          metadata: conn.metadata,
          isAuthenticated: !!conn.userId,
          connectionAge: Date.now() - conn.lastPing,
        }));
    }

    // Enhanced response with better breakdown
    const response = {
      stats: {
        ...stats,
        breakdown: {
          authenticated: {
            connections: stats.authenticatedConnections,
            users: stats.totalUsers,
            percentage:
              stats.totalConnections > 0
                ? Math.round(
                    (stats.authenticatedConnections / stats.totalConnections) *
                      100,
                  )
                : 0,
          },
          anonymous: {
            connections: stats.anonymousConnections,
            sessions: Object.keys(stats.connectionsBySession).filter((s) =>
              s.startsWith("anon_"),
            ).length,
            percentage:
              stats.totalConnections > 0
                ? Math.round(
                    (stats.anonymousConnections / stats.totalConnections) * 100,
                  )
                : 0,
          },
        },
      },
      connections: connections.length > 0 ? connections : undefined,
      requestInfo: {
        isAuthenticated,
        requesterId: session?.user?.id,
        timestamp: Date.now(),
      },
    };

    log.info("SSE stats requested", {
      requesterId: session?.user?.id || "anonymous",
      isAuthenticated,
      totalConnections: stats.totalConnections,
      authenticatedConnections: stats.authenticatedConnections,
      anonymousConnections: stats.anonymousConnections,
    });

    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    handleError("getting SSE stats", error);

    return new Response(
      JSON.stringify({
        error: "Failed to get SSE stats",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
