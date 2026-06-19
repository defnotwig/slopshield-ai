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
    const roomName = `scan-${scanId}`;
    client.join(roomName);
    this.logger.log(
      `Client [${client.id}] subscribed to progress events in room: ${roomName}`,
    );
  }

  /**
   * Broadcasts a real-time progress update to all clients subscribed to a scan room.
   *
   * @param scanId The scan job identifier
   * @param progress Progress payload { stage: string, percentage: number, message?: string }
   */
  public broadcastProgress(
    scanId: string,
    progress: { stage: string; percentage: number; message?: string },
  ): void {
    const roomName = `scan-${scanId}`;
    this.server.to(roomName).emit("scan-progress", progress);
    this.logger.debug(
      `Broadcasted progress to [${roomName}]: ${progress.stage} (${progress.percentage}%)`,
    );
  }
}
