import { getSSEManager } from "./sse-manager";
import type { SSEEvent, ConnectionFilter } from "./types";

/**
 * Utility functions for backend features to send SSE notifications
 * without dealing with SSE protocol details
 */

/**
 * Send a notification to a specific user
 */
export async function notifyUser<T = unknown>(
  userId: string,
  eventType: string,
  data: T,
  options?: { id?: string; retry?: number },
): Promise<{ sent: number; failed: number }> {
  const sseManager = getSSEManager();

  const event: SSEEvent<T> = {
    type: eventType,
    data,
    id: options?.id,
    retry: options?.retry,
  };

  return sseManager.sendToUser(userId, event);
}

/**
 * Send a notification to all users in a session
 */
export async function notifySession<T = unknown>(
  sessionId: string,
  eventType: string,
  data: T,
  options?: { id?: string; retry?: number },
): Promise<{ sent: number; failed: number }> {
  const sseManager = getSSEManager();

  const event: SSEEvent<T> = {
    type: eventType,
    data,
    id: options?.id,
    retry: options?.retry,
  };

  return sseManager.sendToSession(sessionId, event);
}

/**
 * Broadcast a notification to all connected clients
 */
export async function broadcastNotification<T = unknown>(
  eventType: string,
  data: T,
  options?: { id?: string; retry?: number },
): Promise<{ sent: number; failed: number }> {
  const sseManager = getSSEManager();

  const event: SSEEvent<T> = {
    type: eventType,
    data,
    id: options?.id,
    retry: options?.retry,
  };

  return sseManager.broadcast(event);
}

/**
 * Send a notification to connections matching specific criteria
 */
export async function notifyFiltered<T = unknown>(
  filter: ConnectionFilter,
  eventType: string,
  data: T,
  options?: { id?: string; retry?: number },
): Promise<{ sent: number; failed: number }> {
  const sseManager = getSSEManager();

  const event: SSEEvent<T> = {
    type: eventType,
    data,
    id: options?.id,
    retry: options?.retry,
  };

  return sseManager.sendEvent(event, filter);
}

/**
 * Common notification types with predefined event names
 */
export const NotificationTypes = {
  // System notifications
  SYSTEM_MAINTENANCE: "system.maintenance",
  SYSTEM_UPDATE: "system.update",

  // User notifications
  USER_MESSAGE: "user.message",
  USER_MENTION: "user.mention",
  USER_FOLLOW: "user.follow",

  // Content notifications
  CONTENT_UPDATED: "content.updated",
  CONTENT_PUBLISHED: "content.published",
  CONTENT_DELETED: "content.deleted",

  // Real-time updates
  REALTIME_UPDATE: "realtime.update",
  REALTIME_SYNC: "realtime.sync",

  // Job/Task notifications
  JOB_COMPLETED: "job.completed",
  JOB_FAILED: "job.failed",
  JOB_PROGRESS: "job.progress",

  // Custom events
  CUSTOM: "custom",
} as const;

/**
 * Predefined notification functions for common use cases
 */
export const Notifications = {
  /**
   * Send a system maintenance notification to all users
   */
  systemMaintenance: (message: string, scheduledTime?: Date) =>
    broadcastNotification(NotificationTypes.SYSTEM_MAINTENANCE, {
      message,
      scheduledTime: scheduledTime?.toISOString(),
      timestamp: new Date().toISOString(),
    }),

  /**
   * Notify a user about a new message
   */
  userMessage: (
    userId: string,
    message: { from: string; content: string; id: string },
  ) =>
    notifyUser(userId, NotificationTypes.USER_MESSAGE, {
      ...message,
      timestamp: new Date().toISOString(),
    }),

  /**
   * Notify a user they were mentioned
   */
  userMention: (
    userId: string,
    mention: { by: string; in: string; context: string },
  ) =>
    notifyUser(userId, NotificationTypes.USER_MENTION, {
      ...mention,
      timestamp: new Date().toISOString(),
    }),

  /**
   * Notify about content updates
   */
  contentUpdated: (contentId: string, changes: Record<string, unknown>) =>
    broadcastNotification(NotificationTypes.CONTENT_UPDATED, {
      contentId,
      changes,
      timestamp: new Date().toISOString(),
    }),

  /**
   * Send job progress updates
   */
  jobProgress: (
    userId: string,
    jobId: string,
    progress: number,
    status: string,
  ) =>
    notifyUser(userId, NotificationTypes.JOB_PROGRESS, {
      jobId,
      progress,
      status,
      timestamp: new Date().toISOString(),
    }),

  /**
   * Send real-time updates to specific sessions
   */
  realtimeUpdate: (sessionId: string, data: Record<string, unknown>) =>
    notifySession(sessionId, NotificationTypes.REALTIME_UPDATE, {
      ...data,
      timestamp: new Date().toISOString(),
    }),
};

/**
 * Get SSE connection statistics
 */
export function getSSEStats() {
  const sseManager = getSSEManager();
  return sseManager.getStats();
}

/**
 * Get active connections for debugging/monitoring
 */
export function getActiveConnections(filter?: ConnectionFilter) {
  const sseManager = getSSEManager();
  return sseManager.getConnections(filter);
}
