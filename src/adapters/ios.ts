import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseWdaUiTree, type WdaUiTreeResult } from "../core/wdaUiParser.js";
import { ToolError } from "../core/toolError.js";
import type { ScrollDirection } from "../types/api.js";
import type { ProcessRunner, SpawnedProcess } from "./processRunner.js";
import { WdaClient } from "./wda.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_SCROLL_DISTANCE_RATIO = 0.5;
const DEFAULT_SCROLL_DURATION_MS = 350;
const DEFAULT_WDA_SCHEME = "WebDriverAgentRunner";
const DEFAULT_WDA_START_TIMEOUT_MS = 60_000;
const DEFAULT_WDA_POLL_INITIAL_DELAY_MS = 300;
const DEFAULT_WDA_POLL_FACTOR = 1.6;
const DEFAULT_WDA_POLL_MAX_DELAY_MS = 2500;
const DEFAULT_WDA_LOG_TAIL_CHARS = 6000;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function findPackageRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

const PACKAGE_ROOT = findPackageRoot(MODULE_DIR);
const DEFAULT_WDA_PROJECT_PATH = join(PACKAGE_ROOT, "WebDriverAgent", "WebDriverAgent.xcodeproj");

export interface IosDevice {
  id: string;
  name: string;
}

export interface IosScreenshotResult {
  png: Buffer;
  width?: number;
  height?: number;
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function parsePngDimensions(png: Buffer): { width?: number; height?: number } {
  if (png.length < 24) {
    return {};
  }
  const chunkType = png.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") {
    return {};
  }
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function assertSuccess(exitCode: number, stderr: string, action: string): void {
  if (exitCode !== 0) {
    throw new ToolError("COMMAND_FAILED", `iOS ${action} failed`, {
      exitCode,
      stderr,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function envNumber(name: string, fallback: number): number {
  const raw = envString(name);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function appendTail(current: string, chunk: string, maxChars: number): string {
  if (chunk.length >= maxChars) {
    return chunk.slice(-maxChars);
  }

  const combined = `${current}${chunk}`;
  if (combined.length <= maxChars) {
    return combined;
  }

  return combined.slice(-maxChars);
}

function findServerUrlInLogChunk(text: string): string | undefined {
  const markerMatch = text.match(/ServerURLHere->(https?:\/\/[^<\s]+)<-ServerURLHere/i);
  if (markerMatch?.[1]) {
    return markerMatch[1];
  }

  // Fallback for older WDA log formats.
  const plainMatch = text.match(/\bhttps?:\/\/[^\s"'<>]+:8100\b/i);
  return plainMatch?.[0];
}

export class IosAdapter {
  private ensureWdaInFlight?: Promise<SpawnedProcess | undefined>;

  constructor(
    private readonly runner: ProcessRunner,
    private readonly wda: WdaClient,
  ) {}

  async checkAvailability(): Promise<void> {
    const result = await this.runner.exec("xcrun", ["simctl", "list", "devices", "--json"], { timeoutMs: 5000 });
    assertSuccess(result.exitCode, result.stderr, "simctl availability check");
  }

  async ensureWdaReady(deviceId: string): Promise<SpawnedProcess | undefined> {
    if (!this.ensureWdaInFlight) {
      this.ensureWdaInFlight = this.ensureWdaReadyInternal(deviceId).finally(() => {
        this.ensureWdaInFlight = undefined;
      });
    }

    return this.ensureWdaInFlight;
  }

  async listBootedDevices(): Promise<IosDevice[]> {
    const result = await this.runner.exec("xcrun", ["simctl", "list", "devices", "--json"], { timeoutMs: 5000 });
    assertSuccess(result.exitCode, result.stderr, "simctl list devices");

    const payload = JSON.parse(result.stdout) as { devices?: Record<string, Array<Record<string, unknown>>> };
    const devices = payload.devices ?? {};
    const out: IosDevice[] = [];
    for (const runtimeDevices of Object.values(devices)) {
      for (const raw of runtimeDevices) {
        if (raw.state === "Booted" && typeof raw.udid === "string") {
          out.push({
            id: raw.udid,
            name: typeof raw.name === "string" ? raw.name : raw.udid,
          });
        }
      }
    }

    return out;
  }

  async resolveDeviceId(requested?: string): Promise<string> {
    const devices = await this.listBootedDevices();
    if (requested) {
      const found = devices.find((d) => d.id === requested);
      if (!found) {
        throw new ToolError("DEVICE_NOT_FOUND", `Requested iOS simulator '${requested}' is not booted`, {
          requested,
          available: devices.map((device) => device.id),
        });
      }
      return found.id;
    }

    const first = devices[0];
    if (!first) {
      throw new ToolError("DEVICE_NOT_FOUND", "No booted iOS simulator found");
    }
    return first.id;
  }

  async startLogStream(deviceId: string, onLine: (line: string) => void): Promise<SpawnedProcess> {
    const process = this.runner.spawn("xcrun", [
      "simctl",
      "spawn",
      deviceId,
      "log",
      "stream",
      "--style",
      "compact",
      "--level",
      "debug",
    ]);

    let pending = "";
    const consume = (chunk: string): void => {
      const combined = `${pending}${chunk}`;
      const parts = combined.split(/\r?\n/);
      pending = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (line.length > 0) {
          onLine(line);
        }
      }
    };

    process.onStdout(consume);
    process.onStderr(consume);
    return process;
  }

  async reloadViaKeyboard(): Promise<void> {
    const result = await this.runner.exec(
      "osascript",
      [
        "-e",
        'tell application "Simulator" to activate',
        "-e",
        'tell application "System Events" to keystroke "r" using {command down}',
      ],
      { timeoutMs: 4000 },
    );
    assertSuccess(result.exitCode, result.stderr, "simulator keyboard reload");
  }

  async takeScreenshot(deviceId: string): Promise<IosScreenshotResult> {
    const tempFile = join(tmpdir(), `rndb-ios-shot-${Date.now()}-${randomUUID()}.png`);
    const capture = await this.runner.exec("xcrun", ["simctl", "io", deviceId, "screenshot", tempFile], {
      timeoutMs: 7000,
    });
    assertSuccess(capture.exitCode, capture.stderr, "screenshot");

    const png = await readFile(tempFile);
    await unlink(tempFile).catch(() => {});

    if (!isPng(png)) {
      throw new ToolError("COMMAND_FAILED", "iOS screenshot is not a valid PNG");
    }

    return {
      png,
      ...parsePngDimensions(png),
    };
  }

  async getUiTree(deviceId: string, options?: { maxDepth?: number; maxNodes?: number }): Promise<WdaUiTreeResult> {
    const source = await this.wda.getSource(deviceId);
    return parseWdaUiTree(source, options ?? {});
  }

  async getActiveAppInfo(deviceId: string): Promise<{ bundleId?: string; name?: string }> {
    return this.wda.getActiveAppInfo(deviceId);
  }

  async tap(deviceId: string, x: number, y: number): Promise<void> {
    await this.wda.tap(deviceId, x, y);
  }

  async getViewportSize(deviceId: string): Promise<{ width: number; height: number }> {
    return this.wda.getWindowSize(deviceId);
  }

  async typeText(deviceId: string, text: string, submit = false): Promise<void> {
    await this.wda.typeText(deviceId, text);
    if (submit) {
      await this.wda.typeText(deviceId, "\n");
    }
  }

  async scroll(
    deviceId: string,
    direction: ScrollDirection,
    distanceRatio = DEFAULT_SCROLL_DISTANCE_RATIO,
    durationMs = DEFAULT_SCROLL_DURATION_MS,
  ): Promise<{ from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number }> {
    const size = await this.wda.getWindowSize(deviceId);
    const ratio = clamp(distanceRatio, 0.1, 0.9);
    const duration = clamp(Math.floor(durationMs), 100, 5000);
    const centerX = Math.floor(size.width / 2);
    const centerY = Math.floor(size.height / 2);
    const xTravel = Math.max(20, Math.floor(size.width * ratio));
    const yTravel = Math.max(20, Math.floor(size.height * ratio));
    const xDelta = Math.floor(xTravel / 2);
    const yDelta = Math.floor(yTravel / 2);

    let fromX = centerX;
    let toX = centerX;
    let fromY = centerY;
    let toY = centerY;

    if (direction === "down") {
      fromY = centerY + yDelta;
      toY = centerY - yDelta;
    } else if (direction === "up") {
      fromY = centerY - yDelta;
      toY = centerY + yDelta;
    } else if (direction === "right") {
      fromX = centerX + xDelta;
      toX = centerX - xDelta;
    } else {
      fromX = centerX - xDelta;
      toX = centerX + xDelta;
    }

    const safeFromX = clamp(fromX, 1, Math.max(1, size.width - 1));
    const safeToX = clamp(toX, 1, Math.max(1, size.width - 1));
    const safeFromY = clamp(fromY, 1, Math.max(1, size.height - 1));
    const safeToY = clamp(toY, 1, Math.max(1, size.height - 1));

    await this.wda.swipe(deviceId, {
      fromX: safeFromX,
      fromY: safeFromY,
      toX: safeToX,
      toY: safeToY,
      durationSec: duration / 1000,
    });

    return {
      from: { x: safeFromX, y: safeFromY },
      to: { x: safeToX, y: safeToY },
      durationMs: duration,
    };
  }

  async pressBack(deviceId: string): Promise<void> {
    const uiTree = await this.getUiTree(deviceId, { maxDepth: 8, maxNodes: 400 });
    const root = uiTree.root;
    const candidates: Array<{ x: number; y: number; score: number }> = [];

    const visit = (node: NonNullable<typeof root>): void => {
      const label = (node.text ?? node.contentDescription ?? "").toLowerCase();
      if (node.bounds && node.clickable && /(back|close|cancel)/i.test(label)) {
        const x = Math.floor((node.bounds.left + node.bounds.right) / 2);
        const y = Math.floor((node.bounds.top + node.bounds.bottom) / 2);
        const score = y + x;
        candidates.push({ x, y, score });
      }

      for (const child of node.children) {
        visit(child);
      }
    };

    if (root) {
      visit(root);
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => a.score - b.score);
      await this.wda.tap(deviceId, candidates[0].x, candidates[0].y);
      return;
    }

    const size = await this.wda.getWindowSize(deviceId);
    await this.wda.swipe(deviceId, {
      fromX: Math.floor(size.width * 0.05),
      fromY: Math.floor(size.height * 0.5),
      toX: Math.floor(size.width * 0.65),
      toY: Math.floor(size.height * 0.5),
      durationSec: 0.2,
    });
  }

  async deleteSession(deviceId: string): Promise<void> {
    await this.wda.deleteSession(deviceId);
  }

  private async ensureWdaReadyInternal(deviceId: string): Promise<SpawnedProcess | undefined> {
    try {
      await this.wda.checkStatus();
      await this.wda.ensureSession(deviceId);
      return undefined;
    } catch {
      // Fall through to xcodebuild startup.
    }

    const projectPath = envString("WDA_PROJECT_PATH") ?? DEFAULT_WDA_PROJECT_PATH;
    const scheme = envString("WDA_SCHEME") ?? DEFAULT_WDA_SCHEME;
    const timeoutMs = envNumber("WDA_START_TIMEOUT_MS", DEFAULT_WDA_START_TIMEOUT_MS);
    const tailChars = envNumber("WDA_LOG_TAIL_CHARS", DEFAULT_WDA_LOG_TAIL_CHARS);

    const spawned = this.runner.spawn("xcodebuild", [
      "-project",
      projectPath,
      "-scheme",
      scheme,
      "-destination",
      `id=${deviceId}`,
      "test",
    ]);

    let stdoutTail = "";
    let stderrTail = "";
    let discoveryTail = "";
    spawned.onStdout((chunk) => {
      stdoutTail = appendTail(stdoutTail, chunk, tailChars);
      discoveryTail = appendTail(discoveryTail, chunk, tailChars);
      const discoveredUrl = findServerUrlInLogChunk(discoveryTail);
      if (discoveredUrl) {
        this.wda.setBaseUrl(discoveredUrl);
      }
    });
    spawned.onStderr((chunk) => {
      stderrTail = appendTail(stderrTail, chunk, tailChars);
      discoveryTail = appendTail(discoveryTail, chunk, tailChars);
      const discoveredUrl = findServerUrlInLogChunk(discoveryTail);
      if (discoveredUrl) {
        this.wda.setBaseUrl(discoveredUrl);
      }
    });

    const startedAt = Date.now();
    let delayMs = DEFAULT_WDA_POLL_INITIAL_DELAY_MS;
    while (Date.now() - startedAt < timeoutMs) {
      try {
        await this.wda.checkStatus();
        await this.wda.ensureSession(deviceId);
        return spawned;
      } catch {
        // Continue retrying until timeout or process exits.
      }

      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, timeoutMs - elapsed);
      const sleepMs = Math.min(delayMs, remaining);
      const outcome = await Promise.race([
        spawned.exited.then((exit) => ({ kind: "exit" as const, exit })),
        sleep(sleepMs).then(() => ({ kind: "wait" as const })),
      ]);

      if (outcome.kind === "exit") {
        throw new ToolError("IOS_UNAVAILABLE", "WebDriverAgent failed to start", {
          deviceId,
          projectPath,
          scheme,
          exitCode: outcome.exit.code,
          signal: outcome.exit.signal,
          stdout: stdoutTail,
          stderr: stderrTail,
        });
      }

      delayMs = Math.min(Math.floor(delayMs * DEFAULT_WDA_POLL_FACTOR), DEFAULT_WDA_POLL_MAX_DELAY_MS);
    }

    throw new ToolError("IOS_UNAVAILABLE", "Timed out waiting for WebDriverAgent readiness", {
      deviceId,
      projectPath,
      scheme,
      timeoutMs,
      stdout: stdoutTail,
      stderr: stderrTail,
    });
  }
}
