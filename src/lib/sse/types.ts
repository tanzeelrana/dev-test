export interface SSEConnection {
  id: string;
  userId?: string;
  sessionId?: string;
  controller: ReadableStreamDefaultController;
  lastPing: number;
  metadata?: Record<string, unknown>;
}

export interface SSEEvent<T = unknown> {
  type: string;
  data: T;
  id?: string;
  retry?: number;
}

export interface SSEMessage {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

export interface ConnectionFilter {
  userId?: string;
  sessionId?: string;
  connectionId?: string;
  metadata?: Record<string, unknown>;
}

export interface SSEManagerConfig {
  heartbeatInterval: number; // milliseconds
  connectionTimeout: number; // milliseconds
  maxConnections: number;
  enableHeartbeat: boolean;
}

export interface SSEStats {
  totalConnections: number;
  authenticatedConnections: number;
  anonymousConnections: number;
  totalUsers: number;
  totalSessions: number;
  connectionsByUser: Record<string, number>;
  connectionsBySession: Record<string, number>;
  uptime: number;
  totalEventsSent: number;
  heartbeatsSent: number;
}

export type SSEEventHandler = (event: SSEEvent) => void;
export type ConnectionEventHandler = (connection: SSEConnection) => void;
