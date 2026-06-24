import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Logger } from "@nestjs/common";

@WebSocketGateway({
  cors: {
    origin: "*",
  },
  namespace: "scans",
})
export class ScanGateway {
  private readonly logger = new Logger(ScanGateway.name);

  @WebSocketServer()
  private server!: Server;

  public handleConnection(client: Socket): void {
    this.logger.log(`Socket client connected: ${client.id}`);
  }

  public handleDisconnect(client: Socket): void {
    this.logger.log(`Socket client disconnected: ${client.id}`);
  }

  @SubscribeMessage("subscribe-scan")
  public handleSubscribeScan(
    @MessageBody("scanId") scanId: string,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!scanId) {
      return;
    }
    const roomName = `scan-${scanId}`;
    client.join(roomName);
    this.logger.log(
      `Client [${client.id}] subscribed to progress events in room: ${roomName}`,
    );
  }

  @SubscribeMessage("unsubscribe-scan")
  public handleUnsubscribeScan(
    @MessageBody("scanId") scanId: string,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!scanId) {
      return;
    }
    const roomName = `scan-${scanId}`;
    client.leave(roomName);
    this.logger.log(
      `Client [${client.id}] unsubscribed from progress events in room: ${roomName}`,
    );
  }

  /**
   * Broadcasts a real-time progress update to all clients subscribed to a scan room.
   *
   * The emitted payload always carries `scanId` plus the terminal `isComplete` /
   * `isFailed` flags so the browser client can correlate the event to the scan it
   * is watching (the client filters on `scanId`) and detect completion without an
   * extra poll. Omitting `scanId` here previously caused every event to be silently
   * discarded by the client-side filter.
   *
   * @param scanId The scan job identifier
   * @param progress Progress payload { stage: string, percentage: number, message?: string }
   */
  public broadcastProgress(
    scanId: string,
    progress: { stage: string; percentage: number; message?: string },
  ): void {
    const roomName = `scan-${scanId}`;
    const payload = {
      scanId,
      stage: progress.stage,
      percentage: progress.percentage,
      message: progress.message ?? "",
      isComplete: progress.stage === "completed",
      isFailed: progress.stage === "failed",
    };
    this.server.to(roomName).emit("scan-progress", payload);
    this.logger.debug(
      `Broadcasted progress to [${roomName}]: ${progress.stage} (${progress.percentage}%)`,
    );
  }
}
