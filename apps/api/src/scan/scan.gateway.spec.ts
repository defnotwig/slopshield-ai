// Regression test for the live-progress smoking gun: the broadcast payload MUST
// carry `scanId` (the browser client filters on it) plus the terminal
// isComplete/isFailed flags. Omitting scanId previously caused every progress
// event to be silently discarded client-side.

import { ScanGateway } from "./scan.gateway";

function makeGateway(): { gateway: ScanGateway; captured: { room?: string; event?: string; payload?: any } } {
  const gateway = new ScanGateway();
  const captured: { room?: string; event?: string; payload?: any } = {};
  (gateway as any).server = {
    to: (room: string) => {
      captured.room = room;
      return {
        emit: (event: string, payload: any) => {
          captured.event = event;
          captured.payload = payload;
        },
      };
    },
  };
  return { gateway, captured };
}

describe("ScanGateway.broadcastProgress", () => {
  it("emits to the scan room with scanId and non-terminal flags mid-scan", () => {
    const { gateway, captured } = makeGateway();
    gateway.broadcastProgress("abc", {
      stage: "scanning",
      percentage: 40,
      message: "scanning",
    });
    expect(captured.room).toBe("scan-abc");
    expect(captured.event).toBe("scan-progress");
    expect(captured.payload.scanId).toBe("abc");
    expect(captured.payload.stage).toBe("scanning");
    expect(captured.payload.isComplete).toBe(false);
    expect(captured.payload.isFailed).toBe(false);
  });

  it("sets isComplete on the completed stage", () => {
    const { gateway, captured } = makeGateway();
    gateway.broadcastProgress("abc", { stage: "completed", percentage: 100 });
    expect(captured.payload.isComplete).toBe(true);
    expect(captured.payload.isFailed).toBe(false);
    expect(captured.payload.message).toBe("");
  });

  it("sets isFailed on the failed stage", () => {
    const { gateway, captured } = makeGateway();
    gateway.broadcastProgress("abc", { stage: "failed", percentage: 100, message: "boom" });
    expect(captured.payload.isFailed).toBe(true);
    expect(captured.payload.isComplete).toBe(false);
  });
});
