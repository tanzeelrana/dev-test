"use client";

import { useState, useEffect } from "react";
import { useSSE } from "@/lib/sse";

interface Notification {
  id: string;
  type: string;
  message: string;
  timestamp: string;
}

export function SSEDemo() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [testMessage, setTestMessage] = useState("");

  const { state, lastEvent, connect, disconnect, subscribe } = useSSE({
    autoReconnect: true,
    maxReconnectAttempts: 3,
  });

  useEffect(() => {
    const unsubscribeMessage = subscribe("user.message", (data: any) => {
      setNotifications((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: "Message",
          message: data.content || "New message received",
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    });

    const unsubscribeSystem = subscribe("system.maintenance", (data: any) => {
      setNotifications((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: "System",
          message: data.message || "System notification",
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    });

    const unsubscribeJob = subscribe("job.progress", (data: any) => {
      setNotifications((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: "Job Update",
          message: `Job ${data.jobId}: ${data.progress}% - ${data.status}`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    });

    const unsubscribeAll = subscribe("*", (data: any, event) => {
      console.log("SSE Event received:", event);
    });

    return () => {
      unsubscribeMessage();
      unsubscribeSystem();
      unsubscribeJob();
      unsubscribeAll();
    };
  }, [subscribe]);

  const sendTestNotification = async () => {
    if (!testMessage.trim()) return;

    try {
      const response = await fetch("/api/sse/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "user.message",
          data: { content: testMessage, from: "Demo" },
        }),
      });

      if (response.ok) {
        setTestMessage("");
      } else {
        console.error("Failed to send test notification");
      }
    } catch (error) {
      console.error("Error sending test notification:", error);
    }
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  const getConnectionStatusColor = () => {
    if (state.connected) return "text-green-600";
    if (state.connecting) return "text-yellow-600";
    if (state.error) return "text-red-600";
    return "text-gray-600";
  };

  const getConnectionStatusText = () => {
    if (state.connected) return "Connected";
    if (state.connecting) return "Connecting...";
    if (state.error) return `Error: ${state.error}`;
    return "Disconnected";
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="rounded-lg bg-white p-6 shadow-md">
        <h1 className="mb-4 text-2xl font-bold">Server-Sent Events Demo</h1>

        {/* Connection Status */}
        <div className="mb-6 rounded-lg bg-gray-50 p-4">
          <h2 className="mb-2 text-lg font-semibold">Connection Status</h2>
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <span className="font-medium">Status: </span>
              <span className={getConnectionStatusColor()}>
                {getConnectionStatusText()}
              </span>
            </div>
            <div>
              <span className="font-medium">Connection ID: </span>
              <span className="text-gray-600">
                {state.connectionId ? state.connectionId.slice(-8) : "N/A"}
              </span>
            </div>
            <div>
              <span className="font-medium">Last Heartbeat: </span>
              <span className="text-gray-600">
                {state.lastHeartbeat
                  ? new Date(state.lastHeartbeat).toLocaleTimeString()
                  : "N/A"}
              </span>
            </div>
            <div>
              <span className="font-medium">Last Event: </span>
              <span className="text-gray-600">{lastEvent?.type || "N/A"}</span>
            </div>
          </div>
        </div>

        <div className="mb-6 flex gap-2">
          <button
            onClick={connect}
            disabled={state.connected || state.connecting}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
          >
            Connect
          </button>
          <button
            onClick={disconnect}
            disabled={!state.connected}
            className="rounded bg-red-500 px-4 py-2 text-white hover:bg-red-600 disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>

        <div className="mb-6 rounded-lg bg-blue-50 p-4">
          <h3 className="mb-2 text-lg font-semibold">Send Test Notification</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              placeholder="Enter test message..."
              className="flex-1 rounded border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              onKeyPress={(e) => e.key === "Enter" && sendTestNotification()}
            />
            <button
              onClick={sendTestNotification}
              disabled={!testMessage.trim()}
              className="rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600 disabled:opacity-50"
            >
              Send
            </button>
          </div>
          <p className="mt-2 text-sm text-gray-600">
            This will send a test notification to all connected clients
          </p>
        </div>

        <div className="rounded-lg bg-gray-50 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              Real-time Notifications ({notifications.length})
            </h3>
            <button
              onClick={clearNotifications}
              className="rounded bg-gray-500 px-3 py-1 text-sm text-white hover:bg-gray-600"
            >
              Clear
            </button>
          </div>

          <div className="max-h-96 space-y-2 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="py-8 text-center text-gray-500">
                No notifications yet. Connect and send a test message!
              </p>
            ) : (
              notifications
                .slice()
                .reverse()
                .map((notification) => (
                  <div
                    key={notification.id}
                    className="rounded border-l-4 border-blue-500 bg-white p-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="inline-block rounded bg-blue-100 px-2 py-1 text-xs text-blue-800">
                          {notification.type}
                        </span>
                        <p className="mt-1 text-gray-800">
                          {notification.message}
                        </p>
                      </div>
                      <span className="text-xs text-gray-500">
                        {notification.timestamp}
                      </span>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
