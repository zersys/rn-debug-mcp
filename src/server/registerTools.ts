import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseLogcatLine, isErrorLevel } from "../core/logParser.js";
import { parseIosLogLine } from "../core/iosLogParser.js";
import { parseNetworkEvent } from "../core/networkParser.js";
import { retryWithBackoff } from "../core/retry.js";
import { SessionManager } from "../core/sessionManager.js";
import { ToolError } from "../core/toolError.js";
import { buildScreenContext } from "../core/screenContext.js";
import { buildIosScreenContext } from "../core/iosScreenContext.js";
import { buildRemediationPlan } from "../core/testIdRemediation.js";
import { extractScreenTestIds, extractVisibleElements } from "../core/visibleElements.js";
import type { ScreenshotResult } from "../adapters/adb.js";
import type { SpawnedProcess } from "../adapters/processRunner.js";
import { LogBuffer } from "../core/logBuffer.js";
import { NetworkBuffer } from "../core/networkBuffer.js";
import {
  DEFAULT_LOG_BUFFER_SIZE,
  DEFAULT_LOG_LIMIT,
  DEFAULT_NETWORK_BUFFER_SIZE,
  DEFAULT_NETWORK_LIMIT,
  DEFAULT_METRO_PORT,
  MAX_LOG_LIMIT,
  MAX_NETWORK_LIMIT,
  closeSessionInputSchema,
  connectAppInputSchema,
  connectionStatusInputSchema,
  disconnectAppInputSchema,
  listSessionsInputSchema,
  getScreenContextInputSchema,
  getTestIdRemediationPlanInputSchema,
  getElementsByTestIdInputSchema,
  getNetworkRequestsInputSchema,
  getScreenTestIdsInputSchema,
  getVisibleElementsInputSchema,
  getUiTreeInputSchema,
  getLogsInputSchema,
  pressBackInputSchema,
  reloadAppInputSchema,
  scrollInputSchema,
  setActiveSessionInputSchema,
  tapElementInputSchema,
  tapInputSchema,
  takeScreenshotInputSchema,
  typeTextInputSchema,
  type Platform,
  type ConnectionStatusOutput,
  type CloseSessionOutput,
  type ConnectAppOutput,
  type DisconnectAppOutput,
  type NetworkRequestEntry,
  type GetNetworkRequestsInput,
  type GetNetworkRequestsOutput,
  type ListSessionsOutput,
  type LogEntry,
  type PressBackOutput,
  type GetScreenTestIdsInput,
  type SessionSummary,
  type SetActiveSessionOutput,
  type ScrollOutput,
  type ScreenContextOutput,
  type GetElementsByTestIdInput,
  type GetVisibleElementsInput,
  type GetLogsInput,
  type GetLogsOutput,
  type GetTestIdRemediationPlanInput,
  type GetUiTreeInput,
  type RecommendedFallback,
  type ResolutionStrategy,
  type ReloadAppOutput,
  type ScreenshotOutput,
  type TapElementInput,
  type TapOutput,
  type TestIdRemediationPlanOutput,
  type ToolErrorData,
  type TypeTextInput,
  type TypeTextOutput,
  type ScreenTestIdsOutput,
  type VisibleElementsOutput,
  type TestIdMatch,
  type UiNode,
  type UiTreeOutput,
} from "../types/api.js";

export interface ToolDependencies {
  sessionManager: SessionManager;
  logBuffer?: LogBuffer;
  networkBuffer?: NetworkBuffer;
  adb: AdbToolAdapter;
  ios: IosToolAdapter;
  metro: MetroToolAdapter;
}

export interface AdbToolAdapter {
  checkAvailability(): Promise<void>;
  resolveDeviceId(requested?: string): Promise<string>;
  startLogcat(deviceId: string, onLine: (line: string) => void): Promise<SpawnedProcess>;
  reloadViaBroadcast(deviceId: string): Promise<void>;
  reloadViaKeyEvents(deviceId: string): Promise<void>;
  tap(deviceId: string, x: number, y: number): Promise<void>;
  typeText(deviceId: string, text: string, submit?: boolean): Promise<void>;
  pressBack(deviceId: string): Promise<void>;
  scroll(
    deviceId: string,
    direction: "up" | "down" | "left" | "right",
    distanceRatio?: number,
    durationMs?: number,
  ): Promise<{ from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number }>;
  getActivityDump(deviceId: string): Promise<string>;
  getWindowDump(deviceId: string): Promise<string>;
  takeScreenshot(deviceId: string): Promise<ScreenshotResult>;
  getUiTree(deviceId: string, options?: { maxDepth?: number; maxNodes?: number }): Promise<{
    root?: UiTreeOutput["root"];
    nodeCount: number;
    clickableCount: number;
    truncated: boolean;
    source: "uiautomator";
  }>;
}

export interface MetroToolAdapter {
  checkStatus(port: number): Promise<void>;
  probeInspector(port: number): Promise<void>;
  reload(port: number): Promise<void>;
}

export interface IosToolAdapter {
  checkAvailability(): Promise<void>;
  ensureWdaReady(deviceId: string): Promise<SpawnedProcess | undefined>;
  deleteSession(deviceId: string): Promise<void>;
  resolveDeviceId(requested?: string): Promise<string>;
  startLogStream(deviceId: string, onLine: (line: string) => void): Promise<SpawnedProcess>;
  reloadViaKeyboard(): Promise<void>;
  tap(deviceId: string, x: number, y: number): Promise<void>;
  getViewportSize(deviceId: string): Promise<{ width: number; height: number }>;
  typeText(deviceId: string, text: string, submit?: boolean): Promise<void>;
  pressBack(deviceId: string): Promise<void>;
  scroll(
    deviceId: string,
    direction: "up" | "down" | "left" | "right",
    distanceRatio?: number,
    durationMs?: number,
  ): Promise<{ from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number }>;
  takeScreenshot(deviceId: string): Promise<ScreenshotResult>;
  getUiTree(deviceId: string, options?: { maxDepth?: number; maxNodes?: number }): Promise<{
    root?: UiTreeOutput["root"];
    nodeCount: number;
    clickableCount: number;
    truncated: boolean;
    source: "wda";
  }>;
  getActiveAppInfo(deviceId: string): Promise<{ bundleId?: string; name?: string }>;
  setProgressCallback?(cb: (msg: string) => void): void;
  setupSteps?: string[];
}

interface ToolResult {
  [key: string]: unknown;
  content: ToolContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

type ToolContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

function ok(payload: Record<string, unknown>, content?: ToolContentBlock[]): ToolResult {
  return {
    content: content ?? [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function toToolError(error: unknown): ToolErrorData {
  if (error instanceof ToolError) {
    return error.toData();
  }

  return {
    code: "COMMAND_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

function fail(error: unknown): ToolResult {
  const details = toToolError(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    structuredContent: details,
  };
}

function clampLimit(limit?: number): number {
  if (!limit) {
    return DEFAULT_LOG_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LOG_LIMIT, limit));
}

function clampNetworkLimit(limit?: number): number {
  if (!limit) {
    return DEFAULT_NETWORK_LIMIT;
  }

  return Math.max(1, Math.min(MAX_NETWORK_LIMIT, limit));
}

const CONNECT_RETRY = {
  retries: 3,
  initialDelayMs: 250,
  factor: 2,
  maxDelayMs: 1500,
};

const RELOAD_RETRY = {
  retries: 2,
  initialDelayMs: 200,
  factor: 2,
  maxDelayMs: 1000,
};

const INTERACTION_RETRY = {
  retries: 2,
  initialDelayMs: 150,
  factor: 2,
  maxDelayMs: 800,
};

const DEFAULT_UI_TREE_MAX_DEPTH = 40;
const DEFAULT_UI_TREE_MAX_NODES = 5000;
const DEFAULT_VISIBLE_ELEMENTS_LIMIT = 150;
const DEFAULT_SCREEN_TEST_IDS_LIMIT = 300;
const REMEDIATION_CANDIDATE_LIMIT = 20;
const RECONNECT_RETRY = {
  retries: 3,
  initialDelayMs: 500,
  factor: 2,
  maxDelayMs: 3000,
};

interface SessionBuffers {
  logBuffer: LogBuffer;
  networkBuffer: NetworkBuffer;
}

interface SessionRuntime {
  sessionId: string;
  platform: Platform;
  deviceId: string;
  collector?: SpawnedProcess;
  helperProcesses: SpawnedProcess[];
  stopped: boolean;
  onLine: (line: string) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientToolError(error: unknown): boolean {
  if (!(error instanceof ToolError)) {
    return true;
  }

  return (
    error.code === "METRO_UNREACHABLE" ||
    error.code === "ADB_UNAVAILABLE" ||
    error.code === "IOS_UNAVAILABLE" ||
    error.code === "DEVICE_NOT_FOUND" ||
    error.code === "COMMAND_FAILED"
  );
}

function applyLogFilters(entry: LogEntry, input: GetLogsInput): boolean {
  if (input.levels && input.levels.length > 0 && !input.levels.includes(entry.level)) {
    return false;
  }

  if (input.sources && input.sources.length > 0 && !input.sources.includes(entry.source)) {
    return false;
  }

  if (input.tags && input.tags.length > 0) {
    if (!entry.tag) {
      return false;
    }

    const tagLower = entry.tag.toLowerCase();
    const allowed = input.tags.some((candidate) => candidate.toLowerCase() === tagLower);
    if (!allowed) {
      return false;
    }
  }

  return true;
}

function applyNetworkFilters(entry: NetworkRequestEntry, input: GetNetworkRequestsInput): boolean {
  if (input.sources && input.sources.length > 0 && !input.sources.includes(entry.source)) {
    return false;
  }

  if (input.phases && input.phases.length > 0 && !input.phases.includes(entry.phase)) {
    return false;
  }

  if (input.methods && input.methods.length > 0) {
    if (!entry.method) {
      return false;
    }

    const method = entry.method.toUpperCase();
    const allowed = input.methods.some((candidate) => candidate.toUpperCase() === method);
    if (!allowed) {
      return false;
    }
  }

  if (input.statuses && input.statuses.length > 0) {
    if (entry.status === undefined) {
      return false;
    }

    if (!input.statuses.includes(entry.status)) {
      return false;
    }
  }

  if (input.urlContains) {
    if (!entry.url) {
      return false;
    }

    if (!entry.url.toLowerCase().includes(input.urlContains.toLowerCase())) {
      return false;
    }
  }

  return true;
}

function resolveUiTreeOptions(input: GetUiTreeInput): { maxDepth: number; maxNodes: number } {
  return {
    maxDepth: input.maxDepth ?? DEFAULT_UI_TREE_MAX_DEPTH,
    maxNodes: input.maxNodes ?? DEFAULT_UI_TREE_MAX_NODES,
  };
}

function findUiNodeById(root: UiNode | undefined, id: string): UiNode | undefined {
  if (!root) {
    return undefined;
  }

  if (root.id === id) {
    return root;
  }

  for (const child of root.children) {
    const found = findUiNodeById(child, id);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function centerFromBounds(node: UiNode): { x: number; y: number } {
  if (!node.bounds) {
    throw new ToolError("COMMAND_FAILED", `Element '${node.id}' has no bounds in current UI tree`);
  }

  return {
    x: Math.floor((node.bounds.left + node.bounds.right) / 2),
    y: Math.floor((node.bounds.top + node.bounds.bottom) / 2),
  };
}

function resolveTapElementOptions(input: TapElementInput): { elementId: string; maxDepth: number; maxNodes: number } {
  return {
    elementId: input.elementId,
    ...resolveUiTreeOptions(input),
  };
}

function resolveVisibleOptions(input: GetVisibleElementsInput): {
  maxDepth: number;
  maxNodes: number;
  limit: number;
  clickableOnly: boolean;
  includeTextless: boolean;
  skipVisibilityCheck: boolean;
  testId?: string;
  testIdMatch: TestIdMatch;
} {
  return {
    maxDepth: input.maxDepth ?? DEFAULT_UI_TREE_MAX_DEPTH,
    maxNodes: input.maxNodes ?? DEFAULT_UI_TREE_MAX_NODES,
    limit: input.limit ?? DEFAULT_VISIBLE_ELEMENTS_LIMIT,
    clickableOnly: input.clickableOnly ?? false,
    includeTextless: input.includeTextless ?? false,
    skipVisibilityCheck: input.skipVisibilityCheck ?? true,
    testId: input.testId,
    testIdMatch: input.testIdMatch ?? "exact",
  };
}

function resolveScreenTestIdsOptions(input: GetScreenTestIdsInput): {
  maxDepth: number;
  maxNodes: number;
  limit: number;
  includeNonClickable: boolean;
  includeInvisible: boolean;
} {
  return {
    maxDepth: input.maxDepth ?? DEFAULT_UI_TREE_MAX_DEPTH,
    maxNodes: input.maxNodes ?? DEFAULT_UI_TREE_MAX_NODES,
    limit: input.limit ?? DEFAULT_SCREEN_TEST_IDS_LIMIT,
    includeNonClickable: input.includeNonClickable ?? true,
    includeInvisible: input.includeInvisible ?? true,
  };
}

function resolutionStrategyFor(
  testId: string | undefined,
  testIdMatch: TestIdMatch,
  matchedCount: number,
): ResolutionStrategy {
  if (!testId || matchedCount === 0) {
    return "none";
  }

  return testIdMatch === "contains" ? "test_id_contains" : "test_id_exact";
}

function recommendedFallbackFor(params: {
  hasTestIdQuery: boolean;
  matchedCount: number;
  hasAnyElements: boolean;
}): RecommendedFallback {
  if (params.matchedCount > 0) {
    return "tap_element";
  }

  if (params.hasTestIdQuery) {
    return "add_test_id";
  }

  return params.hasAnyElements ? "tap_element" : "tap_coordinates";
}

async function getScreenContextForSession(
  session: { sessionId: string; platform: Platform; deviceId: string },
  adapters: { adb: AdbToolAdapter; ios: IosToolAdapter },
): Promise<ScreenContextOutput> {
  if (session.platform === "ios") {
    const [appInfo, uiTree] = await Promise.all([
      adapters.ios
        .getActiveAppInfo(session.deviceId)
        .catch((): { bundleId?: string; name?: string } => ({})),
      adapters.ios
        .getUiTree(session.deviceId, { maxDepth: DEFAULT_UI_TREE_MAX_DEPTH, maxNodes: DEFAULT_UI_TREE_MAX_NODES })
        .catch(() => null),
    ]);

    return buildIosScreenContext({
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      capturedAt: new Date().toISOString(),
      bundleId: appInfo.bundleId,
      appName: appInfo.name,
      uiRoot: uiTree?.root,
    });
  }

  const [activityDump, windowDump, uiTree] = await Promise.all([
    adapters.adb.getActivityDump(session.deviceId).catch(() => ""),
    adapters.adb.getWindowDump(session.deviceId).catch(() => ""),
    adapters.adb
      .getUiTree(session.deviceId, { maxDepth: DEFAULT_UI_TREE_MAX_DEPTH, maxNodes: DEFAULT_UI_TREE_MAX_NODES })
      .catch(() => null),
  ]);

  return buildScreenContext({
    deviceId: session.deviceId,
    capturedAt: new Date().toISOString(),
    activityDump,
    windowDump,
    uiRoot: uiTree?.root,
  });
}

export function registerTools(server: McpServer, deps: ToolDependencies): void {
  const { sessionManager, adb, ios, metro } = deps;
  const logCapacity = deps.logBuffer?.capacity() ?? DEFAULT_LOG_BUFFER_SIZE;
  const networkCapacity = deps.networkBuffer?.capacity() ?? DEFAULT_NETWORK_BUFFER_SIZE;
  const sessionBuffers = new Map<string, SessionBuffers>();
  const sessionRuntimes = new Map<string, SessionRuntime>();

  const getBuffers = (sessionId: string): SessionBuffers => {
    const buffers = sessionBuffers.get(sessionId);
    if (!buffers) {
      throw new ToolError("NO_SESSION", `No buffers found for session '${sessionId}'`);
    }
    return buffers;
  };

  const parseLogForPlatform = (platform: Platform, line: string): Omit<LogEntry, "cursor"> => {
    return platform === "ios" ? parseIosLogLine(line) : parseLogcatLine(line);
  };

  const appendRuntimeLine = (runtime: SessionRuntime, line: string): void => {
    const buffers = sessionBuffers.get(runtime.sessionId);
    if (!buffers) {
      return;
    }

    const parsed = parseLogForPlatform(runtime.platform, line);
    buffers.logBuffer.append(parsed);
    const networkEvent = parseNetworkEvent(line);
    if (networkEvent) {
      buffers.networkBuffer.append(networkEvent);
    }
  };

  const startCollector = async (runtime: SessionRuntime): Promise<SpawnedProcess> => {
    if (runtime.platform === "ios") {
      return ios.startLogStream(runtime.deviceId, runtime.onLine);
    }

    return adb.startLogcat(runtime.deviceId, runtime.onLine);
  };

  const attachCollectorExit = (runtime: SessionRuntime): void => {
    const collector = runtime.collector;
    if (!collector) {
      return;
    }

    void collector.exited.then(async ({ code, signal }) => {
      if (runtime.stopped || !sessionManager.hasSession(runtime.sessionId)) {
        return;
      }

      if (code === 0 && signal === null) {
        return;
      }

      sessionManager.markReconnecting(runtime.sessionId);
      let delay = RECONNECT_RETRY.initialDelayMs;
      let lastError = "collector exited";
      for (let attempt = 0; attempt < RECONNECT_RETRY.retries; attempt += 1) {
        try {
          runtime.collector = await startCollector(runtime);
          attachCollectorExit(runtime);
          sessionManager.markHealthy(runtime.sessionId);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          await sleep(delay);
          delay = Math.min(Math.floor(delay * RECONNECT_RETRY.factor), RECONNECT_RETRY.maxDelayMs);
        }
      }

      sessionManager.markReconnectFailure(runtime.sessionId, lastError);
    });
  };

  server.registerTool(
    "connect_app",
    {
      description: "Connect to a running React Native app session on Android emulator or iOS simulator and start log collection.",
      inputSchema: connectAppInputSchema.shape,
    },
    async (input): Promise<ToolResult> => {
      let createdSessionId: string | undefined;
      let startedWdaProcess: SpawnedProcess | undefined;
      try {
        const platform = input.platform ?? "android";
        const metroPort = input.metroPort ?? DEFAULT_METRO_PORT;

        await retryWithBackoff(() => (platform === "ios" ? ios.checkAvailability() : adb.checkAvailability()), {
          ...CONNECT_RETRY,
          shouldRetry: isTransientToolError,
        });

        const deviceId = await retryWithBackoff(
          () => (platform === "ios" ? ios.resolveDeviceId(input.deviceId) : adb.resolveDeviceId(input.deviceId)),
          {
            ...CONNECT_RETRY,
            shouldRetry: isTransientToolError,
          },
        );

        if (platform === "ios") {
          ios.setProgressCallback?.((msg) => {
            server.sendLoggingMessage({ level: "info", logger: "rndmcp:wda", data: msg })
              .catch(() => {});
          });
          startedWdaProcess = await retryWithBackoff(() => ios.ensureWdaReady(deviceId), {
            ...CONNECT_RETRY,
            retries: 1,
            shouldRetry: isTransientToolError,
          });
        }

        await retryWithBackoff(() => metro.checkStatus(metroPort), {
          ...CONNECT_RETRY,
          shouldRetry: isTransientToolError,
        });

        await retryWithBackoff(() => metro.probeInspector(metroPort), {
          ...CONNECT_RETRY,
          retries: 1,
          initialDelayMs: 150,
          shouldRetry: isTransientToolError,
        });

        const session = sessionManager.createSession(platform, deviceId, metroPort);
        createdSessionId = session.sessionId;
        const buffers: SessionBuffers = {
          logBuffer: new LogBuffer(logCapacity),
          networkBuffer: new NetworkBuffer(networkCapacity),
        };
        sessionBuffers.set(session.sessionId, buffers);

        let runtime!: SessionRuntime;
        runtime = {
          sessionId: session.sessionId,
          platform,
          deviceId,
          helperProcesses: startedWdaProcess ? [startedWdaProcess] : [],
          stopped: false,
          onLine: (line) => appendRuntimeLine(runtime, line),
        };

        runtime.collector = await retryWithBackoff(() => startCollector(runtime), {
          ...CONNECT_RETRY,
          shouldRetry: isTransientToolError,
        });
        sessionRuntimes.set(session.sessionId, runtime);
        attachCollectorExit(runtime);

        sessionManager.addCleanupForSession(session.sessionId, async () => {
          runtime.stopped = true;
          const collector = runtime.collector;
          if (collector) {
            await collector.stop();
          }
          if (runtime.platform === "ios") {
            await ios.deleteSession(runtime.deviceId).catch(() => {});
          }
          for (const process of runtime.helperProcesses) {
            await process.stop();
          }
          sessionRuntimes.delete(session.sessionId);
          sessionBuffers.delete(session.sessionId);
        });

        const payload: ConnectAppOutput = {
          connected: true,
          sessionId: session.sessionId,
          platform: session.platform,
          deviceId: session.deviceId,
          metroPort: session.metroPort,
          startedAt: session.startedAt,
          capabilities: [
            "list_sessions",
            "set_active_session",
            "close_session",
            "get_connection_status",
            "reload_app",
            "get_logs",
            "get_errors",
            "get_network_requests",
            "get_screen_context",
            "get_ui_tree",
            "get_visible_elements",
            "get_screen_test_ids",
            "get_elements_by_test_id",
            "get_test_id_remediation_plan",
            "tap",
            "tap_element",
            "type_text",
            "press_back",
            "scroll",
            "take_screenshot",
          ],
          ...(platform === "ios" && ios.setupSteps && ios.setupSteps.length > 0 ? { setupSteps: [...ios.setupSteps] } : {}),
        };

        return ok(payload);
      } catch (error) {
        if (createdSessionId && sessionManager.hasSession(createdSessionId)) {
          await sessionManager.closeSession(createdSessionId);
        } else {
          sessionManager.clearLegacyConnecting();
        }
        if (startedWdaProcess && !createdSessionId) {
          await startedWdaProcess.stop().catch(() => {});
        }
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_connection_status",
    { description: "Get current RN Inspector MCP session status and log buffer state.", inputSchema: connectionStatusInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const summary = sessionManager.getSessionSummary(input.sessionId);
        const activeSessionId = sessionManager.getFallbackActiveSessionId();
        const buffers = summary ? sessionBuffers.get(summary.sessionId) : undefined;
        const state = sessionManager.getState(input.sessionId);
        const payload: ConnectionStatusOutput = {
          status: state.status,
          activeSessionId,
          sessionId: summary?.sessionId,
          platform: summary?.platform,
          deviceId: state.deviceId,
          metroPort: state.metroPort,
          startedAt: state.startedAt,
          logBufferSize: buffers?.logBuffer.size() ?? 0,
          networkBufferSize: buffers?.networkBuffer.size() ?? 0,
          connectionHealth: summary?.connectionHealth,
          reconnectAttempts: summary?.reconnectAttempts,
          lastDisconnectAt: summary?.lastDisconnectAt,
          lastReconnectError: summary?.lastReconnectError,
        };
        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "disconnect_app",
    { description: "Disconnect the active React Native app session.", inputSchema: disconnectAppInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        let targetSessionId = input.sessionId;
        if (!targetSessionId) {
          targetSessionId = sessionManager.getFallbackActiveSessionId();
        }

        if (targetSessionId) {
          await sessionManager.closeSession(targetSessionId);
        }

        const payload: DisconnectAppOutput = { disconnected: true, sessionId: targetSessionId };
        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "list_sessions",
    { description: "List all active MCP device sessions.", inputSchema: listSessionsInputSchema.shape },
    async (): Promise<ToolResult> => {
      try {
        const sessions = sessionManager.listSessions();
        const payload: ListSessionsOutput = {
          activeSessionId: sessionManager.getFallbackActiveSessionId(),
          count: sessions.length,
          sessions,
        };
        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "set_active_session",
    { description: "Set the active session used when sessionId is omitted.", inputSchema: setActiveSessionInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        sessionManager.setActiveSession(input.sessionId);
        const payload: SetActiveSessionOutput = { activeSessionId: input.sessionId };
        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "close_session",
    { description: "Close a specific session by sessionId.", inputSchema: closeSessionInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        await sessionManager.closeSession(input.sessionId);
        const payload: CloseSessionOutput = { closed: true, sessionId: input.sessionId };
        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "reload_app",
    { description: "Reload the active app session via Metro, with ADB fallback.", inputSchema: reloadAppInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);

        try {
          await retryWithBackoff(() => metro.reload(session.metroPort), {
            ...RELOAD_RETRY,
            shouldRetry: isTransientToolError,
          });
          const payload: ReloadAppOutput = { reloaded: true, method: "metro", sessionId: session.sessionId };
          return ok(payload);
        } catch (metroError) {
          if (session.platform === "ios") {
            await retryWithBackoff(() => ios.reloadViaKeyboard(), {
              ...RELOAD_RETRY,
              shouldRetry: isTransientToolError,
            });
            const payload: ReloadAppOutput = {
              reloaded: true,
              method: "ios_simulator_keyboard_fallback",
              sessionId: session.sessionId,
            };
            return ok(payload);
          }

          try {
            await retryWithBackoff(() => adb.reloadViaBroadcast(session.deviceId), {
              ...RELOAD_RETRY,
              shouldRetry: isTransientToolError,
            });
          } catch {
            await retryWithBackoff(() => adb.reloadViaKeyEvents(session.deviceId), {
              ...RELOAD_RETRY,
              shouldRetry: isTransientToolError,
            });
          }

          const payload: ReloadAppOutput = { reloaded: true, method: "adb_fallback", sessionId: session.sessionId };
          return ok(payload);
        }
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_logs",
    { description: "Read buffered non-error logs using cursor-based pagination.", inputSchema: getLogsInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);
        const buffers = getBuffers(session.sessionId);

        const result = buffers.logBuffer.query({
          sinceCursor: input.sinceCursor,
          limit: clampLimit(input.limit),
          predicate: (entry) => !isErrorLevel(entry.level) && applyLogFilters(entry, input),
        });

        const payload: GetLogsOutput = {
          nextCursor: result.nextCursor,
          items: result.items,
        };

        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_errors",
    { description: "Read buffered error and fatal logs using cursor-based pagination.", inputSchema: getLogsInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);
        const buffers = getBuffers(session.sessionId);

        const result = buffers.logBuffer.query({
          sinceCursor: input.sinceCursor,
          limit: clampLimit(input.limit),
          predicate: (entry) => isErrorLevel(entry.level) && applyLogFilters(entry, input),
        });

        const payload: GetLogsOutput = {
          nextCursor: result.nextCursor,
          items: result.items,
        };

        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_network_requests",
    {
      description: "Read buffered network request/response/error events using cursor-based pagination.",
      inputSchema: getNetworkRequestsInputSchema.shape,
    },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);
        const buffers = getBuffers(session.sessionId);

        const result = buffers.networkBuffer.query({
          sinceCursor: input.sinceCursor,
          limit: clampNetworkLimit(input.limit),
          predicate: (entry) => applyNetworkFilters(entry, input),
        });

        const payload: GetNetworkRequestsOutput = {
          nextCursor: result.nextCursor,
          items: result.items,
        };

        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_screen_context",
    { description: "Get inferred current Android screen context for remediation guidance. Use after testID lookup fails.", inputSchema: getScreenContextInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);
        const payload = await getScreenContextForSession(session, { adb, ios });
        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_test_id_remediation_plan",
    { description: "Build deterministic patch/remediation guidance when a desired testID is missing. Recommended flow: get_screen_test_ids -> get_elements_by_test_id (exact/contains) -> this tool -> reload_app -> retry lookup.", inputSchema: getTestIdRemediationPlanInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const typedInput = input as GetTestIdRemediationPlanInput;
        const session = sessionManager.requireConnected(input.sessionId);
        const screenContext = await getScreenContextForSession(session, { adb, ios });
        const uiTree = await (session.platform === "ios" ? ios : adb)
          .getUiTree(session.deviceId, {
            maxDepth: DEFAULT_UI_TREE_MAX_DEPTH,
            maxNodes: DEFAULT_UI_TREE_MAX_NODES,
          })
          .catch(() => null);

        const candidates = extractVisibleElements(uiTree?.root, {
          limit: REMEDIATION_CANDIDATE_LIMIT,
          clickableOnly: true,
          includeTextless: false,
          skipVisibilityCheck: true,
          testId: undefined,
          testIdMatch: "exact",
        }).elements;

        const payload: TestIdRemediationPlanOutput = buildRemediationPlan({
          input: typedInput,
          screenContext,
          elementCandidates: candidates,
        });

        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_ui_tree",
    { description: "Read the current accessibility hierarchy from Android UIAutomator or iOS WDA.", inputSchema: getUiTreeInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);
        const options = resolveUiTreeOptions(input);
        const uiTree = await (session.platform === "ios" ? ios : adb).getUiTree(session.deviceId, options);

        const payload: UiTreeOutput = {
          sessionId: session.sessionId,
          platform: session.platform,
          source: uiTree.source,
          deviceId: session.deviceId,
          capturedAt: new Date().toISOString(),
          nodeCount: uiTree.nodeCount,
          clickableCount: uiTree.clickableCount,
          maxDepth: options.maxDepth,
          maxNodes: options.maxNodes,
          truncated: uiTree.truncated,
          root: uiTree.root,
        };

        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_visible_elements",
    { description: "Return flattened visible accessibility elements derived from the current UI tree. Use as fallback discovery after testID-first lookup.", inputSchema: getVisibleElementsInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);
        const options = resolveVisibleOptions(input);
        const uiTree = await (session.platform === "ios" ? ios : adb).getUiTree(session.deviceId, {
          maxDepth: options.maxDepth,
          maxNodes: options.maxNodes,
        });

        const extracted = extractVisibleElements(uiTree.root, {
          limit: options.limit,
          clickableOnly: options.clickableOnly,
          includeTextless: options.includeTextless,
          skipVisibilityCheck: options.skipVisibilityCheck,
          testId: options.testId,
          testIdMatch: options.testIdMatch,
        });

        const payload: VisibleElementsOutput = {
          sessionId: session.sessionId,
          platform: session.platform,
          source: uiTree.source,
          deviceId: session.deviceId,
          capturedAt: new Date().toISOString(),
          totalCandidates: extracted.totalCandidates,
          count: extracted.elements.length,
          maxDepth: options.maxDepth,
          maxNodes: options.maxNodes,
          limit: options.limit,
          clickableOnly: options.clickableOnly,
          includeTextless: options.includeTextless,
          skipVisibilityCheck: options.skipVisibilityCheck,
          queryTestId: options.testId,
          testIdMatch: options.testIdMatch,
          resolutionStrategy: resolutionStrategyFor(options.testId, options.testIdMatch, extracted.elements.length),
          recommendedFallback: recommendedFallbackFor({
            hasTestIdQuery: Boolean(options.testId),
            matchedCount: extracted.elements.length,
            hasAnyElements: uiTree.nodeCount > 0,
          }),
          truncated: uiTree.truncated || extracted.totalCandidates > extracted.elements.length,
          elements: extracted.elements,
        };

        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_screen_test_ids",
    { description: "List testIDs present on the current screen with metadata. Start UI interaction flows with this tool before get_elements_by_test_id.", inputSchema: getScreenTestIdsInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);
        const options = resolveScreenTestIdsOptions(input);
        const uiTree = await (session.platform === "ios" ? ios : adb).getUiTree(session.deviceId, {
          maxDepth: options.maxDepth,
          maxNodes: options.maxNodes,
        });

        const extracted = extractScreenTestIds(uiTree.root, {
          limit: options.limit,
          includeNonClickable: options.includeNonClickable,
          includeInvisible: options.includeInvisible,
        });

        const payload: ScreenTestIdsOutput = {
          sessionId: session.sessionId,
          platform: session.platform,
          source: uiTree.source,
          deviceId: session.deviceId,
          capturedAt: new Date().toISOString(),
          maxDepth: options.maxDepth,
          maxNodes: options.maxNodes,
          limit: options.limit,
          includeNonClickable: options.includeNonClickable,
          includeInvisible: options.includeInvisible,
          count: extracted.testIds.length,
          totalCandidates: extracted.totalCandidates,
          testIds: extracted.testIds,
          elements: extracted.elements,
          truncated: uiTree.truncated || extracted.totalCandidates > extracted.elements.length,
        };

        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_elements_by_test_id",
    { description: "Find visible elements matching a React Native testID. Use exact first, then contains. If none, call get_screen_context + get_test_id_remediation_plan.", inputSchema: getElementsByTestIdInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);
        const options = resolveVisibleOptions(input as GetElementsByTestIdInput);
        const uiTree = await (session.platform === "ios" ? ios : adb).getUiTree(session.deviceId, {
          maxDepth: options.maxDepth,
          maxNodes: options.maxNodes,
        });

        const extracted = extractVisibleElements(uiTree.root, {
          limit: options.limit,
          clickableOnly: options.clickableOnly,
          includeTextless: options.includeTextless,
          skipVisibilityCheck: options.skipVisibilityCheck,
          testId: input.testId,
          testIdMatch: options.testIdMatch,
        });

        const payload: VisibleElementsOutput = {
          sessionId: session.sessionId,
          platform: session.platform,
          source: uiTree.source,
          deviceId: session.deviceId,
          capturedAt: new Date().toISOString(),
          totalCandidates: extracted.totalCandidates,
          count: extracted.elements.length,
          maxDepth: options.maxDepth,
          maxNodes: options.maxNodes,
          limit: options.limit,
          clickableOnly: options.clickableOnly,
          includeTextless: options.includeTextless,
          skipVisibilityCheck: options.skipVisibilityCheck,
          queryTestId: input.testId,
          testIdMatch: options.testIdMatch,
          resolutionStrategy: resolutionStrategyFor(input.testId, options.testIdMatch, extracted.elements.length),
          recommendedFallback: recommendedFallbackFor({
            hasTestIdQuery: true,
            matchedCount: extracted.elements.length,
            hasAnyElements: uiTree.nodeCount > 0,
          }),
          truncated: uiTree.truncated || extracted.totalCandidates > extracted.elements.length,
          elements: extracted.elements,
        };

        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "tap",
    { description: "Tap the screen at absolute coordinates. Final fallback only when testID and element-based targeting fail.", inputSchema: tapInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);
        await retryWithBackoff(() => (session.platform === "ios" ? ios : adb).tap(session.deviceId, input.x, input.y), {
          ...INTERACTION_RETRY,
          shouldRetry: isTransientToolError,
        });

        const payload: TapOutput = {
          tapped: true,
          method: "coordinates",
          coordinateSpace: session.platform === "ios" ? "points" : "pixels",
          sessionId: session.sessionId,
          deviceId: session.deviceId,
          x: input.x,
          y: input.y,
        };

        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "type_text",
    { description: "Type text into the currently focused input field, with optional submit/enter key press.", inputSchema: typeTextInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const typedInput = input as TypeTextInput;
        const session = sessionManager.requireConnected(typedInput.sessionId);
        const submit = typedInput.submit ?? false;
        await retryWithBackoff(
          () => (session.platform === "ios" ? ios : adb).typeText(session.deviceId, typedInput.text, submit),
          {
            ...INTERACTION_RETRY,
            shouldRetry: isTransientToolError,
          },
        );

        const payload: TypeTextOutput = {
          typed: true,
          sessionId: session.sessionId,
          deviceId: session.deviceId,
          textLength: typedInput.text.length,
          submitted: submit,
        };
        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "press_back",
    { description: "Trigger back navigation on the current platform.", inputSchema: pressBackInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);
        await retryWithBackoff(() => (session.platform === "ios" ? ios : adb).pressBack(session.deviceId), {
          ...INTERACTION_RETRY,
          shouldRetry: isTransientToolError,
        });

        const payload: PressBackOutput = {
          pressed: true,
          key: "back",
          sessionId: session.sessionId,
          deviceId: session.deviceId,
        };
        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "scroll",
    { description: "Scroll screen content in a direction via swipe gesture.", inputSchema: scrollInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);
        const result = await retryWithBackoff(
          () =>
            (session.platform === "ios" ? ios : adb).scroll(
              session.deviceId,
              input.direction,
              input.distanceRatio,
              input.durationMs,
            ),
          {
            ...INTERACTION_RETRY,
            shouldRetry: isTransientToolError,
          },
        );

        const payload: ScrollOutput = {
          scrolled: true,
          direction: input.direction,
          sessionId: session.sessionId,
          deviceId: session.deviceId,
          from: result.from,
          to: result.to,
          durationMs: result.durationMs,
        };
        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "tap_element",
    { description: "Tap a visible element by element id from get_visible_elements/get_ui_tree. Preferred fallback before coordinate tapping.", inputSchema: tapElementInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);
        const options = resolveTapElementOptions(input);
        const uiTree = await (session.platform === "ios" ? ios : adb).getUiTree(session.deviceId, {
          maxDepth: options.maxDepth,
          maxNodes: options.maxNodes,
        });

        const node = findUiNodeById(uiTree.root, options.elementId);
        if (!node) {
          throw new ToolError("COMMAND_FAILED", `Element '${options.elementId}' not found in current UI tree`, {
            elementId: options.elementId,
          });
        }

        const point = centerFromBounds(node);
        await retryWithBackoff(() => (session.platform === "ios" ? ios : adb).tap(session.deviceId, point.x, point.y), {
          ...INTERACTION_RETRY,
          shouldRetry: isTransientToolError,
        });

        const payload: TapOutput = {
          tapped: true,
          method: "element",
          coordinateSpace: session.platform === "ios" ? "points" : "pixels",
          sessionId: session.sessionId,
          deviceId: session.deviceId,
          x: point.x,
          y: point.y,
          elementId: options.elementId,
        };

        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "take_screenshot",
    { description: "Capture a screenshot from the connected device.", inputSchema: takeScreenshotInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected(input.sessionId);
        const screenshot = await (session.platform === "ios" ? ios : adb).takeScreenshot(session.deviceId);
        const imageBase64 = screenshot.png.toString("base64");
        const tempPath = join(tmpdir(), `rndmcp-screenshot-${Date.now()}-${randomUUID()}.png`);
        await writeFile(tempPath, screenshot.png);

        const pixelWidth = screenshot.width;
        const pixelHeight = screenshot.height;

        let pointWidth = pixelWidth;
        let pointHeight = pixelHeight;
        let scaleFactor = 1;

        if (session.platform === "ios") {
          try {
            const viewport = await ios.getViewportSize(session.deviceId);
            pointWidth = viewport.width;
            pointHeight = viewport.height;
            if (typeof pixelWidth === "number" && pixelWidth > 0 && viewport.width > 0) {
              const computedScale = pixelWidth / viewport.width;
              if (Number.isFinite(computedScale) && computedScale > 0) {
                scaleFactor = computedScale;
              }
            }
          } catch {
            pointWidth = pixelWidth;
            pointHeight = pixelHeight;
            scaleFactor = 1;
          }
        }

        const payload: ScreenshotOutput = {
          mimeType: "image/png",
          width: pixelWidth,
          height: pixelHeight,
          pointWidth,
          pointHeight,
          scaleFactor,
          sessionId: session.sessionId,
          deviceId: session.deviceId,
          capturedAt: new Date().toISOString(),
          tempPath,
          delivery: "mcp_image_content_and_temp_file",
        };

        return ok(payload, [
          { type: "image", data: imageBase64, mimeType: "image/png" },
          { type: "text", text: `tempPath: ${tempPath}` },
        ]);
      } catch (error) {
        return fail(error);
      }
    },
  );
}
