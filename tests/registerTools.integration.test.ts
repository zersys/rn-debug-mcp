import test from "node:test";
import assert from "node:assert/strict";
import { LogBuffer } from "../src/core/logBuffer.js";
import { NetworkBuffer } from "../src/core/networkBuffer.js";
import { SessionManager } from "../src/core/sessionManager.js";
import { ToolError } from "../src/core/toolError.js";
import { registerTools, type AdbToolAdapter, type MetroToolAdapter } from "../src/server/registerTools.js";
import type { ScreenshotResult } from "../src/adapters/adb.js";
import type { SpawnedProcess } from "../src/adapters/processRunner.js";
import type { UiNode } from "../src/types/api.js";

interface ToolResponse {
  isError?: boolean;
  structuredContent?: unknown;
  content?: Array<Record<string, unknown>>;
}

type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResponse>;

class FakeServer {
  public readonly handlers = new Map<string, ToolHandler>();

  tool(name: string, _description: string, _schema: unknown, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  registerTool(name: string, _config: unknown, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }
}

class FakeSpawnedProcess implements SpawnedProcess {
  public stopped = false;
  public exited = Promise.resolve({ code: 0, signal: null as NodeJS.Signals | null });

  onStdout(): void {}
  onStderr(): void {}

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

class FakeAdb implements AdbToolAdapter {
  public readonly logcat = new FakeSpawnedProcess();
  public keyReloadCalls = 0;
  public broadcastReloadCalls = 0;
  public backPresses = 0;
  public failBroadcastReload = false;
  public failAvailabilityTimes = 0;
  public failResolveTimes = 0;
  public failStartLogcatTimes = 0;
  public failBroadcastTimes = 0;
  public failKeyReloadTimes = 0;
  public uiTreeCalls = 0;
  public lastUiTreeOptions?: { maxDepth?: number; maxNodes?: number };
  public taps: Array<{ x: number; y: number }> = [];
  public typed: Array<{ text: string; submit: boolean }> = [];
  public scrollCalls: Array<{
    direction: "up" | "down" | "left" | "right";
    distanceRatio?: number;
    durationMs?: number;
  }> = [];

  async checkAvailability(): Promise<void> {
    if (this.failAvailabilityTimes > 0) {
      this.failAvailabilityTimes -= 1;
      throw new ToolError("ADB_UNAVAILABLE", "adb warming up");
    }
  }

  async resolveDeviceId(requested?: string): Promise<string> {
    if (this.failResolveTimes > 0) {
      this.failResolveTimes -= 1;
      throw new ToolError("DEVICE_NOT_FOUND", "emulator not ready");
    }
    return requested ?? "emulator-5554";
  }

  async startLogcat(_deviceId: string, onLine: (line: string) => void): Promise<SpawnedProcess> {
    if (this.failStartLogcatTimes > 0) {
      this.failStartLogcatTimes -= 1;
      throw new ToolError("COMMAND_FAILED", "logcat not ready");
    }
    onLine("02-26 18:10:22.123 I/ReactNativeJS(1234): console info");
    onLine("02-26 18:10:22.124 E/ReactNativeJS(1234): Unhandled JS Exception: boom");
    return this.logcat;
  }

  async reloadViaBroadcast(_deviceId: string): Promise<void> {
    this.broadcastReloadCalls += 1;
    if (this.failBroadcastReload || this.failBroadcastTimes > 0) {
      if (this.failBroadcastTimes > 0) {
        this.failBroadcastTimes -= 1;
      }
      throw new Error("broadcast failed");
    }
  }

  async reloadViaKeyEvents(_deviceId: string): Promise<void> {
    this.keyReloadCalls += 1;
    if (this.failKeyReloadTimes > 0) {
      this.failKeyReloadTimes -= 1;
      throw new ToolError("COMMAND_FAILED", "key reload failed");
    }
  }

  async takeScreenshot(_deviceId: string): Promise<ScreenshotResult> {
    return {
      png: Buffer.from("iVBORw0KGgo=", "base64"),
      width: 1,
      height: 1,
    };
  }

  async tap(_deviceId: string, x: number, y: number): Promise<void> {
    this.taps.push({ x, y });
  }

  async typeText(_deviceId: string, text: string, submit = false): Promise<void> {
    this.typed.push({ text, submit });
  }

  async pressBack(_deviceId: string): Promise<void> {
    this.backPresses += 1;
  }

  async scroll(
    _deviceId: string,
    direction: "up" | "down" | "left" | "right",
    distanceRatio?: number,
    durationMs?: number,
  ): Promise<{ from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number }> {
    this.scrollCalls.push({ direction, distanceRatio, durationMs });
    return {
      from: { x: 540, y: 1620 },
      to: { x: 540, y: 540 },
      durationMs: durationMs ?? 350,
    };
  }

  async getActivityDump(_deviceId: string): Promise<string> {
    return "mResumedActivity: ActivityRecord{111 u0 com.app/.CheckoutActivity t123}";
  }

  async getWindowDump(_deviceId: string): Promise<string> {
    return "mCurrentFocus=Window{222 u0 com.app/com.app.CheckoutActivity}";
  }

  async getUiTree(
    _deviceId: string,
    options?: { maxDepth?: number; maxNodes?: number },
  ): Promise<{
    root?: UiNode;
    nodeCount: number;
    clickableCount: number;
    truncated: boolean;
    source: "uiautomator";
  }> {
    this.uiTreeCalls += 1;
    this.lastUiTreeOptions = options;
    return {
      root: {
        id: "node-1",
        className: "android.widget.FrameLayout",
        clickable: false,
        enabled: true,
        focusable: false,
        focused: false,
        selected: false,
        visibleToUser: true,
        scrollable: false,
        checkable: false,
        checked: false,
        bounds: { left: 0, top: 0, right: 1080, bottom: 2160, width: 1080, height: 2160 },
        resourceId: "com.app:id/root_container",
        children: [
          {
            id: "node-2",
            className: "android.widget.Button",
            text: "Save",
            resourceId: "com.app:id/save_button",
            clickable: true,
            enabled: true,
            focusable: true,
            focused: false,
            selected: false,
            visibleToUser: true,
            scrollable: false,
            checkable: false,
            checked: false,
            bounds: { left: 100, top: 1800, right: 980, bottom: 2000, width: 880, height: 200 },
            children: [],
          },
        ],
      },
      nodeCount: 2,
      clickableCount: 1,
      truncated: false,
      source: "uiautomator",
    };
  }
}

class FakeMetro implements MetroToolAdapter {
  public failStatus = false;
  public failReload = false;
  public failStatusTimes = 0;
  public failReloadTimes = 0;
  public checkStatusCalls = 0;
  public reloadCalls = 0;

  async checkStatus(_port: number): Promise<void> {
    this.checkStatusCalls += 1;
    if (this.failStatusTimes > 0) {
      this.failStatusTimes -= 1;
      throw new ToolError("METRO_UNREACHABLE", "Metro still booting");
    }
    if (this.failStatus) {
      throw new ToolError("METRO_UNREACHABLE", "Metro unreachable");
    }
  }

  async probeInspector(_port: number): Promise<void> {}

  async reload(_port: number): Promise<void> {
    this.reloadCalls += 1;
    if (this.failReloadTimes > 0) {
      this.failReloadTimes -= 1;
      throw new ToolError("COMMAND_FAILED", "reload transient failure");
    }
    if (this.failReload) {
      throw new ToolError("COMMAND_FAILED", "reload failed");
    }
  }
}

function getHandler(server: FakeServer, name: string): ToolHandler {
  const handler = server.handlers.get(name);
  assert.ok(handler, `Missing handler: ${name}`);
  return handler;
}

test("registerTools connect/get logs+errors/disconnect flow", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();
  const metro = new FakeMetro();

  registerTools(server as unknown as never, {
    adb,
    metro,
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getLogs = getHandler(server, "get_logs");
  const getErrors = getHandler(server, "get_errors");
  const disconnect = getHandler(server, "disconnect_app");

  const connectResult = await connect({});
  assert.equal(connectResult.isError, undefined);
  const connectedPayload = connectResult.structuredContent as {
    connected: boolean;
    deviceId: string;
    capabilities: string[];
  };
  assert.equal(connectedPayload.connected, true);
  assert.equal(connectedPayload.deviceId, "emulator-5554");
  assert.equal(connectedPayload.capabilities.includes("type_text"), true);
  assert.equal(connectedPayload.capabilities.includes("press_back"), true);
  assert.equal(connectedPayload.capabilities.includes("scroll"), true);
  assert.equal(connectedPayload.capabilities.includes("get_network_requests"), true);

  const logsResult = await getLogs({ sinceCursor: 0 });
  const logsPayload = logsResult.structuredContent as { items: Array<{ level: string }> };
  assert.equal(logsPayload.items.length, 1);
  assert.equal(logsPayload.items[0].level, "info");

  const errorsResult = await getErrors({ sinceCursor: 0 });
  const errorsPayload = errorsResult.structuredContent as { items: Array<{ level: string }> };
  assert.equal(errorsPayload.items.length, 1);
  assert.equal(errorsPayload.items[0].level, "error");

  await disconnect({});
  assert.equal(adb.logcat.stopped, true);
});

test("registerTools returns METRO_UNREACHABLE on connect failure", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();
  const metro = new FakeMetro();
  metro.failStatus = true;

  registerTools(server as unknown as never, {
    adb,
    metro,
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const result = await connect({});
  assert.equal(result.isError, true);

  const errorPayload = result.structuredContent as { code: string };
  assert.equal(errorPayload.code, "METRO_UNREACHABLE");
});

test("registerTools retries transient failures during connect_app", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();
  const metro = new FakeMetro();
  adb.failResolveTimes = 1;
  adb.failStartLogcatTimes = 1;
  metro.failStatusTimes = 1;

  registerTools(server as unknown as never, {
    adb,
    metro,
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const result = await connect({});

  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as { connected: boolean };
  assert.equal(payload.connected, true);
  assert.equal(metro.checkStatusCalls, 2);
});

test("registerTools reload_app falls back to adb key events", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();
  const metro = new FakeMetro();
  metro.failReload = true;
  adb.failBroadcastReload = true;

  registerTools(server as unknown as never, {
    adb,
    metro,
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const reload = getHandler(server, "reload_app");

  await connect({});
  const reloadResult = await reload({});
  assert.equal(reloadResult.isError, undefined);

  const payload = reloadResult.structuredContent as { method: string };
  assert.equal(payload.method, "adb_fallback");
  assert.equal(adb.broadcastReloadCalls, 3);
  assert.equal(adb.keyReloadCalls, 1);
});

test("registerTools retries transient metro reload failures before fallback", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();
  const metro = new FakeMetro();
  metro.failReloadTimes = 2;

  registerTools(server as unknown as never, {
    adb,
    metro,
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const reload = getHandler(server, "reload_app");

  await connect({});
  const reloadResult = await reload({});
  assert.equal(reloadResult.isError, undefined);

  const payload = reloadResult.structuredContent as { method: string };
  assert.equal(payload.method, "metro");
  assert.equal(metro.reloadCalls, 3);
  assert.equal(adb.broadcastReloadCalls, 0);
});

test("registerTools enforces NO_SESSION for session tools", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const getLogs = getHandler(server, "get_logs");
  const result = await getLogs({});

  assert.equal(result.isError, true);
  const payload = result.structuredContent as { code: string };
  assert.equal(payload.code, "NO_SESSION");
});

test("registerTools get_ui_tree returns accessibility hierarchy", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();

  registerTools(server as unknown as never, {
    adb,
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getUiTree = getHandler(server, "get_ui_tree");
  await connect({});

  const result = await getUiTree({ maxDepth: 10, maxNodes: 200 });
  assert.equal(result.isError, undefined);
  assert.equal(adb.uiTreeCalls, 1);

  const payload = result.structuredContent as Record<string, unknown>;
  assert.equal(payload.platform, "android");
  assert.equal(payload.source, "uiautomator");
  assert.equal(payload.nodeCount, 2);
  assert.equal(payload.clickableCount, 1);
  assert.equal(payload.truncated, false);
  assert.equal(payload.maxDepth, 10);
  assert.equal(payload.maxNodes, 200);
  assert.equal(adb.lastUiTreeOptions?.maxDepth, 10);
  assert.equal(adb.lastUiTreeOptions?.maxNodes, 200);
});

test("registerTools get_screen_context returns activity and title context", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getScreenContext = getHandler(server, "get_screen_context");
  await connect({});

  const result = await getScreenContext({});
  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as Record<string, unknown>;
  assert.equal(payload.platform, "android");
  assert.equal(payload.packageName, "com.app");
  assert.equal(payload.activityShort, "CheckoutActivity");
  assert.equal(payload.primaryTitle, "Save");
  assert.equal(payload.screenSlug, "checkout.save");
});

test("registerTools get_test_id_remediation_plan returns deterministic guidance", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const remediation = getHandler(server, "get_test_id_remediation_plan");
  await connect({});

  const result = await remediation({ desiredAction: "tap submit button", desiredTestId: "SubmitButton" });
  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as Record<string, unknown>;
  assert.equal(typeof payload.suggestedTestId, "string");
  assert.equal((payload.suggestedTestId as string).includes("."), true);
  assert.equal(payload.matchMode, "exact");
  assert.equal(Array.isArray(payload.nextSteps), true);
  assert.equal(Array.isArray((payload.patchHint as Record<string, unknown>).searchTerms), true);
});

test("registerTools tap sends coordinate tap command", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();

  registerTools(server as unknown as never, {
    adb,
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const tap = getHandler(server, "tap");
  await connect({});

  const result = await tap({ x: 123, y: 456 });
  assert.equal(result.isError, undefined);
  assert.deepEqual(adb.taps, [{ x: 123, y: 456 }]);

  const payload = result.structuredContent as Record<string, unknown>;
  assert.equal(payload.method, "coordinates");
  assert.equal(payload.x, 123);
  assert.equal(payload.y, 456);
});

test("registerTools type_text sends text input with submit option", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();

  registerTools(server as unknown as never, {
    adb,
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const typeText = getHandler(server, "type_text");
  await connect({});

  const result = await typeText({ text: "user@example.com", submit: true });
  assert.equal(result.isError, undefined);
  assert.deepEqual(adb.typed, [{ text: "user@example.com", submit: true }]);

  const payload = result.structuredContent as Record<string, unknown>;
  assert.equal(payload.typed, true);
  assert.equal(payload.textLength, 16);
  assert.equal(payload.submitted, true);
});

test("registerTools press_back sends Android back key event", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();

  registerTools(server as unknown as never, {
    adb,
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const pressBack = getHandler(server, "press_back");
  await connect({});

  const result = await pressBack({});
  assert.equal(result.isError, undefined);
  assert.equal(adb.backPresses, 1);

  const payload = result.structuredContent as Record<string, unknown>;
  assert.equal(payload.pressed, true);
  assert.equal(payload.key, "back");
});

test("registerTools scroll performs directional swipe and returns coordinates", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();

  registerTools(server as unknown as never, {
    adb,
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const scroll = getHandler(server, "scroll");
  await connect({});

  const result = await scroll({ direction: "down", distanceRatio: 0.6, durationMs: 420 });
  assert.equal(result.isError, undefined);
  assert.deepEqual(adb.scrollCalls, [{ direction: "down", distanceRatio: 0.6, durationMs: 420 }]);

  const payload = result.structuredContent as Record<string, unknown>;
  assert.equal(payload.scrolled, true);
  assert.equal(payload.direction, "down");
  assert.equal(payload.durationMs, 420);
});

test("registerTools tap_element resolves node center and taps", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();

  registerTools(server as unknown as never, {
    adb,
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const tapElement = getHandler(server, "tap_element");
  await connect({});

  const result = await tapElement({ elementId: "node-2", maxDepth: 12, maxNodes: 300 });
  assert.equal(result.isError, undefined);
  assert.deepEqual(adb.taps, [{ x: 540, y: 1900 }]);
  assert.equal(adb.lastUiTreeOptions?.maxDepth, 12);
  assert.equal(adb.lastUiTreeOptions?.maxNodes, 300);

  const payload = result.structuredContent as Record<string, unknown>;
  assert.equal(payload.method, "element");
  assert.equal(payload.elementId, "node-2");
  assert.equal(payload.x, 540);
  assert.equal(payload.y, 1900);
});

test("registerTools tap_element returns error when element is missing", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const tapElement = getHandler(server, "tap_element");
  await connect({});

  const result = await tapElement({ elementId: "missing-node" });
  assert.equal(result.isError, true);
  const payload = result.structuredContent as Record<string, unknown>;
  assert.equal(payload.code, "COMMAND_FAILED");
});

test("registerTools get_visible_elements defaults to clickable and labeled", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getVisible = getHandler(server, "get_visible_elements");
  const getScreenTestIds = getHandler(server, "get_screen_test_ids");
  await connect({});

  const result = await getVisible({});
  assert.equal(result.isError, undefined);

  const payload = result.structuredContent as Record<string, unknown>;
  assert.equal(payload.platform, "android");
  assert.equal(payload.source, "uiautomator");
  assert.equal(payload.count, 1);
  assert.equal(payload.totalCandidates, 1);
  assert.equal(payload.clickableOnly, true);
  assert.equal(payload.includeTextless, false);
  assert.equal(payload.skipVisibilityCheck, true);
  assert.equal(payload.resolutionStrategy, "none");
  assert.equal(payload.recommendedFallback, "tap_element");

  const elements = payload.elements as Array<Record<string, unknown>>;
  assert.equal(elements.length, 1);
  assert.equal(elements[0].id, "node-2");
  assert.equal(elements[0].label, "Save");
  assert.equal(elements[0].testId, "save_button");
});

test("registerTools get_visible_elements supports non-clickable and textless inclusion", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getVisible = getHandler(server, "get_visible_elements");
  const getScreenTestIds = getHandler(server, "get_screen_test_ids");
  await connect({});

  const result = await getVisible({ clickableOnly: false, includeTextless: true, limit: 10 });
  assert.equal(result.isError, undefined);

  const payload = result.structuredContent as Record<string, unknown>;
  assert.equal(payload.count, 2);
  assert.equal(payload.totalCandidates, 2);
  assert.equal(payload.clickableOnly, false);
  assert.equal(payload.includeTextless, true);
  assert.equal(payload.skipVisibilityCheck, true);
  assert.equal(payload.limit, 10);
  assert.equal(payload.resolutionStrategy, "none");
});

test("registerTools get_visible_elements supports opt-in visibleToUser filtering", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();
  adb.getUiTree = async () => ({
    root: {
      id: "root",
      className: "android.widget.FrameLayout",
      clickable: false,
      enabled: true,
      focusable: false,
      focused: false,
      selected: false,
      visibleToUser: true,
      scrollable: false,
      checkable: false,
      checked: false,
      children: [
        {
          id: "visible-node",
          className: "android.widget.TextView",
          text: "Visible",
          clickable: false,
          enabled: true,
          focusable: false,
          focused: false,
          selected: false,
          visibleToUser: true,
          scrollable: false,
          checkable: false,
          checked: false,
          children: [],
        },
        {
          id: "hidden-node",
          className: "android.widget.TextView",
          text: "Hidden",
          clickable: false,
          enabled: true,
          focusable: false,
          focused: false,
          selected: false,
          visibleToUser: false,
          scrollable: false,
          checkable: false,
          checked: false,
          children: [],
        },
      ],
    },
    nodeCount: 3,
    clickableCount: 0,
    truncated: false,
    source: "uiautomator" as const,
  });

  registerTools(server as unknown as never, {
    adb,
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getVisible = getHandler(server, "get_visible_elements");
  await connect({});

  const defaultResult = await getVisible({ clickableOnly: false, includeTextless: true });
  const defaultPayload = defaultResult.structuredContent as Record<string, unknown>;
  assert.equal(defaultPayload.count, 3);
  assert.equal(defaultPayload.skipVisibilityCheck, true);

  const visibleOnlyResult = await getVisible({
    clickableOnly: false,
    includeTextless: true,
    skipVisibilityCheck: false,
  });
  const visibleOnlyPayload = visibleOnlyResult.structuredContent as Record<string, unknown>;
  assert.equal(visibleOnlyPayload.count, 2);
  assert.equal(visibleOnlyPayload.skipVisibilityCheck, false);
});

test("registerTools get_visible_elements filters by testId", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getVisible = getHandler(server, "get_visible_elements");
  const getScreenTestIds = getHandler(server, "get_screen_test_ids");
  await connect({});

  const exactResult = await getVisible({ testId: "save_button" });
  const exactPayload = exactResult.structuredContent as Record<string, unknown>;
  assert.equal(exactPayload.count, 1);
  assert.equal(exactPayload.queryTestId, "save_button");
  assert.equal(exactPayload.testIdMatch, "exact");
  assert.equal(exactPayload.resolutionStrategy, "test_id_exact");

  const containsResult = await getVisible({ testId: "save", testIdMatch: "contains" });
  const containsPayload = containsResult.structuredContent as Record<string, unknown>;
  assert.equal(containsPayload.count, 1);
  assert.equal(containsPayload.testIdMatch, "contains");
  assert.equal(containsPayload.resolutionStrategy, "test_id_contains");

  const idsResult = await getScreenTestIds({});
  const idsPayload = idsResult.structuredContent as Record<string, unknown>;
  assert.equal(idsPayload.count, 2);
  assert.equal(Array.isArray(idsPayload.testIds), true);
  assert.deepEqual(idsPayload.testIds as string[], ["root_container", "save_button"]);
});

test("registerTools get_screen_test_ids honors filters", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getScreenTestIds = getHandler(server, "get_screen_test_ids");
  await connect({});

  const clickableOnly = await getScreenTestIds({ includeNonClickable: false });
  const clickablePayload = clickableOnly.structuredContent as Record<string, unknown>;
  assert.equal(clickablePayload.count, 1);
  assert.deepEqual(clickablePayload.testIds as string[], ["save_button"]);
});

test("registerTools get_screen_test_ids includes invisible nodes by default", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();
  adb.getUiTree = async () => ({
    root: {
      id: "root",
      className: "android.widget.FrameLayout",
      clickable: false,
      enabled: true,
      focusable: false,
      focused: false,
      selected: false,
      visibleToUser: true,
      scrollable: false,
      checkable: false,
      checked: false,
      children: [
        {
          id: "visible",
          className: "android.widget.Button",
          resourceId: "com.app:id/visible_button",
          clickable: true,
          enabled: true,
          focusable: true,
          focused: false,
          selected: false,
          visibleToUser: true,
          scrollable: false,
          checkable: false,
          checked: false,
          children: [],
        },
        {
          id: "invisible",
          className: "android.widget.Button",
          resourceId: "com.app:id/invisible_button",
          clickable: true,
          enabled: true,
          focusable: true,
          focused: false,
          selected: false,
          visibleToUser: false,
          scrollable: false,
          checkable: false,
          checked: false,
          children: [],
        },
      ],
    },
    nodeCount: 3,
    clickableCount: 2,
    truncated: false,
    source: "uiautomator" as const,
  });

  registerTools(server as unknown as never, {
    adb,
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getScreenTestIds = getHandler(server, "get_screen_test_ids");
  await connect({});

  const defaultResult = await getScreenTestIds({});
  const defaultPayload = defaultResult.structuredContent as Record<string, unknown>;
  assert.equal(defaultPayload.includeInvisible, true);
  assert.equal(defaultPayload.count, 2);
  assert.deepEqual(defaultPayload.testIds as string[], ["invisible_button", "visible_button"]);

  const visibleOnlyResult = await getScreenTestIds({ includeInvisible: false });
  const visibleOnlyPayload = visibleOnlyResult.structuredContent as Record<string, unknown>;
  assert.equal(visibleOnlyPayload.includeInvisible, false);
  assert.equal(visibleOnlyPayload.count, 1);
  assert.deepEqual(visibleOnlyPayload.testIds as string[], ["visible_button"]);
});

test("registerTools get_elements_by_test_id returns matching elements", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getByTestId = getHandler(server, "get_elements_by_test_id");
  await connect({});

  const result = await getByTestId({ testId: "save_button", clickableOnly: true });
  assert.equal(result.isError, undefined);

  const payload = result.structuredContent as Record<string, unknown>;
  assert.equal(payload.count, 1);
  assert.equal(payload.queryTestId, "save_button");
  assert.equal(payload.testIdMatch, "exact");
  assert.equal(payload.resolutionStrategy, "test_id_exact");
  assert.equal(payload.recommendedFallback, "tap_element");
  const elements = payload.elements as Array<Record<string, unknown>>;
  assert.equal(elements[0].id, "node-2");
  assert.equal(elements[0].testId, "save_button");
});

test("registerTools get_elements_by_test_id suggests add_test_id when missing", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getByTestId = getHandler(server, "get_elements_by_test_id");
  await connect({});

  const result = await getByTestId({ testId: "missing_id", clickableOnly: true });
  const payload = result.structuredContent as Record<string, unknown>;
  assert.equal(payload.count, 0);
  assert.equal(payload.resolutionStrategy, "none");
  assert.equal(payload.recommendedFallback, "add_test_id");
});

test("registerTools applies levels/tags/sources filters to get_logs and get_errors", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getLogs = getHandler(server, "get_logs");
  const getErrors = getHandler(server, "get_errors");

  await connect({});

  const logsBySource = await getLogs({ sources: ["logcat"], levels: ["info"] });
  const logsSourcePayload = logsBySource.structuredContent as { items: Array<{ level: string; source: string }> };
  assert.equal(logsSourcePayload.items.length, 1);
  assert.equal(logsSourcePayload.items[0].level, "info");
  assert.equal(logsSourcePayload.items[0].source, "logcat");

  const logsByTagMiss = await getLogs({ tags: ["NotATag"] });
  const logsTagMissPayload = logsByTagMiss.structuredContent as { items: Array<unknown>; nextCursor: number };
  assert.equal(logsTagMissPayload.items.length, 0);
  assert.equal(logsTagMissPayload.nextCursor > 0, true);

  const errorsByTag = await getErrors({ tags: ["reactnativejs"], levels: ["error"], sources: ["logcat"] });
  const errorsByTagPayload = errorsByTag.structuredContent as { items: Array<{ level: string; tag: string }> };
  assert.equal(errorsByTagPayload.items.length, 1);
  assert.equal(errorsByTagPayload.items[0].level, "error");
  assert.equal(errorsByTagPayload.items[0].tag, "ReactNativeJS");
});

test("registerTools get_network_requests returns parsed network events with filters", async () => {
  const server = new FakeServer();
  const adb = new FakeAdb();

  adb.startLogcat = async (_deviceId: string, onLine: (line: string) => void): Promise<SpawnedProcess> => {
    onLine("02-26 18:10:22.130 I/OkHttp(1234): --> GET https://api.example.com/login");
    onLine("02-26 18:10:22.180 I/OkHttp(1234): <-- 401 https://api.example.com/login (50ms)");
    onLine("02-26 18:10:22.181 E/ReactNativeJS(1234): Network request failed: https://api.example.com/login");
    return adb.logcat;
  };

  registerTools(server as unknown as never, {
    adb,
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getNetworkRequests = getHandler(server, "get_network_requests");

  await connect({});

  const allResult = await getNetworkRequests({});
  assert.equal(allResult.isError, undefined);
  const allPayload = allResult.structuredContent as { items: Array<Record<string, unknown>> };
  assert.equal(allPayload.items.length, 3);
  assert.equal(allPayload.items[0].phase, "request");
  assert.equal(allPayload.items[1].phase, "response");
  assert.equal(allPayload.items[2].phase, "error");

  const filteredResult = await getNetworkRequests({
    phases: ["response"],
    statuses: [401],
    urlContains: "login",
  });
  const filteredPayload = filteredResult.structuredContent as { items: Array<Record<string, unknown>> };
  assert.equal(filteredPayload.items.length, 1);
  assert.equal(filteredPayload.items[0].status, 401);
  assert.equal(filteredPayload.items[0].url, "https://api.example.com/login");
});

test("registerTools get_connection_status reflects lifecycle", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const status = getHandler(server, "get_connection_status");
  const connect = getHandler(server, "connect_app");
  const disconnect = getHandler(server, "disconnect_app");

  const beforeConnect = await status({});
  const beforePayload = beforeConnect.structuredContent as Record<string, unknown>;
  assert.equal(beforePayload.status, "disconnected");
  assert.equal(beforePayload.logBufferSize, 0);
  assert.equal(beforePayload.networkBufferSize, 0);

  await connect({});
  const afterConnect = await status({});
  const connectedPayload = afterConnect.structuredContent as Record<string, unknown>;
  assert.equal(connectedPayload.status, "connected");
  assert.equal(connectedPayload.deviceId, "emulator-5554");
  assert.equal(typeof connectedPayload.startedAt, "string");
  assert.equal(connectedPayload.logBufferSize, 2);
  assert.equal(connectedPayload.networkBufferSize, 0);

  await disconnect({});
  const afterDisconnect = await status({});
  const disconnectedPayload = afterDisconnect.structuredContent as Record<string, unknown>;
  assert.equal(disconnectedPayload.status, "disconnected");
  assert.equal(disconnectedPayload.logBufferSize, 0);
  assert.equal(disconnectedPayload.networkBufferSize, 0);
});

test("registerTools keeps active session when connect_app is called twice", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getLogs = getHandler(server, "get_logs");

  const firstConnect = await connect({});
  assert.equal(firstConnect.isError, undefined);

  const secondConnect = await connect({});
  assert.equal(secondConnect.isError, true);
  const connectError = secondConnect.structuredContent as { code: string };
  assert.equal(connectError.code, "COMMAND_FAILED");

  const logsResult = await getLogs({ sinceCursor: 0 });
  assert.equal(logsResult.isError, undefined);
});

test("registerTools output contracts stay stable", async () => {
  const server = new FakeServer();

  registerTools(server as unknown as never, {
    adb: new FakeAdb(),
    metro: new FakeMetro(),
    logBuffer: new LogBuffer(5000),
    networkBuffer: new NetworkBuffer(5000),
    sessionManager: new SessionManager(),
  });

  const connect = getHandler(server, "connect_app");
  const getLogs = getHandler(server, "get_logs");
  const getErrors = getHandler(server, "get_errors");
  const getNetworkRequests = getHandler(server, "get_network_requests");
  const getStatus = getHandler(server, "get_connection_status");
  const getScreenContext = getHandler(server, "get_screen_context");
  const getUiTree = getHandler(server, "get_ui_tree");
  const getVisible = getHandler(server, "get_visible_elements");
  const getScreenTestIds = getHandler(server, "get_screen_test_ids");
  const getByTestId = getHandler(server, "get_elements_by_test_id");
  const remediationPlan = getHandler(server, "get_test_id_remediation_plan");
  const tap = getHandler(server, "tap");
  const typeText = getHandler(server, "type_text");
  const pressBack = getHandler(server, "press_back");
  const scroll = getHandler(server, "scroll");
  const tapElement = getHandler(server, "tap_element");
  const screenshot = getHandler(server, "take_screenshot");
  const disconnect = getHandler(server, "disconnect_app");

  const connectResult = await connect({});
  const connectPayload = connectResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(connectPayload).sort(), [
    "capabilities",
    "connected",
    "deviceId",
    "metroPort",
    "startedAt",
  ]);

  const logsResult = await getLogs({});
  const logsPayload = logsResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(logsPayload).sort(), ["items", "nextCursor"]);

  const errorsResult = await getErrors({});
  const errorsPayload = errorsResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(errorsPayload).sort(), ["items", "nextCursor"]);

  const networkResult = await getNetworkRequests({});
  const networkPayload = networkResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(networkPayload).sort(), ["items", "nextCursor"]);

  const statusResult = await getStatus({});
  const statusPayload = statusResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(statusPayload).sort(), [
    "deviceId",
    "logBufferSize",
    "metroPort",
    "networkBufferSize",
    "startedAt",
    "status",
  ]);

  const screenContextResult = await getScreenContext({});
  const screenContextPayload = screenContextResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(screenContextPayload).sort(), [
    "activity",
    "activityShort",
    "capturedAt",
    "confidence",
    "deviceId",
    "packageName",
    "platform",
    "primaryTitle",
    "screenSlug",
    "uiTitleCandidates",
  ]);

  const treeResult = await getUiTree({});
  const treePayload = treeResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(treePayload).sort(), [
    "capturedAt",
    "clickableCount",
    "deviceId",
    "maxDepth",
    "maxNodes",
    "nodeCount",
    "platform",
    "root",
    "source",
    "truncated",
  ]);

  const visibleResult = await getVisible({});
  const visiblePayload = visibleResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(visiblePayload).sort(), [
    "capturedAt",
    "clickableOnly",
    "count",
    "deviceId",
    "elements",
    "includeTextless",
    "limit",
    "maxDepth",
    "maxNodes",
    "platform",
    "queryTestId",
    "recommendedFallback",
    "resolutionStrategy",
    "skipVisibilityCheck",
    "source",
    "testIdMatch",
    "totalCandidates",
    "truncated",
  ]);

  const screenTestIdsResult = await getScreenTestIds({});
  const screenTestIdsPayload = screenTestIdsResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(screenTestIdsPayload).sort(), [
    "capturedAt",
    "count",
    "deviceId",
    "elements",
    "includeInvisible",
    "includeNonClickable",
    "limit",
    "maxDepth",
    "maxNodes",
    "platform",
    "source",
    "testIds",
    "totalCandidates",
    "truncated",
  ]);

  const byTestIdResult = await getByTestId({ testId: "save_button" });
  const byTestIdPayload = byTestIdResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(byTestIdPayload).sort(), [
    "capturedAt",
    "clickableOnly",
    "count",
    "deviceId",
    "elements",
    "includeTextless",
    "limit",
    "maxDepth",
    "maxNodes",
    "platform",
    "queryTestId",
    "recommendedFallback",
    "resolutionStrategy",
    "skipVisibilityCheck",
    "source",
    "testIdMatch",
    "totalCandidates",
    "truncated",
  ]);

  const remediationResult = await remediationPlan({ desiredAction: "tap save button" });
  const remediationPayload = remediationResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(remediationPayload).sort(), [
    "desiredTestIdWarning",
    "elementCandidates",
    "matchMode",
    "nextSteps",
    "normalizedDesiredTestId",
    "patchHint",
    "screenContext",
    "suggestedTestId",
  ]);

  const tapResult = await tap({ x: 10, y: 20 });
  const tapPayload = tapResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(tapPayload).sort(), ["deviceId", "method", "tapped", "x", "y"]);

  const typeTextResult = await typeText({ text: "hello", submit: true });
  const typeTextPayload = typeTextResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(typeTextPayload).sort(), ["deviceId", "submitted", "textLength", "typed"]);

  const pressBackResult = await pressBack({});
  const pressBackPayload = pressBackResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(pressBackPayload).sort(), ["deviceId", "key", "pressed"]);

  const scrollResult = await scroll({ direction: "down" });
  const scrollPayload = scrollResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(scrollPayload).sort(), ["deviceId", "direction", "durationMs", "from", "scrolled", "to"]);

  const tapElementResult = await tapElement({ elementId: "node-2" });
  const tapElementPayload = tapElementResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(tapElementPayload).sort(), [
    "deviceId",
    "elementId",
    "method",
    "tapped",
    "x",
    "y",
  ]);

  const screenshotResult = await screenshot({});
  const screenshotContent = screenshotResult.content as Array<Record<string, unknown>>;
  assert.equal(screenshotContent.length, 2);
  assert.equal(screenshotContent[0].type, "image");
  assert.equal(typeof screenshotContent[0].data, "string");
  assert.equal(screenshotContent[0].mimeType, "image/png");
  assert.equal(screenshotContent[1].type, "text");
  assert.equal(String(screenshotContent[1].text).startsWith("tempPath: "), true);

  const screenshotPayload = screenshotResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(screenshotPayload).sort(), [
    "capturedAt",
    "delivery",
    "deviceId",
    "height",
    "mimeType",
    "tempPath",
    "width",
  ]);
  assert.equal(String(screenshotPayload.tempPath).includes("/"), true);

  const disconnectResult = await disconnect({});
  const disconnectPayload = disconnectResult.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(disconnectPayload).sort(), ["disconnected"]);
});
