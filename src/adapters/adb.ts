import { ToolError } from "../core/toolError.js";
import { parseUiAutomatorXml, pruneUiTree, type UiTreePruneOptions } from "../core/uiTreeParser.js";
import type { ProcessRunner, SpawnedProcess } from "./processRunner.js";
import type { ScrollDirection, UiNode } from "../types/api.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_SCROLL_DISTANCE_RATIO = 0.5;
const DEFAULT_SCROLL_DURATION_MS = 350;

export interface AndroidDevice {
  id: string;
  state: string;
  isEmulator: boolean;
}

export interface ScreenshotResult {
  png: Buffer;
  width?: number;
  height?: number;
}

export interface UiTreeResult {
  root?: UiNode;
  nodeCount: number;
  clickableCount: number;
  truncated: boolean;
  source: "uiautomator";
}

export interface ScrollResult {
  from: { x: number; y: number };
  to: { x: number; y: number };
  durationMs: number;
}

function assertCommandSuccess(exitCode: number, stderr: string, action: string): void {
  if (exitCode !== 0) {
    throw new ToolError("COMMAND_FAILED", `ADB ${action} failed`, {
      exitCode,
      stderr,
    });
  }
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function normalizeScreenshotPng(raw: Buffer): Buffer {
  if (isPng(raw)) {
    return raw;
  }

  const normalized = Buffer.from(raw.toString("binary").replace(/\r\n/g, "\n"), "binary");
  if (isPng(normalized)) {
    return normalized;
  }

  throw new ToolError("COMMAND_FAILED", "Screenshot output is not a valid PNG", {
    outputPreview: raw.subarray(0, 32).toString("hex"),
  });
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

function escapeAdbInputText(text: string): string {
  const spaced = text.replace(/\s/g, "%s");
  return spaced.replace(/([\\'"`$&|;<>()[\]{}*?!#~])/g, "\\$1");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class AdbAdapter {
  constructor(private readonly runner: ProcessRunner) {}

  async checkAvailability(): Promise<void> {
    try {
      const result = await this.runner.exec("adb", ["version"], { timeoutMs: 3000 });
      assertCommandSuccess(result.exitCode, result.stderr, "version");
    } catch (error) {
      throw new ToolError("ADB_UNAVAILABLE", "ADB is not available on PATH", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async listDevices(): Promise<AndroidDevice[]> {
    const result = await this.runner.exec("adb", ["devices"], { timeoutMs: 3000 });
    assertCommandSuccess(result.exitCode, result.stderr, "devices");

    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const devices: AndroidDevice[] = [];
    for (const line of lines) {
      if (line.startsWith("List of devices attached")) {
        continue;
      }

      const [id, state] = line.split(/\s+/);
      if (!id || !state) {
        continue;
      }

      devices.push({
        id,
        state,
        isEmulator: id.startsWith("emulator-"),
      });
    }

    return devices;
  }

  async resolveDeviceId(requested?: string): Promise<string> {
    const devices = await this.listDevices();
    const online = devices.filter((device) => device.state === "device");

    if (requested) {
      const found = online.find((device) => device.id === requested);
      if (!found) {
        throw new ToolError("DEVICE_NOT_FOUND", `Requested device '${requested}' is not connected`, {
          requested,
          available: online.map((device) => device.id),
        });
      }

      return found.id;
    }

    const emulator = online.find((device) => device.isEmulator);
    if (emulator) {
      return emulator.id;
    }

    throw new ToolError("DEVICE_NOT_FOUND", "No online Android emulator found", {
      available: online.map((device) => device.id),
    });
  }

  async startLogcat(deviceId: string, onLine: (line: string) => void): Promise<SpawnedProcess> {
    const process = this.runner.spawn("adb", ["-s", deviceId, "logcat", "-v", "brief"]);

    let stdoutPending = "";
    let stderrPending = "";

    const consume = (chunk: string, fromStderr = false): void => {
      const pending = fromStderr ? stderrPending : stdoutPending;
      const combined = `${pending}${chunk}`;
      const parts = combined.split(/\r?\n/);
      const nextPending = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.trim();
        if (line.length > 0) {
          onLine(line);
        }
      }

      if (fromStderr) {
        stderrPending = nextPending;
      } else {
        stdoutPending = nextPending;
      }
    };

    process.onStdout((chunk) => consume(chunk, false));
    process.onStderr((chunk) => consume(chunk, true));

    return process;
  }

  async reloadViaBroadcast(deviceId: string): Promise<void> {
    const result = await this.runner.exec(
      "adb",
      ["-s", deviceId, "shell", "am", "broadcast", "-a", "com.facebook.react.RELOAD"],
      { timeoutMs: 5000 },
    );

    assertCommandSuccess(result.exitCode, result.stderr, "reload broadcast");
  }

  async reloadViaKeyEvents(deviceId: string): Promise<void> {
    const openMenu = await this.runner.exec("adb", ["-s", deviceId, "shell", "input", "keyevent", "82"], {
      timeoutMs: 3000,
    });
    assertCommandSuccess(openMenu.exitCode, openMenu.stderr, "open dev menu");

    const pressR1 = await this.runner.exec("adb", ["-s", deviceId, "shell", "input", "keyevent", "46"], {
      timeoutMs: 3000,
    });
    assertCommandSuccess(pressR1.exitCode, pressR1.stderr, "reload keyevent");

    const pressR2 = await this.runner.exec("adb", ["-s", deviceId, "shell", "input", "keyevent", "46"], {
      timeoutMs: 3000,
    });
    assertCommandSuccess(pressR2.exitCode, pressR2.stderr, "reload keyevent");
  }

  async takeScreenshot(deviceId: string): Promise<ScreenshotResult> {
    const result = await this.runner.execBinary("adb", ["-s", deviceId, "exec-out", "screencap", "-p"], {
      timeoutMs: 5000,
    });

    if (result.exitCode !== 0) {
      throw new ToolError("COMMAND_FAILED", "Failed to capture screenshot", {
        exitCode: result.exitCode,
        stderr: result.stderr.toString("utf8"),
      });
    }

    const png = normalizeScreenshotPng(result.stdout);
    const dimensions = parsePngDimensions(png);

    return {
      png,
      ...dimensions,
    };
  }

  async tap(deviceId: string, x: number, y: number): Promise<void> {
    const result = await this.runner.exec(
      "adb",
      ["-s", deviceId, "shell", "input", "tap", String(x), String(y)],
      { timeoutMs: 4000 },
    );
    assertCommandSuccess(result.exitCode, result.stderr, "tap");
  }

  async typeText(deviceId: string, text: string, submit = false): Promise<void> {
    const escaped = escapeAdbInputText(text);
    const typeResult = await this.runner.exec("adb", ["-s", deviceId, "shell", "input", "text", escaped], {
      timeoutMs: 5000,
    });
    assertCommandSuccess(typeResult.exitCode, typeResult.stderr, "type text");

    if (!submit) {
      return;
    }

    const submitResult = await this.runner.exec("adb", ["-s", deviceId, "shell", "input", "keyevent", "66"], {
      timeoutMs: 3000,
    });
    assertCommandSuccess(submitResult.exitCode, submitResult.stderr, "submit text");
  }

  async pressBack(deviceId: string): Promise<void> {
    const result = await this.runner.exec("adb", ["-s", deviceId, "shell", "input", "keyevent", "4"], {
      timeoutMs: 3000,
    });
    assertCommandSuccess(result.exitCode, result.stderr, "press back");
  }

  async scroll(
    deviceId: string,
    direction: ScrollDirection,
    distanceRatio = DEFAULT_SCROLL_DISTANCE_RATIO,
    durationMs = DEFAULT_SCROLL_DURATION_MS,
  ): Promise<ScrollResult> {
    const display = await this.getDisplaySize(deviceId);
    const ratio = clamp(distanceRatio, 0.1, 0.9);
    const duration = clamp(Math.floor(durationMs), 100, 5000);

    const centerX = Math.floor(display.width / 2);
    const centerY = Math.floor(display.height / 2);
    const xTravel = Math.max(40, Math.floor(display.width * ratio));
    const yTravel = Math.max(40, Math.floor(display.height * ratio));
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

    const safeFromX = clamp(fromX, 1, Math.max(1, display.width - 1));
    const safeToX = clamp(toX, 1, Math.max(1, display.width - 1));
    const safeFromY = clamp(fromY, 1, Math.max(1, display.height - 1));
    const safeToY = clamp(toY, 1, Math.max(1, display.height - 1));

    const result = await this.runner.exec(
      "adb",
      [
        "-s",
        deviceId,
        "shell",
        "input",
        "swipe",
        String(safeFromX),
        String(safeFromY),
        String(safeToX),
        String(safeToY),
        String(duration),
      ],
      { timeoutMs: 5000 },
    );
    assertCommandSuccess(result.exitCode, result.stderr, "scroll");

    return {
      from: { x: safeFromX, y: safeFromY },
      to: { x: safeToX, y: safeToY },
      durationMs: duration,
    };
  }

  async getActivityDump(deviceId: string): Promise<string> {
    const result = await this.runner.exec(
      "adb",
      ["-s", deviceId, "shell", "dumpsys", "activity", "activities"],
      { timeoutMs: 6000 },
    );
    assertCommandSuccess(result.exitCode, result.stderr, "dumpsys activity activities");
    return result.stdout;
  }

  async getWindowDump(deviceId: string): Promise<string> {
    const result = await this.runner.exec("adb", ["-s", deviceId, "shell", "dumpsys", "window", "windows"], {
      timeoutMs: 6000,
    });
    assertCommandSuccess(result.exitCode, result.stderr, "dumpsys window windows");
    return result.stdout;
  }

  async getUiTree(deviceId: string, options: UiTreePruneOptions = {}): Promise<UiTreeResult> {
    const remotePath = "/sdcard/rndb-ui-dump.xml";

    const dump = await this.runner.exec(
      "adb",
      ["-s", deviceId, "shell", "uiautomator", "dump", remotePath],
      { timeoutMs: 7000 },
    );
    assertCommandSuccess(dump.exitCode, dump.stderr, "uiautomator dump");

    const read = await this.runner.exec("adb", ["-s", deviceId, "shell", "cat", remotePath], { timeoutMs: 7000 });
    assertCommandSuccess(read.exitCode, read.stderr, "ui dump read");

    const xml = read.stdout.trim();
    if (!xml.includes("<hierarchy") || !xml.includes("<node")) {
      throw new ToolError("COMMAND_FAILED", "Invalid UI hierarchy XML from Android device", {
        outputPreview: xml.slice(0, 160),
      });
    }

    const parsed = parseUiAutomatorXml(xml);
    const pruned = pruneUiTree(parsed.root, options);

    return {
      root: pruned.root,
      nodeCount: pruned.nodeCount,
      clickableCount: pruned.clickableCount,
      truncated: pruned.truncated,
      source: "uiautomator",
    };
  }

  private async getDisplaySize(deviceId: string): Promise<{ width: number; height: number }> {
    const result = await this.runner.exec("adb", ["-s", deviceId, "shell", "wm", "size"], {
      timeoutMs: 4000,
    });
    assertCommandSuccess(result.exitCode, result.stderr, "wm size");

    const physicalMatch = result.stdout.match(/Physical size:\s*(\d+)x(\d+)/i);
    const fallbackMatch = result.stdout.match(/(\d+)x(\d+)/);
    const match = physicalMatch ?? fallbackMatch;
    if (!match) {
      throw new ToolError("COMMAND_FAILED", "Failed to parse Android display size", {
        outputPreview: result.stdout.slice(0, 120),
      });
    }

    const width = Number.parseInt(match[1], 10);
    const height = Number.parseInt(match[2], 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new ToolError("COMMAND_FAILED", "Invalid Android display size", { width, height });
    }

    return { width, height };
  }
}
