import type { SSEConnection, ConnectionFilter } from "./types";
import { createServiceContext } from "@/utils/service-utils";

const { log } = createServiceContext("SSEConnectionStore");

/**
 * In-memory store for managing SSE connections
 * In production, this could be backed by Redis for multi-instance support
 */
export class SSEConnectionStore {
  private connections = new Map<string, SSEConnection>();
  private userConnections = new Map<string, Set<string>>();
  private sessionConnections = new Map<string, Set<string>>();

  /**
   * Add a new connection to the store
   */
  addConnection(connection: SSEConnection): void {
    this.connections.set(connection.id, connection);

    // Index by userId if available
    if (connection.userId) {
      if (!this.userConnections.has(connection.userId)) {
        this.userConnections.set(connection.userId, new Set());
      }
      this.userConnections.get(connection.userId)!.add(connection.id);
    }

    // Index by sessionId if available
    if (connection.sessionId) {
      if (!this.sessionConnections.has(connection.sessionId)) {
        this.sessionConnections.set(connection.sessionId, new Set());
      }
      this.sessionConnections.get(connection.sessionId)!.add(connection.id);
    }

    log.info(`Connection added: ${connection.id}`, {
      userId: connection.userId,
      sessionId: connection.sessionId,
      totalConnections: this.connections.size,
    });
  }

  /**
   * Remove a connection from the store
   */
  removeConnection(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return false;
    }

    // Remove from main store
    this.connections.delete(connectionId);

    // Remove from user index
    if (connection.userId) {
      const userConnections = this.userConnections.get(connection.userId);
      if (userConnections) {
        userConnections.delete(connectionId);
        if (userConnections.size === 0) {
          this.userConnections.delete(connection.userId);
        }
      }
    }

    // Remove from session index
    if (connection.sessionId) {
      const sessionConnections = this.sessionConnections.get(
        connection.sessionId,
      );
      if (sessionConnections) {
        sessionConnections.delete(connectionId);
        if (sessionConnections.size === 0) {
          this.sessionConnections.delete(connection.sessionId);
        }
      }
    }

    log.info(`Connection removed: ${connectionId}`, {
      userId: connection.userId,
      sessionId: connection.sessionId,
      totalConnections: this.connections.size,
    });

    return true;
  }

  /**
   * Get a specific connection by ID
   */
  getConnection(connectionId: string): SSEConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get all connections matching the filter
   */
  getConnections(filter?: ConnectionFilter): SSEConnection[] {
    if (!filter) {
      return Array.from(this.connections.values());
    }

    let connectionIds = new Set<string>();

    // Filter by connectionId (specific connection)
    if (filter.connectionId) {
      const connection = this.connections.get(filter.connectionId);
      return connection ? [connection] : [];
    }

    // Filter by userId
    if (filter.userId) {
      const userConnections = this.userConnections.get(filter.userId);
      if (userConnections) {
        connectionIds = new Set(userConnections);
      } else {
        return [];
      }
    }

    // Filter by sessionId (intersect with existing results)
    if (filter.sessionId) {
      const sessionConnections = this.sessionConnections.get(filter.sessionId);
      if (sessionConnections) {
        if (connectionIds.size > 0) {
          // Intersect with existing results
          connectionIds = new Set(
            [...connectionIds].filter((id) => sessionConnections.has(id)),
          );
        } else {
          connectionIds = new Set(sessionConnections);
        }
      } else {
        return [];
      }
    }

    // If no specific filters were applied, return all connections
    if (connectionIds.size === 0 && !filter.userId && !filter.sessionId) {
      connectionIds = new Set(this.connections.keys());
    }

    // Get actual connection objects and apply metadata filter if needed
    let results = Array.from(connectionIds)
      .map((id) => this.connections.get(id))
      .filter((conn): conn is SSEConnection => conn !== undefined);

    // Apply metadata filter
    if (filter.metadata) {
      results = results.filter((conn) => {
        if (!conn.metadata) return false;
        return Object.entries(filter.metadata!).every(
          ([key, value]) => conn.metadata![key] === value,
        );
      });
    }

    return results;
  }

  /**
   * Get connections that haven't been pinged recently (for cleanup)
   */
  getStaleConnections(timeoutMs: number): SSEConnection[] {
    const cutoff = Date.now() - timeoutMs;
    return Array.from(this.connections.values()).filter(
      (conn) => conn.lastPing < cutoff,
    );
  }

  /**
   * Update the last ping time for a connection
   */
  updateLastPing(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastPing = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Get statistics about current connections
   */
  getStats() {
    const connectionsByUser: Record<string, number> = {};
    const connectionsBySession: Record<string, number> = {};
    let authenticatedConnections = 0;
    let anonymousConnections = 0;

    // Count connections by user
    for (const [userId, connections] of this.userConnections) {
      connectionsByUser[userId] = connections.size;
      authenticatedConnections += connections.size;
    }

    // Count connections by session
    for (const [sessionId, connections] of this.sessionConnections) {
      connectionsBySession[sessionId] = connections.size;
    }

    // Count anonymous connections (those without userId)
    for (const connection of this.connections.values()) {
      if (!connection.userId) {
        anonymousConnections++;
      }
    }

    return {
      totalConnections: this.connections.size,
      authenticatedConnections,
      anonymousConnections,
      totalUsers: this.userConnections.size,
      totalSessions: this.sessionConnections.size,
      connectionsByUser,
      connectionsBySession,
    };
  }

  /**
   * Clear all connections (useful for testing)
   */
  clear(): void {
    this.connections.clear();
    this.userConnections.clear();
    this.sessionConnections.clear();
  }
}
