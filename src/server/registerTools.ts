import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseLogcatLine, isErrorLevel } from "../core/logParser.js";
import { parseNetworkEvent } from "../core/networkParser.js";
import { retryWithBackoff } from "../core/retry.js";
import { SessionManager } from "../core/sessionManager.js";
import { ToolError } from "../core/toolError.js";
import { buildScreenContext } from "../core/screenContext.js";
import { buildRemediationPlan } from "../core/testIdRemediation.js";
import { extractScreenTestIds, extractVisibleElements } from "../core/visibleElements.js";
import type { ScreenshotResult } from "../adapters/adb.js";
import type { SpawnedProcess } from "../adapters/processRunner.js";
import type { LogBuffer } from "../core/logBuffer.js";
import type { NetworkBuffer } from "../core/networkBuffer.js";
import {
  DEFAULT_LOG_LIMIT,
  DEFAULT_NETWORK_LIMIT,
  DEFAULT_METRO_PORT,
  MAX_LOG_LIMIT,
  MAX_NETWORK_LIMIT,
  connectAppInputSchema,
  connectionStatusInputSchema,
  disconnectAppInputSchema,
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
  tapElementInputSchema,
  tapInputSchema,
  takeScreenshotInputSchema,
  typeTextInputSchema,
  type ConnectionStatusOutput,
  type ConnectAppOutput,
  type DisconnectAppOutput,
  type NetworkRequestEntry,
  type GetNetworkRequestsInput,
  type GetNetworkRequestsOutput,
  type LogEntry,
  type PressBackOutput,
  type GetScreenTestIdsInput,
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
  logBuffer: LogBuffer;
  networkBuffer: NetworkBuffer;
  adb: AdbToolAdapter;
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

function isTransientToolError(error: unknown): boolean {
  if (!(error instanceof ToolError)) {
    return true;
  }

  return (
    error.code === "METRO_UNREACHABLE" ||
    error.code === "ADB_UNAVAILABLE" ||
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
    clickableOnly: input.clickableOnly ?? true,
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

async function getScreenContextForSession(session: { deviceId: string }, adb: AdbToolAdapter): Promise<ScreenContextOutput> {
  const [activityDump, windowDump, uiTree] = await Promise.all([
    adb.getActivityDump(session.deviceId).catch(() => ""),
    adb.getWindowDump(session.deviceId).catch(() => ""),
    adb
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
  const { sessionManager, logBuffer, networkBuffer, adb, metro } = deps;

  server.registerTool(
    "connect_app",
    { description: "Connect to a running React Native app on Android emulator and start log collection.", inputSchema: connectAppInputSchema.shape },
    async (input): Promise<ToolResult> => {
      let beganConnecting = false;
      try {
        sessionManager.beginConnecting();
        beganConnecting = true;
        logBuffer.clear();
        networkBuffer.clear();

        await retryWithBackoff(() => adb.checkAvailability(), {
          ...CONNECT_RETRY,
          shouldRetry: isTransientToolError,
        });
        const deviceId = await retryWithBackoff(() => adb.resolveDeviceId(input.deviceId), {
          ...CONNECT_RETRY,
          shouldRetry: isTransientToolError,
        });
        const metroPort = input.metroPort ?? DEFAULT_METRO_PORT;

        await retryWithBackoff(() => metro.checkStatus(metroPort), {
          ...CONNECT_RETRY,
          shouldRetry: isTransientToolError,
        });

        const logcatProcess = await retryWithBackoff(
          () =>
            adb.startLogcat(deviceId, (line) => {
              const parsed = parseLogcatLine(line);
              logBuffer.append(parsed);
              const networkEvent = parseNetworkEvent(line);
              if (networkEvent) {
                networkBuffer.append(networkEvent);
              }
            }),
          {
            ...CONNECT_RETRY,
            shouldRetry: isTransientToolError,
          },
        );

        await retryWithBackoff(() => metro.probeInspector(metroPort), {
          ...CONNECT_RETRY,
          retries: 1,
          initialDelayMs: 150,
          shouldRetry: isTransientToolError,
        });

        sessionManager.addCleanup(async () => {
          await logcatProcess.stop();
        });

        const state = sessionManager.setConnected(deviceId, metroPort);
        const payload: ConnectAppOutput = {
          connected: true,
          deviceId: state.deviceId!,
          metroPort: state.metroPort!,
          startedAt: state.startedAt!,
          capabilities: [
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
        };

        return ok(payload);
      } catch (error) {
        if (beganConnecting) {
          await sessionManager.reset();
        }
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_connection_status",
    { description: "Get current RN Inspector MCP session status and log buffer state.", inputSchema: connectionStatusInputSchema.shape },
    async (): Promise<ToolResult> => {
      try {
        const state = sessionManager.getState();
        const payload: ConnectionStatusOutput = {
          status: state.status,
          deviceId: state.deviceId,
          metroPort: state.metroPort,
          startedAt: state.startedAt,
          logBufferSize: logBuffer.size(),
          networkBufferSize: networkBuffer.size(),
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
    async (): Promise<ToolResult> => {
      try {
        await sessionManager.reset();
        logBuffer.clear();
        networkBuffer.clear();

        const payload: DisconnectAppOutput = { disconnected: true };
        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "reload_app",
    { description: "Reload the active app session via Metro, with ADB fallback.", inputSchema: reloadAppInputSchema.shape },
    async (): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected();

        try {
          await retryWithBackoff(() => metro.reload(session.metroPort), {
            ...RELOAD_RETRY,
            shouldRetry: isTransientToolError,
          });
          const payload: ReloadAppOutput = { reloaded: true, method: "metro" };
          return ok(payload);
        } catch (metroError) {
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

          const payload: ReloadAppOutput = { reloaded: true, method: "adb_fallback" };
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
        sessionManager.requireConnected();

        const result = logBuffer.query({
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
        sessionManager.requireConnected();

        const result = logBuffer.query({
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
        sessionManager.requireConnected();

        const result = networkBuffer.query({
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
    async (): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected();
        const payload = await getScreenContextForSession(session, adb);
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
        const session = sessionManager.requireConnected();
        const screenContext = await getScreenContextForSession(session, adb);
        const uiTree = await adb
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
    { description: "Read the Android accessibility hierarchy via UIAutomator XML dump.", inputSchema: getUiTreeInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected();
        const options = resolveUiTreeOptions(input);
        const uiTree = await adb.getUiTree(session.deviceId, options);

        const payload: UiTreeOutput = {
          platform: "android",
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
    { description: "Return flattened visible Android accessibility elements derived from the current UI tree. Use as fallback discovery after testID-first lookup.", inputSchema: getVisibleElementsInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected();
        const options = resolveVisibleOptions(input);
        const uiTree = await adb.getUiTree(session.deviceId, {
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
          platform: "android",
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
        const session = sessionManager.requireConnected();
        const options = resolveScreenTestIdsOptions(input);
        const uiTree = await adb.getUiTree(session.deviceId, {
          maxDepth: options.maxDepth,
          maxNodes: options.maxNodes,
        });

        const extracted = extractScreenTestIds(uiTree.root, {
          limit: options.limit,
          includeNonClickable: options.includeNonClickable,
          includeInvisible: options.includeInvisible,
        });

        const payload: ScreenTestIdsOutput = {
          platform: "android",
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
    { description: "Find visible Android elements matching a React Native testID (from resource-id tail). Use exact first, then contains. If none, call get_screen_context + get_test_id_remediation_plan.", inputSchema: getElementsByTestIdInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected();
        const options = resolveVisibleOptions(input as GetElementsByTestIdInput);
        const uiTree = await adb.getUiTree(session.deviceId, {
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
          platform: "android",
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
    { description: "Tap the Android screen at absolute coordinates. Final fallback only when testID and element-based targeting fail.", inputSchema: tapInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected();
        await retryWithBackoff(() => adb.tap(session.deviceId, input.x, input.y), {
          ...INTERACTION_RETRY,
          shouldRetry: isTransientToolError,
        });

        const payload: TapOutput = {
          tapped: true,
          method: "coordinates",
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
    { description: "Type text into the currently focused Android input field, with optional submit/enter key press.", inputSchema: typeTextInputSchema.shape },
    async (input): Promise<ToolResult> => {
      try {
        const typedInput = input as TypeTextInput;
        const session = sessionManager.requireConnected();
        const submit = typedInput.submit ?? false;
        await retryWithBackoff(() => adb.typeText(session.deviceId, typedInput.text, submit), {
          ...INTERACTION_RETRY,
          shouldRetry: isTransientToolError,
        });

        const payload: TypeTextOutput = {
          typed: true,
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
    { description: "Press Android back button (keyevent 4).", inputSchema: pressBackInputSchema.shape },
    async (): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected();
        await retryWithBackoff(() => adb.pressBack(session.deviceId), {
          ...INTERACTION_RETRY,
          shouldRetry: isTransientToolError,
        });

        const payload: PressBackOutput = {
          pressed: true,
          key: "back",
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
        const session = sessionManager.requireConnected();
        const result = await retryWithBackoff(
          () => adb.scroll(session.deviceId, input.direction, input.distanceRatio, input.durationMs),
          {
            ...INTERACTION_RETRY,
            shouldRetry: isTransientToolError,
          },
        );

        const payload: ScrollOutput = {
          scrolled: true,
          direction: input.direction,
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
        const session = sessionManager.requireConnected();
        const options = resolveTapElementOptions(input);
        const uiTree = await adb.getUiTree(session.deviceId, {
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
        await retryWithBackoff(() => adb.tap(session.deviceId, point.x, point.y), {
          ...INTERACTION_RETRY,
          shouldRetry: isTransientToolError,
        });

        const payload: TapOutput = {
          tapped: true,
          method: "element",
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
    { description: "Capture a screenshot from the connected Android device.", inputSchema: takeScreenshotInputSchema.shape },
    async (): Promise<ToolResult> => {
      try {
        const session = sessionManager.requireConnected();
        const screenshot = await adb.takeScreenshot(session.deviceId);
        const imageBase64 = screenshot.png.toString("base64");
        const tempPath = join(tmpdir(), `rndb-screenshot-${Date.now()}-${randomUUID()}.png`);
        await writeFile(tempPath, screenshot.png);

        const payload: ScreenshotOutput = {
          mimeType: "image/png",
          width: screenshot.width,
          height: screenshot.height,
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
