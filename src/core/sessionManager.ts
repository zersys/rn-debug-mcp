import type { SessionState } from "../types/api.js";
import { ToolError } from "./toolError.js";

export type CleanupFn = () => Promise<void> | void;

export class SessionManager {
  private state: SessionState = { status: "disconnected" };
  private readonly cleanupFns: CleanupFn[] = [];

  getState(): SessionState {
    return { ...this.state };
  }

  isConnected(): boolean {
    return this.state.status === "connected";
  }

  beginConnecting(): void {
    if (this.state.status !== "disconnected") {
      throw new ToolError("COMMAND_FAILED", "An app session is already active");
    }

    this.state = { status: "connecting" };
  }

  setConnected(deviceId: string, metroPort: number): SessionState {
    const startedAt = new Date().toISOString();
    this.state = {
      status: "connected",
      deviceId,
      metroPort,
      startedAt,
    };

    return this.getState();
  }

  addCleanup(fn: CleanupFn): void {
    this.cleanupFns.push(fn);
  }

  requireConnected(): Required<Pick<SessionState, "deviceId" | "metroPort" | "startedAt">> {
    if (this.state.status !== "connected" || !this.state.deviceId || !this.state.metroPort || !this.state.startedAt) {
      throw new ToolError("NO_SESSION", "No active app session. Call connect_app first.");
    }

    return {
      deviceId: this.state.deviceId,
      metroPort: this.state.metroPort,
      startedAt: this.state.startedAt,
    };
  }

  async reset(): Promise<void> {
    const tasks = [...this.cleanupFns].reverse();
    this.cleanupFns.length = 0;

    for (const task of tasks) {
      try {
        await task();
      } catch {
        // Ignore cleanup failures so reset remains idempotent.
      }
    }

    this.state = { status: "disconnected" };
  }
}
