import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseLogcatLine, isErrorLevel } from "../core/logParser.js";
import { retryWithBackoff } from "../core/retry.js";
import { SessionManager } from "../core/sessionManager.js";
import { ToolError } from "../core/toolError.js";
import { extractVisibleElements } from "../core/visibleElements.js";
import type { ScreenshotResult } from "../adapters/adb.js";
import type { SpawnedProcess } from "../adapters/processRunner.js";
import type { LogBuffer } from "../core/logBuffer.js";
import {
  DEFAULT_LOG_LIMIT,
  DEFAULT_METRO_PORT,
  MAX_LOG_LIMIT,
  connectAppInputSchema,
  connectionStatusInputSchema,
  disconnectAppInputSchema,
  getElementsByTestIdInputSchema,
  getVisibleElementsInputSchema,
  getUiTreeInputSchema,
  getLogsInputSchema,
  reloadAppInputSchema,
  tapElementInputSchema,
  tapInputSchema,
  takeScreenshotInputSchema,
  type ConnectionStatusOutput,
  type ConnectAppOutput,
  type DisconnectAppOutput,
  type LogEntry,
  type GetElementsByTestIdInput,
  type GetVisibleElementsInput,
  type GetLogsInput,
  type GetLogsOutput,
  type GetUiTreeInput,
  type ReloadAppOutput,
  type ScreenshotOutput,
  type TapElementInput,
  type TapOutput,
  type ToolErrorData,
  type VisibleElementsOutput,
  type TestIdMatch,
  type UiNode,
  type UiTreeOutput,
} from "../types/api.js";

export interface ToolDependencies {
  sessionManager: SessionManager;
  logBuffer: LogBuffer;
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

const DEFAULT_UI_TREE_MAX_DEPTH = 18;
const DEFAULT_UI_TREE_MAX_NODES = 1200;
const DEFAULT_VISIBLE_ELEMENTS_LIMIT = 150;

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
  testId?: string;
  testIdMatch: TestIdMatch;
} {
  return {
    maxDepth: input.maxDepth ?? DEFAULT_UI_TREE_MAX_DEPTH,
    maxNodes: input.maxNodes ?? DEFAULT_UI_TREE_MAX_NODES,
    limit: input.limit ?? DEFAULT_VISIBLE_ELEMENTS_LIMIT,
    clickableOnly: input.clickableOnly ?? true,
    includeTextless: input.includeTextless ?? false,
    testId: input.testId,
    testIdMatch: input.testIdMatch ?? "exact",
  };
}

export function registerTools(server: McpServer, deps: ToolDependencies): void {
  const { sessionManager, logBuffer, adb, metro } = deps;

  server.tool(
    "connect_app",
    "Connect to a running React Native app on Android emulator and start log collection.",
    connectAppInputSchema.shape,
    async (input): Promise<ToolResult> => {
      let beganConnecting = false;
      try {
        sessionManager.beginConnecting();
        beganConnecting = true;
        logBuffer.clear();

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
            "get_ui_tree",
            "get_visible_elements",
            "get_elements_by_test_id",
            "tap",
            "tap_element",
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

  server.tool(
    "get_connection_status",
    "Get current RN Inspector MCP session status and log buffer state.",
    connectionStatusInputSchema.shape,
    async (): Promise<ToolResult> => {
      try {
        const state = sessionManager.getState();
        const payload: ConnectionStatusOutput = {
          status: state.status,
          deviceId: state.deviceId,
          metroPort: state.metroPort,
          startedAt: state.startedAt,
          logBufferSize: logBuffer.size(),
        };
        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "disconnect_app",
    "Disconnect the active React Native app session.",
    disconnectAppInputSchema.shape,
    async (): Promise<ToolResult> => {
      try {
        await sessionManager.reset();
        logBuffer.clear();

        const payload: DisconnectAppOutput = { disconnected: true };
        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "reload_app",
    "Reload the active app session via Metro, with ADB fallback.",
    reloadAppInputSchema.shape,
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

  server.tool(
    "get_logs",
    "Read buffered non-error logs using cursor-based pagination.",
    getLogsInputSchema.shape,
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

  server.tool(
    "get_errors",
    "Read buffered error and fatal logs using cursor-based pagination.",
    getLogsInputSchema.shape,
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

  server.tool(
    "get_ui_tree",
    "Read the Android accessibility hierarchy via UIAutomator XML dump.",
    getUiTreeInputSchema.shape,
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

  server.tool(
    "get_visible_elements",
    "Return flattened visible Android accessibility elements derived from the current UI tree.",
    getVisibleElementsInputSchema.shape,
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
          queryTestId: options.testId,
          testIdMatch: options.testIdMatch,
          truncated: uiTree.truncated || extracted.totalCandidates > extracted.elements.length,
          elements: extracted.elements,
        };

        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "get_elements_by_test_id",
    "Find visible Android elements matching a React Native testID (from resource-id tail).",
    getElementsByTestIdInputSchema.shape,
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
          queryTestId: input.testId,
          testIdMatch: options.testIdMatch,
          truncated: uiTree.truncated || extracted.totalCandidates > extracted.elements.length,
          elements: extracted.elements,
        };

        return ok(payload);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "tap",
    "Tap the Android screen at absolute coordinates.",
    tapInputSchema.shape,
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

  server.tool(
    "tap_element",
    "Tap a visible element by element id from get_visible_elements/get_ui_tree.",
    tapElementInputSchema.shape,
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

  server.tool(
    "take_screenshot",
    "Capture a screenshot from the connected Android device.",
    takeScreenshotInputSchema.shape,
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
