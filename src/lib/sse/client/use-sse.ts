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

  const abortControllerRef = useRef<AbortController | null>(null);
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

  const handleMessage = useCallback((event: SSEEventData) => {
    try {
      setLastEvent(event);

      // Handle heartbeat events
      if (event.type === "heartbeat") {
        setState((prev) => ({
          ...prev,
          lastHeartbeat: Date.now(),
        }));
        return;
      }

      // Handle connection events
      if (event.type === "connected") {
        setState((prev) => ({
          ...prev,
          connectionId: (event.data as { connectionId: string }).connectionId,
        }));
        return;
      }

      // Call registered event handlers
      const handlers = eventHandlers.current.get(event.type);
      if (handlers) {
        handlers.forEach((handler) => {
          try {
            handler(event.data, event);
          } catch (error) {
            console.error(
              `Error in SSE event handler for ${event.type}:`,
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
            handler(event.data, event);
          } catch (error) {
            console.error("Error in generic SSE event handler:", error);
          }
        });
      }
    } catch (error) {
      console.error("Error parsing SSE event data:", error);
    }
  }, []);

  const parseSSEMessage = useCallback((text: string): SSEEventData | null => {
    const lines = text.split("\n");
    let eventType = "message";
    let data = "";
    let id = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7);
      } else if (line.startsWith("data: ")) {
        data = line.slice(6);
      } else if (line.startsWith("id: ")) {
        id = line.slice(4);
      }
    }

    if (data) {
      try {
        const parsedData = JSON.parse(data);
        return {
          type: eventType,
          data: parsedData,
          id: id || undefined,
          timestamp: Date.now(),
        };
      } catch (error) {
        console.error("Error parsing SSE data:", error);
        return null;
      }
    }

    return null;
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
    (error: string) => {
      console.error("SSE connection error:", error);

      setState((prev) => ({
        ...prev,
        connected: false,
        connecting: false,
        error: error,
      }));

      // Attempt reconnection if enabled
      if (autoReconnect && reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        console.log(
          `Attempting to reconnect (${reconnectAttempts.current}/${maxReconnectAttempts})...`,
        );

        reconnectTimeoutRef.current = setTimeout(() => {
          // We'll call connect after it's defined
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
          }

          console.log("  Attempting to reconnect...");
          setState((prev) => ({
            ...prev,
            connecting: true,
            error: null,
          }));

          // Recreate the connection logic here to avoid circular dependency
          try {
            const abortController = new AbortController();
            abortControllerRef.current = abortController;

            const url = buildSSEUrl();
            console.log("  Fetching SSE URL:", url);

            fetch(url, {
              method: "GET",
              credentials: "include",
              headers: {
                Accept: "text/event-stream",
                "Cache-Control": "no-cache",
              },
              signal: abortController.signal,
            })
              .then((response) => {
                if (!response.ok) {
                  throw new Error(
                    `HTTP ${response.status}: ${response.statusText}`,
                  );
                }

                if (!response.body) {
                  throw new Error("No response body");
                }

                handleOpen();

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                const readStream = () => {
                  reader
                    .read()
                    .then(({ done, value }) => {
                      if (done) {
                        console.log("SSE stream ended");
                        return;
                      }

                      const chunk = decoder.decode(value, { stream: true });
                      buffer += chunk;

                      // Process complete messages
                      const messages = buffer.split("\n\n");
                      buffer = messages.pop() || "";

                      for (const message of messages) {
                        if (message.trim()) {
                          const eventData = parseSSEMessage(message);
                          if (eventData) {
                            handleMessage(eventData);
                          }
                        }
                      }

                      // Continue reading
                      readStream();
                    })
                    .catch((error) => {
                      if (error.name === "AbortError") {
                        console.log("SSE connection aborted");
                        return;
                      }
                      console.error("Error reading SSE stream:", error);
                      handleError(error.message);
                    });
                };

                readStream();
              })
              .catch((error) => {
                if (error.name === "AbortError") {
                  console.log("SSE connection aborted");
                  return;
                }
                console.error("Failed to create SSE connection:", error);
                handleError(error.message);
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
      parseSSEMessage,
    ],
  );

  const connect = useCallback(() => {
    // Cancel any existing connection
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    console.log("  Attempting to connect...");
    setState((prev) => ({
      ...prev,
      connecting: true,
      error: null,
    }));

    try {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const url = buildSSEUrl();
      console.log("  Fetching SSE URL:", url);

      fetch(url, {
        method: "GET",
        credentials: "include", // This is crucial - it sends cookies!
        headers: {
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
        signal: abortController.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          if (!response.body) {
            throw new Error("No response body");
          }

          handleOpen();

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          const readStream = () => {
            reader
              .read()
              .then(({ done, value }) => {
                if (done) {
                  console.log("SSE stream ended");
                  return;
                }

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                const messages = buffer.split("\n\n");
                buffer = messages.pop() || "";

                for (const message of messages) {
                  if (message.trim()) {
                    const eventData = parseSSEMessage(message);
                    if (eventData) {
                      handleMessage(eventData);
                    }
                  }
                }

                // Continue reading
                readStream();
              })
              .catch((error) => {
                if (error.name === "AbortError") {
                  console.log("SSE connection aborted");
                  return;
                }
                console.error("Error reading SSE stream:", error);
                handleError(error.message);
              });
          };

          readStream();
        })
        .catch((error) => {
          if (error.name === "AbortError") {
            console.log("SSE connection aborted");
            return;
          }
          console.error("Failed to create SSE connection:", error);
          handleError(error.message);
        });
    } catch (error) {
      console.error("Failed to create SSE connection:", error);
      setState((prev) => ({
        ...prev,
        connecting: false,
        error: error instanceof Error ? error.message : "Connection failed",
      }));
    }
  }, [buildSSEUrl, handleOpen, handleError, handleMessage, parseSSEMessage]);

  const disconnect = useCallback(() => {
    console.log("  Disconnecting...");

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      console.log("  SSE connection aborted");
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
    [],
  );

  const sendTestEvent = useCallback(
    (eventType: string, data: unknown) => {
      // This is for development/testing - simulate receiving an event
      const mockEvent: SSEEventData = {
        type: eventType,
        data: data,
        id: `test_${Date.now()}`,
        timestamp: Date.now(),
      };

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
