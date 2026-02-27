import { randomUUID } from "node:crypto";
import type { Platform, SessionState, SessionSummary } from "../types/api.js";
import { ToolError } from "./toolError.js";

export type CleanupFn = () => Promise<void> | void;

interface SessionRecord extends SessionSummary {
  cleanupFns: CleanupFn[];
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private activeSessionId?: string;
  private legacyConnecting = false;
  private readonly pendingLegacyCleanupFns: CleanupFn[] = [];

  private asState(record: SessionRecord | undefined): SessionState {
    if (!record) {
      return { status: "disconnected" };
    }

    return {
      status: "connected",
      sessionId: record.sessionId,
      platform: record.platform,
      deviceId: record.deviceId,
      metroPort: record.metroPort,
      startedAt: record.startedAt,
    };
  }

  getState(sessionId?: string): SessionState {
    if (sessionId) {
      return this.asState(this.sessions.get(sessionId));
    }

    return this.asState(this.resolveSession(undefined, false));
  }

  isConnected(): boolean {
    return this.sessions.size > 0;
  }

  // Deprecated single-session helper retained for compatibility.
  beginConnecting(): void {
    if (this.sessions.size > 0 || this.legacyConnecting) {
      throw new ToolError("COMMAND_FAILED", "An app session is already active");
    }

    this.legacyConnecting = true;
    this.pendingLegacyCleanupFns.length = 0;
  }

  // Deprecated single-session helper retained for compatibility.
  setConnected(deviceId: string, metroPort: number): SessionState {
    const session = this.createSession("android", deviceId, metroPort);
    if (this.pendingLegacyCleanupFns.length > 0) {
      const record = this.sessions.get(session.sessionId);
      if (record) {
        record.cleanupFns.push(...this.pendingLegacyCleanupFns);
      }
      this.pendingLegacyCleanupFns.length = 0;
    }
    this.legacyConnecting = false;
    return {
      status: "connected",
      sessionId: session.sessionId,
      platform: session.platform,
      deviceId: session.deviceId,
      metroPort: session.metroPort,
      startedAt: session.startedAt,
    };
  }

  createSession(platform: Platform, deviceId: string, metroPort: number): SessionSummary {
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    const record: SessionRecord = {
      sessionId,
      platform,
      status: "connected",
      deviceId,
      metroPort,
      startedAt,
      connectionHealth: "healthy",
      reconnectAttempts: 0,
      cleanupFns: [],
    };

    this.sessions.set(sessionId, record);
    this.activeSessionId = sessionId;
    this.legacyConnecting = false;
    return this.toSummary(record);
  }

  listSessions(): SessionSummary[] {
    return Array.from(this.sessions.values())
      .map((record) => this.toSummary(record))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  getActiveSessionId(): string | undefined {
    return this.activeSessionId;
  }

  setActiveSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new ToolError("NO_SESSION", `Session '${sessionId}' not found`);
    }

    this.activeSessionId = sessionId;
  }

  markHealthy(sessionId: string): void {
    const record = this.requireSessionById(sessionId);
    record.connectionHealth = "healthy";
    record.lastReconnectError = undefined;
  }

  markReconnecting(sessionId: string): void {
    const record = this.requireSessionById(sessionId);
    record.connectionHealth = "reconnecting";
    record.reconnectAttempts += 1;
    record.lastDisconnectAt = new Date().toISOString();
  }

  markReconnectFailure(sessionId: string, message: string): void {
    const record = this.requireSessionById(sessionId);
    record.connectionHealth = "degraded";
    record.lastReconnectError = message;
    record.lastDisconnectAt = new Date().toISOString();
  }

  addCleanupForSession(sessionId: string, fn: CleanupFn): void {
    const record = this.requireSessionById(sessionId);
    record.cleanupFns.push(fn);
  }

  addCleanup(fn: CleanupFn): void {
    const record = this.resolveSession(undefined, false);
    if (!record && this.legacyConnecting) {
      this.pendingLegacyCleanupFns.push(fn);
      return;
    }
    if (!record) {
      throw new ToolError("NO_SESSION", "No active app session. Call connect_app first.");
    }
    record.cleanupFns.push(fn);
  }

  requireConnected(
    sessionId?: string,
  ): Required<Pick<SessionSummary, "sessionId" | "platform" | "deviceId" | "metroPort" | "startedAt">> {
    const record = this.resolveSession(sessionId, true);
    if (!record) {
      throw new ToolError("NO_SESSION", "No active app session. Call connect_app first.");
    }
    return {
      sessionId: record.sessionId,
      platform: record.platform,
      deviceId: record.deviceId,
      metroPort: record.metroPort,
      startedAt: record.startedAt,
    };
  }

  async closeSession(sessionId: string): Promise<void> {
    const record = this.requireSessionById(sessionId);
    const tasks = [...record.cleanupFns].reverse();
    record.cleanupFns.length = 0;

    for (const task of tasks) {
      try {
        await task();
      } catch {
        // Ignore cleanup failures so close remains idempotent.
      }
    }

    this.sessions.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.sessions.keys().next().value;
    }
  }

  getSessionSummary(sessionId?: string): SessionSummary | undefined {
    const record = this.resolveSession(sessionId, false);
    return record ? this.toSummary(record) : undefined;
  }

  private toSummary(record: SessionRecord): SessionSummary {
    return {
      sessionId: record.sessionId,
      platform: record.platform,
      status: "connected",
      deviceId: record.deviceId,
      metroPort: record.metroPort,
      startedAt: record.startedAt,
      connectionHealth: record.connectionHealth,
      reconnectAttempts: record.reconnectAttempts,
      lastDisconnectAt: record.lastDisconnectAt,
      lastReconnectError: record.lastReconnectError,
    };
  }

  private requireSessionById(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new ToolError("NO_SESSION", `Session '${sessionId}' not found`);
    }

    return record;
  }

  private resolveSession(sessionId: string | undefined, required: boolean): SessionRecord | undefined {
    if (sessionId) {
      const explicit = this.sessions.get(sessionId);
      if (!explicit && required) {
        throw new ToolError("NO_SESSION", `Session '${sessionId}' not found`);
      }
      return explicit;
    }

    if (this.activeSessionId && this.sessions.has(this.activeSessionId)) {
      return this.sessions.get(this.activeSessionId);
    }

    if (this.sessions.size === 1) {
      return this.sessions.values().next().value;
    }

    if (!required) {
      return undefined;
    }

    if (this.sessions.size === 0) {
      throw new ToolError("NO_SESSION", "No active app session. Call connect_app first.");
    }

    throw new ToolError("COMMAND_FAILED", "Multiple sessions are active. Provide sessionId.");
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  clearLegacyConnecting(): void {
    this.legacyConnecting = false;
    this.pendingLegacyCleanupFns.length = 0;
  }

  isLegacyConnecting(): boolean {
    return this.legacyConnecting;
  }

  getFallbackActiveSessionId(): string | undefined {
    if (this.activeSessionId && this.sessions.has(this.activeSessionId)) {
      return this.activeSessionId;
    }

    if (this.sessions.size === 1) {
      return this.sessions.keys().next().value;
    }

    return undefined;
  }

  async reset(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const sessionId of ids) {
      await this.closeSession(sessionId);
    }

    this.sessions.clear();
    this.activeSessionId = undefined;
    this.legacyConnecting = false;
    this.pendingLegacyCleanupFns.length = 0;
  }
}
