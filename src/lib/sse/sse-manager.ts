import { SSEConnectionStore } from "./connection-store";
import type {
  SSEConnection,
  SSEEvent,
  SSEMessage,
  ConnectionFilter,
  SSEManagerConfig,
  SSEStats,
  ConnectionEventHandler,
} from "./types";
import { createServiceContext } from "@/utils/service-utils";

const { log, handleError } = createServiceContext("SSEManager");

/**
 * Central SSE manager for handling connections and event dispatching
 */
export class SSEManager {
  private store = new SSEConnectionStore();
  private config: SSEManagerConfig;
  private heartbeatInterval?: NodeJS.Timeout;
  private startTime = Date.now();
  private eventsSent = 0;
  private heartbeatsSent = 0;
  private onConnect?: ConnectionEventHandler;
  private onDisconnect?: ConnectionEventHandler;

  constructor(config: Partial<SSEManagerConfig> = {}) {
    this.config = {
      heartbeatInterval: 30000, // 30 seconds
      connectionTimeout: 60000, // 60 seconds
      maxConnections: 1000,
      enableHeartbeat: true,
      ...config,
    };

    if (this.config.enableHeartbeat) {
      this.startHeartbeat();
    }

    log.info("SSE Manager initialized", { config: this.config });
  }

  /**
   * Set connection event handlers
   */
  setEventHandlers(handlers: {
    onConnect?: ConnectionEventHandler;
    onDisconnect?: ConnectionEventHandler;
  }) {
    this.onConnect = handlers.onConnect;
    this.onDisconnect = handlers.onDisconnect;
  }

  /**
   * Create a new SSE connection
   */
  createConnection(params: {
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }): { connection: SSEConnection; stream: ReadableStream } {
    // Check connection limits
    const currentConnections = this.store.getStats().totalConnections;
    if (currentConnections >= this.config.maxConnections) {
      throw new Error(
        `Maximum connections (${this.config.maxConnections}) exceeded`,
      );
    }

    const connectionId = this.generateConnectionId();
    let controller: ReadableStreamDefaultController;

    const stream = new ReadableStream({
      start: (ctrl) => {
        controller = ctrl;

        // Send initial connection message
        const welcomeMessage = this.formatSSEMessage({
          event: "connected",
          data: JSON.stringify({ connectionId, timestamp: Date.now() }),
        });
        ctrl.enqueue(new TextEncoder().encode(welcomeMessage));
      },
      cancel: () => {
        this.removeConnection(connectionId);
      },
    });

    const connection: SSEConnection = {
      id: connectionId,
      userId: params.userId,
      sessionId: params.sessionId,
      controller: controller!,
      lastPing: Date.now(),
      metadata: params.metadata,
    };

    this.store.addConnection(connection);
    this.onConnect?.(connection);

    log.info(`SSE connection created: ${connectionId}`, {
      userId: params.userId,
      sessionId: params.sessionId,
      totalConnections: this.store.getStats().totalConnections,
    });

    return { connection, stream };
  }

  /**
   * Remove a connection
   */
  removeConnection(connectionId: string): boolean {
    const connection = this.store.getConnection(connectionId);
    if (!connection) {
      return false;
    }

    try {
      connection.controller.close();
    } catch (error) {
      // Connection might already be closed
      log.warn(`Error closing connection ${connectionId}:`, error);
    }

    const removed = this.store.removeConnection(connectionId);
    if (removed && connection) {
      this.onDisconnect?.(connection);
    }

    return removed;
  }

  /**
   * Send an event to specific connections
   */
  async sendEvent<T = unknown>(
    event: SSEEvent<T>,
    filter?: ConnectionFilter,
  ): Promise<{ sent: number; failed: number }> {
    const connections = this.store.getConnections(filter);
    let sent = 0;
    let failed = 0;

    const message = this.formatSSEMessage({
      event: event.type,
      data: JSON.stringify(event.data),
      id: event.id,
      retry: event.retry,
    });

    const encodedMessage = new TextEncoder().encode(message);

    for (const connection of connections) {
      try {
        connection.controller.enqueue(encodedMessage);
        sent++;
        this.eventsSent++;
      } catch (error) {
        failed++;
        log.warn(`Failed to send event to connection ${connection.id}:`, error);
        // Remove failed connection
        this.removeConnection(connection.id);
      }
    }

    log.info(`Event sent: ${event.type}`, {
      filter,
      connectionsTargeted: connections.length,
      sent,
      failed,
    });

    return { sent, failed };
  }

  /**
   * Broadcast an event to all connections
   */
  async broadcast<T = unknown>(
    event: SSEEvent<T>,
  ): Promise<{ sent: number; failed: number }> {
    return this.sendEvent(event);
  }

  /**
   * Send event to specific user (all their connections)
   */
  async sendToUser<T = unknown>(
    userId: string,
    event: SSEEvent<T>,
  ): Promise<{ sent: number; failed: number }> {
    return this.sendEvent(event, { userId });
  }

  /**
   * Send event to specific session (all connections in that session)
   */
  async sendToSession<T = unknown>(
    sessionId: string,
    event: SSEEvent<T>,
  ): Promise<{ sent: number; failed: number }> {
    return this.sendEvent(event, { sessionId });
  }

  /**
   * Send event to specific connection
   */
  async sendToConnection<T = unknown>(
    connectionId: string,
    event: SSEEvent<T>,
  ): Promise<{ sent: number; failed: number }> {
    return this.sendEvent(event, { connectionId });
  }

  /**
   * Get connection statistics
   */
  getStats(): SSEStats {
    const storeStats = this.store.getStats();
    return {
      totalConnections: storeStats.totalConnections,
      authenticatedConnections: storeStats.authenticatedConnections,
      anonymousConnections: storeStats.anonymousConnections,
      totalUsers: storeStats.totalUsers,
      totalSessions: storeStats.totalSessions,
      connectionsByUser: storeStats.connectionsByUser,
      connectionsBySession: storeStats.connectionsBySession,
      uptime: Date.now() - this.startTime,
      totalEventsSent: this.eventsSent,
      heartbeatsSent: this.heartbeatsSent,
    };
  }

  /**
   * Get connections matching filter
   */
  getConnections(filter?: ConnectionFilter): SSEConnection[] {
    return this.store.getConnections(filter);
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
      this.cleanupStaleConnections();
    }, this.config.heartbeatInterval);

    log.info("Heartbeat started", { interval: this.config.heartbeatInterval });
  }

  /**
   * Send heartbeat to all connections
   */
  private async sendHeartbeat(): Promise<void> {
    const heartbeatEvent: SSEEvent = {
      type: "heartbeat",
      data: { timestamp: Date.now() },
    };

    const result = await this.broadcast(heartbeatEvent);
    this.heartbeatsSent += result.sent;

    // Update last ping for successful connections
    const connections = this.store.getConnections();
    connections.forEach((conn) => {
      this.store.updateLastPing(conn.id);
    });
  }

  /**
   * Clean up stale connections
   */
  private cleanupStaleConnections(): void {
    const staleConnections = this.store.getStaleConnections(
      this.config.connectionTimeout,
    );

    for (const connection of staleConnections) {
      log.warn(`Cleaning up stale connection: ${connection.id}`, {
        userId: connection.userId,
        lastPing: new Date(connection.lastPing).toISOString(),
      });
      this.removeConnection(connection.id);
    }

    if (staleConnections.length > 0) {
      log.info(`Cleaned up ${staleConnections.length} stale connections`);
    }
  }

  /**
   * Format SSE message according to the specification
   */
  private formatSSEMessage(message: SSEMessage): string {
    let formatted = "";

    if (message.event) {
      formatted += `event: ${message.event}\n`;
    }

    if (message.id) {
      formatted += `id: ${message.id}\n`;
    }

    if (message.retry) {
      formatted += `retry: ${message.retry}\n`;
    }

    // Split data by lines and prefix each with "data: "
    const dataLines = message.data.split("\n");
    for (const line of dataLines) {
      formatted += `data: ${line}\n`;
    }

    formatted += "\n"; // Empty line to end the message

    return formatted;
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `sse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Shutdown the SSE manager
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all connections
    const connections = this.store.getConnections();
    connections.forEach((conn) => {
      this.removeConnection(conn.id);
    });

    this.store.clear();
    log.info("SSE Manager shutdown complete");
  }
}

// Global singleton instance
let sseManagerInstance: SSEManager | null = null;

/**
 * Get the global SSE manager instance
 */
export function getSSEManager(): SSEManager {
  if (!sseManagerInstance) {
    sseManagerInstance = new SSEManager();
  }
  return sseManagerInstance;
}
