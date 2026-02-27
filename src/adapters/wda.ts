import { ToolError } from "../core/toolError.js";
import { networkInterfaces } from "node:os";

type WdaProtocol = "w3c" | "legacy";

interface SessionCreatePayload {
  sessionId?: unknown;
  value?: {
    sessionId?: unknown;
  };
}

interface ErrorPayload {
  error?: unknown;
  message?: unknown;
  value?: {
    error?: unknown;
    message?: unknown;
  };
}

function toObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function unwrapValue<T>(payload: unknown): T {
  const obj = toObject(payload);
  if (obj && "value" in obj) {
    return obj.value as T;
  }
  return payload as T;
}

function truncate(value: string, maxLength = 600): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...(truncated)`;
}

function getWdaError(payload: unknown): { error?: string; message?: string } {
  const candidate = payload as ErrorPayload;
  const directError = typeof candidate.error === "string" ? candidate.error : undefined;
  const directMessage = typeof candidate.message === "string" ? candidate.message : undefined;
  const nestedError = typeof candidate.value?.error === "string" ? candidate.value.error : undefined;
  const nestedMessage = typeof candidate.value?.message === "string" ? candidate.value.message : undefined;
  return {
    error: nestedError ?? directError,
    message: nestedMessage ?? directMessage,
  };
}

function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError;
}

function lower(text: unknown): string {
  return typeof text === "string" ? text.toLowerCase() : "";
}

function readDetail(error: ToolError, key: string): unknown {
  return error.details?.[key];
}

function isProtocolMismatchError(error: unknown): boolean {
  if (!isToolError(error) || error.code !== "COMMAND_FAILED") {
    return false;
  }

  const status = readDetail(error, "status");
  const wdaError = lower(readDetail(error, "wdaError"));
  const wdaMessage = lower(readDetail(error, "wdaMessage"));
  const body = lower(readDetail(error, "bodySnippet"));
  return (
    status === 404 ||
    wdaError.includes("unknown command") ||
    wdaMessage.includes("unknown command") ||
    wdaMessage.includes("unhandled endpoint") ||
    body.includes("unhandled endpoint")
  );
}

function isInvalidSessionError(error: unknown): boolean {
  if (!isToolError(error) || error.code !== "COMMAND_FAILED") {
    return false;
  }

  const wdaError = lower(readDetail(error, "wdaError"));
  const wdaMessage = lower(readDetail(error, "wdaMessage"));
  const body = lower(readDetail(error, "bodySnippet"));
  return (
    wdaError.includes("invalid session") ||
    wdaError.includes("no such driver") ||
    wdaMessage.includes("invalid session") ||
    wdaMessage.includes("session does not exist") ||
    wdaMessage.includes("no such driver") ||
    body.includes("invalid session")
  );
}

function isInvalidArgumentError(error: unknown): boolean {
  if (!isToolError(error) || error.code !== "COMMAND_FAILED") {
    return false;
  }

  const wdaError = lower(readDetail(error, "wdaError"));
  const wdaMessage = lower(readDetail(error, "wdaMessage"));
  return (
    wdaError.includes("invalid argument") ||
    wdaError.includes("invalidargument") ||
    wdaMessage.includes("invalid argument")
  );
}

function parseSessionId(payload: unknown): string | undefined {
  const data = payload as SessionCreatePayload;
  if (typeof data.sessionId === "string" && data.sessionId.length > 0) {
    return data.sessionId;
  }

  const nested = data.value?.sessionId;
  if (typeof nested === "string" && nested.length > 0) {
    return nested;
  }

  return undefined;
}

function parseWindowSize(payload: unknown): { width: number; height: number } | undefined {
  const raw = toObject(unwrapValue<unknown>(payload));
  if (!raw) {
    return undefined;
  }

  const widthRaw = raw.width;
  const heightRaw = raw.height;
  const width = typeof widthRaw === "number" ? widthRaw : Number.parseFloat(String(widthRaw));
  const height = typeof heightRaw === "number" ? heightRaw : Number.parseFloat(String(heightRaw));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return undefined;
  }

  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
}

export class WdaClient {
  private baseUrl: string;
  private readonly knownBaseUrls = new Set<string>();
  private readonly sessionsByDeviceId = new Map<string, string>();

  constructor(baseUrl: string) {
    this.baseUrl = this.normalizeBaseUrl(baseUrl);
    this.knownBaseUrls.add(this.baseUrl);
    for (const candidate of this.getLocalCandidateBaseUrls(this.baseUrl)) {
      this.knownBaseUrls.add(candidate);
    }
  }

  setBaseUrl(baseUrl: string): void {
    const normalized = this.normalizeBaseUrl(baseUrl);
    if (normalized === this.baseUrl) {
      return;
    }

    this.baseUrl = normalized;
    this.knownBaseUrls.add(normalized);
    this.sessionsByDeviceId.clear();
  }

  async checkStatus(): Promise<void> {
    const candidates = [this.baseUrl, ...Array.from(this.knownBaseUrls).filter((item) => item !== this.baseUrl)];
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        await this.requestJson<Record<string, unknown>>("/status", {
          protocol: "legacy",
          timeoutMs: 3000,
          baseUrl: candidate,
        });
        if (candidate !== this.baseUrl) {
          this.baseUrl = candidate;
          this.sessionsByDeviceId.clear();
        }
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  async ensureSession(deviceId: string): Promise<string> {
    const cached = this.sessionsByDeviceId.get(deviceId);
    if (cached) {
      return cached;
    }

    const payload = await this.requestJson<unknown>("/session", {
      protocol: "w3c",
      method: "POST",
      timeoutMs: 7000,
      body: {
        capabilities: {
          alwaysMatch: {
            platformName: "iOS",
          },
          firstMatch: [{}],
        },
      },
    });

    const sessionId = parseSessionId(payload);
    if (!sessionId) {
      throw new ToolError("COMMAND_FAILED", "WDA session creation did not return sessionId", {
        endpoint: "/session",
        protocol: "w3c",
      });
    }

    this.sessionsByDeviceId.set(deviceId, sessionId);
    return sessionId;
  }

  async deleteSession(deviceId: string): Promise<void> {
    const sessionId = this.sessionsByDeviceId.get(deviceId);
    if (!sessionId) {
      return;
    }

    try {
      await this.requestJson<unknown>(`/session/${sessionId}`, {
        protocol: "w3c",
        method: "DELETE",
        timeoutMs: 4000,
      });
    } catch {
      // Best effort cleanup.
    } finally {
      this.sessionsByDeviceId.delete(deviceId);
    }
  }

  async getSource(deviceId: string): Promise<unknown> {
    try {
      const payload = await this.withSession(deviceId, (sessionId) =>
        this.requestJson<unknown>(`/session/${sessionId}/source`, {
          protocol: "w3c",
          timeoutMs: 7000,
        }),
      );
      const value = unwrapValue<unknown>(payload);
      if (value && typeof value === "object") {
        return value;
      }
    } catch (error) {
      if (!isProtocolMismatchError(error)) {
        // Continue to legacy fallback for broader compatibility.
      }
    }

    try {
      const json = await this.requestJson<unknown>("/source?format=json", {
        protocol: "legacy",
        timeoutMs: 7000,
      });
      const value = unwrapValue<unknown>(json);
      if (value && typeof value === "object") {
        return value;
      }
    } catch {
      // Fallback to plain /source.
    }

    const fallback = await this.requestJson<unknown>("/source", {
      protocol: "legacy",
      timeoutMs: 7000,
    });
    return unwrapValue<unknown>(fallback);
  }

  async getActiveAppInfo(_deviceId: string): Promise<{ bundleId?: string; name?: string }> {
    const response = await this.requestJson<unknown>("/wda/activeAppInfo", {
      protocol: "legacy",
      timeoutMs: 5000,
    });
    const value = toObject(unwrapValue<unknown>(response)) ?? {};
    return {
      bundleId: typeof value.bundleId === "string" ? value.bundleId : undefined,
      name: typeof value.name === "string" ? value.name : undefined,
    };
  }

  async tap(deviceId: string, x: number, y: number): Promise<void> {
    try {
      await this.withSession(deviceId, (sessionId) =>
        this.requestJson<unknown>(`/session/${sessionId}/actions`, {
          protocol: "w3c",
          method: "POST",
          timeoutMs: 5000,
          body: {
            actions: [
              {
                type: "pointer",
                id: "finger1",
                parameters: { pointerType: "touch" },
                actions: [
                  { type: "pointerMove", duration: 0, x, y },
                  { type: "pointerDown", button: 0 },
                  { type: "pause", duration: 50 },
                  { type: "pointerUp", button: 0 },
                ],
              },
            ],
          },
        }),
      );
      return;
    } catch (error) {
      if (!isProtocolMismatchError(error)) {
        throw error;
      }
    }

    await this.requestJson<unknown>("/wda/tap/0", {
      protocol: "legacy",
      method: "POST",
      timeoutMs: 5000,
      body: { x, y },
    });
  }

  async typeText(deviceId: string, text: string): Promise<void> {
    try {
      await this.withSession(deviceId, async (sessionId) => {
        try {
          await this.requestJson<unknown>(`/session/${sessionId}/keys`, {
            protocol: "w3c",
            method: "POST",
            timeoutMs: 5000,
            body: { text },
          });
          return;
        } catch (error) {
          if (!isInvalidArgumentError(error)) {
            throw error;
          }
        }

        await this.requestJson<unknown>(`/session/${sessionId}/keys`, {
          protocol: "w3c",
          method: "POST",
          timeoutMs: 5000,
          body: { value: text.split("") },
        });
      });
      return;
    } catch (error) {
      if (!isProtocolMismatchError(error)) {
        throw error;
      }
    }

    await this.requestJson<unknown>("/wda/keys", {
      protocol: "legacy",
      method: "POST",
      timeoutMs: 5000,
      body: { value: text.split("") },
    });
  }

  async swipe(
    deviceId: string,
    params: { fromX: number; fromY: number; toX: number; toY: number; durationSec: number },
  ): Promise<void> {
    const durationMs = Math.max(0, Math.floor(params.durationSec * 1000));

    try {
      await this.withSession(deviceId, (sessionId) =>
        this.requestJson<unknown>(`/session/${sessionId}/actions`, {
          protocol: "w3c",
          method: "POST",
          timeoutMs: 7000,
          body: {
            actions: [
              {
                type: "pointer",
                id: "finger1",
                parameters: { pointerType: "touch" },
                actions: [
                  { type: "pointerMove", duration: 0, x: params.fromX, y: params.fromY },
                  { type: "pointerDown", button: 0 },
                  { type: "pause", duration: 80 },
                  { type: "pointerMove", duration: durationMs, x: params.toX, y: params.toY },
                  { type: "pointerUp", button: 0 },
                ],
              },
            ],
          },
        }),
      );
      return;
    } catch (error) {
      if (!isProtocolMismatchError(error)) {
        throw error;
      }
    }

    await this.requestJson<unknown>("/wda/dragfromtoforduration", {
      protocol: "legacy",
      method: "POST",
      timeoutMs: 7000,
      body: {
        fromX: params.fromX,
        fromY: params.fromY,
        toX: params.toX,
        toY: params.toY,
        duration: params.durationSec,
      },
    });
  }

  async getWindowSize(deviceId: string): Promise<{ width: number; height: number }> {
    try {
      const payload = await this.withSession(deviceId, (sessionId) =>
        this.requestJson<unknown>(`/session/${sessionId}/window/rect`, {
          protocol: "w3c",
          timeoutMs: 5000,
        }),
      );
      const parsed = parseWindowSize(payload);
      if (parsed) {
        return parsed;
      }
    } catch (error) {
      if (!isProtocolMismatchError(error)) {
        throw error;
      }
    }

    const fallback = await this.requestJson<unknown>("/window/size", {
      protocol: "legacy",
      timeoutMs: 5000,
    });
    const parsedFallback = parseWindowSize(fallback);
    if (!parsedFallback) {
      throw new ToolError("COMMAND_FAILED", "WDA window size response missing width/height", {
        endpoint: "/window/size",
        protocol: "legacy",
      });
    }
    return parsedFallback;
  }

  private async withSession<T>(deviceId: string, operation: (sessionId: string) => Promise<T>): Promise<T> {
    let sessionId = await this.ensureSession(deviceId);
    try {
      return await operation(sessionId);
    } catch (error) {
      if (!isInvalidSessionError(error)) {
        throw error;
      }
    }

    this.sessionsByDeviceId.delete(deviceId);
    sessionId = await this.ensureSession(deviceId);
    return operation(sessionId);
  }

  private async requestJson<T>(
    path: string,
    options: {
      protocol: WdaProtocol;
      method?: string;
      body?: unknown;
      timeoutMs?: number;
      baseUrl?: string;
    },
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 5000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const baseUrl = this.normalizeBaseUrl(options.baseUrl ?? this.baseUrl);
    const url = `${baseUrl}${path}`;
    const init: RequestInit = {
      method: options.method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, init);
      const text = await response.text();
      let payload: unknown;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = undefined;
        }
      }

      if (response.status < 200 || response.status >= 300) {
        const wdaError = getWdaError(payload);
        throw new ToolError("COMMAND_FAILED", `WDA request failed: ${path}`, {
          endpoint: path,
          protocol: options.protocol,
          status: response.status,
          wdaError: wdaError.error,
          wdaMessage: wdaError.message,
          bodySnippet: truncate(text),
        });
      }

      if (payload !== undefined) {
        return payload as T;
      }
      if (!text) {
        return undefined as T;
      }

      return text as T;
    } catch (error) {
      if (isToolError(error)) {
        throw error;
      }

      throw new ToolError("IOS_UNAVAILABLE", `Unable to reach WDA at ${baseUrl}`, {
        endpoint: path,
        protocol: options.protocol,
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeBaseUrl(raw: string): string {
    const trimmed = raw.trim();
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  }

  private getLocalCandidateBaseUrls(baseUrl: string): string[] {
    try {
      const parsed = new URL(baseUrl);
      const protocol = parsed.protocol;
      const port = parsed.port || (protocol === "https:" ? "443" : "80");
      const out = new Set<string>([
        `${protocol}//127.0.0.1:${port}`,
        `${protocol}//localhost:${port}`,
      ]);

      const interfaces = networkInterfaces();
      for (const entries of Object.values(interfaces)) {
        if (!entries) {
          continue;
        }
        for (const entry of entries) {
          if (!entry || entry.family !== "IPv4" || entry.internal) {
            continue;
          }
          out.add(`${protocol}//${entry.address}:${port}`);
        }
      }

      return Array.from(out);
    } catch {
      return [];
    }
  }
}
