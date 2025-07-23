"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface SSEEventData<T = unknown> {
  type: string;
  data: T;
  id?: string;
  timestamp: number;
}

export interface SSEConnectionState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  connectionId: string | null;
  lastHeartbeat: number | null;
}

export interface UseSSEOptions {
  /**
   * Additional query parameters to send with the connection
   */
  params?: Record<string, string>;

  /**
   * Whether to automatically reconnect on connection loss
   */
  autoReconnect?: boolean;

  /**
   * Reconnection delay in milliseconds
   */
  reconnectDelay?: number;

  /**
   * Maximum number of reconnection attempts
   */
  maxReconnectAttempts?: number;

  /**
   * Whether to start the connection immediately
   */
  autoConnect?: boolean;
}

export interface UseSSEReturn {
  /**
   * Current connection state
   */
  state: SSEConnectionState;

  /**
   * Last received event
   */
  lastEvent: SSEEventData | null;

  /**
   * Manually connect to SSE
   */
  connect: () => void;

  /**
   * Disconnect from SSE
   */
  disconnect: () => void;

  /**
   * Subscribe to specific event types
   */
  subscribe: <T = unknown>(
    eventType: string,
    handler: (data: T, event: SSEEventData<T>) => void,
  ) => () => void;

  /**
   * Send a test event (for development/testing)
   */
  sendTestEvent: (eventType: string, data: unknown) => void;
}

/**
 * React hook for managing SSE connections
 */
export function useSSE(options: UseSSEOptions = {}): UseSSEReturn {
  const {
    params = {},
    autoReconnect = true,
    reconnectDelay = 3000,
    maxReconnectAttempts = 5,
    autoConnect = true,
  } = options;

  const [state, setState] = useState<SSEConnectionState>({
    connected: false,
    connecting: false,
    error: null,
    connectionId: null,
    lastHeartbeat: null,
  });

  const [lastEvent, setLastEvent] = useState<SSEEventData | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const eventHandlers = useRef<Map<string, Set<Function>>>(new Map());

  const buildSSEUrl = useCallback(() => {
    const url = new URL("/api/sse", window.location.origin);

    // Add query parameters
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    return url.toString();
  }, [params]);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const eventData: SSEEventData = {
        type: event.type || "message",
        data: JSON.parse(event.data),
        id: event.lastEventId || undefined,
        timestamp: Date.now(),
      };

      setLastEvent(eventData);

      // Handle heartbeat events
      if (eventData.type === "heartbeat") {
        setState((prev) => ({
          ...prev,
          lastHeartbeat: Date.now(),
        }));
        return;
      }

      // Handle connection events
      if (eventData.type === "connected") {
        setState((prev) => ({
          ...prev,
          connectionId: (eventData.data as { connectionId: string })
            .connectionId,
        }));
        return;
      }

      // Call registered event handlers
      const handlers = eventHandlers.current.get(eventData.type);
      if (handlers) {
        handlers.forEach((handler) => {
          try {
            handler(eventData.data, eventData);
          } catch (error) {
            console.error(
              `Error in SSE event handler for ${eventData.type}:`,
              error,
            );
          }
        });
      }

      // Call generic message handlers
      const genericHandlers = eventHandlers.current.get("*");
      if (genericHandlers) {
        genericHandlers.forEach((handler) => {
          try {
            handler(eventData.data, eventData);
          } catch (error) {
            console.error("Error in generic SSE event handler:", error);
          }
        });
      }
    } catch (error) {
      console.error("Error parsing SSE event data:", error);
    }
  }, []);

  const handleOpen = useCallback(() => {
    console.log("SSE connection opened");
    setState((prev) => ({
      ...prev,
      connected: true,
      connecting: false,
      error: null,
    }));
    reconnectAttempts.current = 0;
  }, []);

  const handleError = useCallback(
    (event: Event) => {
      console.error("SSE connection error:", event);

      setState((prev) => ({
        ...prev,
        connected: false,
        connecting: false,
        error: "Connection error",
      }));

      // Attempt reconnection if enabled
      if (autoReconnect && reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        console.log(
          `Attempting to reconnect (${reconnectAttempts.current}/${maxReconnectAttempts})...`,
        );

        reconnectTimeoutRef.current = setTimeout(() => {
          // Call connect directly without dependency
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
          }

          console.log("🔌 SSE: Attempting to reconnect...");
          setState((prev) => ({
            ...prev,
            connecting: true,
            error: null,
          }));

          try {
            const eventSource = new EventSource(buildSSEUrl());
            eventSourceRef.current = eventSource;

            eventSource.addEventListener("open", handleOpen);
            eventSource.addEventListener("error", handleError);
            eventSource.addEventListener("message", handleMessage);

            // Listen for custom events
            eventSource.addEventListener("heartbeat", handleMessage);
            eventSource.addEventListener("connected", handleMessage);

            // Add listeners for all registered event types
            eventHandlers.current.forEach((_, eventType) => {
              if (eventType !== "*") {
                eventSource.addEventListener(eventType, handleMessage);
              }
            });
          } catch (error) {
            console.error("Failed to create SSE connection:", error);
            setState((prev) => ({
              ...prev,
              connecting: false,
              error:
                error instanceof Error ? error.message : "Connection failed",
            }));
          }
        }, reconnectDelay);
      } else if (reconnectAttempts.current >= maxReconnectAttempts) {
        setState((prev) => ({
          ...prev,
          error: `Max reconnection attempts (${maxReconnectAttempts}) exceeded`,
        }));
      }
    },
    [
      autoReconnect,
      maxReconnectAttempts,
      reconnectDelay,
      buildSSEUrl,
      handleOpen,
      handleMessage,
    ],
  );

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    console.log("🔌 SSE: Attempting to connect...");
    setState((prev) => ({
      ...prev,
      connecting: true,
      error: null,
    }));

    try {
      const eventSource = new EventSource(buildSSEUrl());
      eventSourceRef.current = eventSource;

      eventSource.addEventListener("open", handleOpen);
      eventSource.addEventListener("error", handleError);
      eventSource.addEventListener("message", handleMessage);

      // Listen for custom events
      eventSource.addEventListener("heartbeat", handleMessage);
      eventSource.addEventListener("connected", handleMessage);

      // Add listeners for all registered event types
      eventHandlers.current.forEach((_, eventType) => {
        if (eventType !== "*") {
          eventSource.addEventListener(eventType, handleMessage);
        }
      });

      console.log("🔌 SSE: EventSource created, URL:", buildSSEUrl());
    } catch (error) {
      console.error("Failed to create SSE connection:", error);
      setState((prev) => ({
        ...prev,
        connecting: false,
        error: error instanceof Error ? error.message : "Connection failed",
      }));
    }
  }, [buildSSEUrl, handleOpen, handleError, handleMessage]);

  const disconnect = useCallback(() => {
    console.log("🔌 SSE: Disconnecting...");

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      console.log("🔌 SSE: EventSource closed");
    }

    setState({
      connected: false,
      connecting: false,
      error: null,
      connectionId: null,
      lastHeartbeat: null,
    });

    reconnectAttempts.current = 0;
  }, []);

  const subscribe = useCallback(
    <T = unknown>(
      eventType: string,
      handler: (data: T, event: SSEEventData<T>) => void,
    ) => {
      if (!eventHandlers.current.has(eventType)) {
        eventHandlers.current.set(eventType, new Set());
      }

      eventHandlers.current.get(eventType)!.add(handler);

      // If we're already connected, add the event listener
      if (eventSourceRef.current && eventType !== "*") {
        eventSourceRef.current.addEventListener(eventType, handleMessage);
      }

      // Return unsubscribe function
      return () => {
        const handlers = eventHandlers.current.get(eventType);
        if (handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) {
            eventHandlers.current.delete(eventType);
          }
        }
      };
    },
    [handleMessage],
  );

  const sendTestEvent = useCallback(
    (eventType: string, data: unknown) => {
      // This is for development/testing - simulate receiving an event
      const mockEvent = new MessageEvent("message", {
        data: JSON.stringify(data),
        lastEventId: `test_${Date.now()}`,
      });

      Object.defineProperty(mockEvent, "type", {
        value: eventType,
        writable: false,
      });

      handleMessage(mockEvent);
    },
    [handleMessage],
  );

  // Auto-connect and cleanup on mount/unmount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    // Cleanup on unmount
    return () => {
      disconnect();
    };
  }, []); // Empty dependency array - only run on mount/unmount

  return {
    state,
    lastEvent,
    connect,
    disconnect,
    subscribe,
    sendTestEvent,
  };
}
