// Core SSE functionality
export { SSEManager, getSSEManager } from "./sse-manager";
export { SSEConnectionStore } from "./connection-store";

// Types
export type {
  SSEConnection,
  SSEEvent,
  SSEMessage,
  ConnectionFilter,
  SSEManagerConfig,
  SSEStats,
  SSEEventHandler,
  ConnectionEventHandler,
} from "./types";

// Utility functions for backend
export {
  notifyUser,
  notifySession,
  broadcastNotification,
  notifyFiltered,
  NotificationTypes,
  Notifications,
  getSSEStats,
  getActiveConnections,
} from "./utils";

// Client-side React hook
export { useSSE } from "./client/use-sse";
export type {
  SSEEventData,
  SSEConnectionState,
  UseSSEOptions,
  UseSSEReturn,
} from "./client/use-sse";
