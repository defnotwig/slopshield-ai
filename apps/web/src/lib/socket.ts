/**
 * SlopShield AI — Socket.IO client singleton for real-time scan progress.
 *
 * Connects to the `/scans` namespace with auto-reconnect and
 * exponential backoff.
 */
import { io, type Socket } from "socket.io-client";

const SOCKET_URL: string =
  typeof window !== "undefined" &&
  (process.env.NEXT_PUBLIC_API_URL ?? "").length > 0
    ? process.env.NEXT_PUBLIC_API_URL!.replace(/\/api$/, "")
    : "http://localhost:3001";

let socket: Socket | null = null;

/**
 * Return (or create) the singleton Socket.IO connection
 * to the `/scans` namespace.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(`${SOCKET_URL}/scans`, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      autoConnect: true,
    });

    socket.on("connect", () => {
      console.log("[SlopShield] Socket connected:", socket?.id);
    });

    socket.on("disconnect", (reason) => {
      console.log("[SlopShield] Socket disconnected:", reason);
    });

    socket.on("connect_error", (err) => {
      console.warn("[SlopShield] Socket connection error:", err.message);
    });
  }

  return socket;
}

/**
 * Subscribe to real-time progress events for a specific scan.
 *
 * @returns An unsubscribe function to call on cleanup.
 */
export interface ScanProgressEvent {
  scanId: string;
  stage: string;
  percentage: number;
  message: string;
  isComplete: boolean;
  isFailed: boolean;
}

export function subscribeToScan(
  scanId: string,
  callback: (event: ScanProgressEvent) => void,
): () => void {
  const s = getSocket();

  /* Join the scan-specific room */
  s.emit("subscribe", { scanId });

  const handler = (data: ScanProgressEvent) => {
    if (data.scanId === scanId) {
      callback(data);
    }
  };

  s.on("scan-progress", handler);

  return () => {
    s.off("scan-progress", handler);
    s.emit("unsubscribe", { scanId });
  };
}
