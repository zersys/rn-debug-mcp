import { z } from "zod";

export const DEFAULT_METRO_PORT = 8081;
export const DEFAULT_LOG_LIMIT = 200;
export const MAX_LOG_LIMIT = 1000;
export const DEFAULT_LOG_BUFFER_SIZE = 5000;

export type ErrorCode =
  | "NO_SESSION"
  | "ADB_UNAVAILABLE"
  | "DEVICE_NOT_FOUND"
  | "METRO_UNREACHABLE"
  | "COMMAND_FAILED";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type LogSource = "logcat" | "metro";
export type TestIdMatch = "exact" | "contains";
export const LOG_LEVEL_VALUES = ["debug", "info", "warn", "error", "fatal"] as const;
export const LOG_SOURCE_VALUES = ["logcat", "metro"] as const;
export const TEST_ID_MATCH_VALUES = ["exact", "contains"] as const;

export interface LogEntry {
  cursor: number;
  ts: string;
  level: LogLevel;
  source: LogSource;
  tag?: string;
  message: string;
  raw?: string;
}

export interface SessionState {
  status: "disconnected" | "connecting" | "connected";
  deviceId?: string;
  metroPort?: number;
  startedAt?: string;
}

export interface ToolErrorData extends Record<string, unknown> {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ConnectAppInput {
  deviceId?: string;
  metroPort?: number;
}

export interface ConnectAppOutput extends Record<string, unknown> {
  connected: true;
  deviceId: string;
  metroPort: number;
  startedAt: string;
  capabilities: string[];
}

export interface DisconnectAppOutput extends Record<string, unknown> {
  disconnected: true;
}

export interface ConnectionStatusOutput extends Record<string, unknown> {
  status: SessionState["status"];
  deviceId?: string;
  metroPort?: number;
  startedAt?: string;
  logBufferSize: number;
}

export interface ReloadAppOutput extends Record<string, unknown> {
  reloaded: true;
  method: "metro" | "adb_fallback";
}

export interface GetLogsInput {
  sinceCursor?: number;
  limit?: number;
  levels?: LogLevel[];
  tags?: string[];
  sources?: LogSource[];
}

export interface GetLogsOutput extends Record<string, unknown> {
  nextCursor: number;
  items: LogEntry[];
}

export interface ScreenshotOutput extends Record<string, unknown> {
  mimeType: "image/png";
  width?: number;
  height?: number;
  deviceId: string;
  capturedAt: string;
  tempPath: string;
  delivery: "mcp_image_content_and_temp_file";
}

export interface UiBounds extends Record<string, unknown> {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface UiNode extends Record<string, unknown> {
  id: string;
  className?: string;
  resourceId?: string;
  packageName?: string;
  text?: string;
  contentDescription?: string;
  bounds?: UiBounds;
  clickable: boolean;
  enabled: boolean;
  focusable: boolean;
  focused: boolean;
  selected: boolean;
  visibleToUser: boolean;
  scrollable: boolean;
  checkable: boolean;
  checked: boolean;
  children: UiNode[];
}

export interface GetUiTreeInput {
  maxDepth?: number;
  maxNodes?: number;
}

export interface TapInput {
  x: number;
  y: number;
}

export interface TapElementInput extends GetUiTreeInput {
  elementId: string;
}

export interface GetVisibleElementsInput extends GetUiTreeInput {
  limit?: number;
  clickableOnly?: boolean;
  includeTextless?: boolean;
  testId?: string;
  testIdMatch?: TestIdMatch;
}

export interface VisibleElement extends Record<string, unknown> {
  id: string;
  testId?: string;
  className?: string;
  resourceId?: string;
  text?: string;
  contentDescription?: string;
  label?: string;
  bounds?: UiBounds;
  clickable: boolean;
  enabled: boolean;
  focusable: boolean;
  selected: boolean;
  visibleToUser: boolean;
}

export interface UiTreeOutput extends Record<string, unknown> {
  platform: "android";
  source: "uiautomator";
  deviceId: string;
  capturedAt: string;
  nodeCount: number;
  clickableCount: number;
  maxDepth?: number;
  maxNodes?: number;
  truncated: boolean;
  root?: UiNode;
}

export interface VisibleElementsOutput extends Record<string, unknown> {
  platform: "android";
  source: "uiautomator";
  deviceId: string;
  capturedAt: string;
  totalCandidates: number;
  count: number;
  maxDepth?: number;
  maxNodes?: number;
  limit: number;
  clickableOnly: boolean;
  includeTextless: boolean;
  queryTestId?: string;
  testIdMatch: TestIdMatch;
  truncated: boolean;
  elements: VisibleElement[];
}

export interface GetElementsByTestIdInput extends GetUiTreeInput {
  testId: string;
  limit?: number;
  clickableOnly?: boolean;
  includeTextless?: boolean;
  testIdMatch?: TestIdMatch;
}

export interface TapOutput extends Record<string, unknown> {
  tapped: true;
  method: "coordinates" | "element";
  deviceId: string;
  x: number;
  y: number;
  elementId?: string;
}

export const connectAppInputSchema = z.object({
  deviceId: z.string().min(1).optional(),
  metroPort: z.number().int().positive().optional(),
});

export const disconnectAppInputSchema = z.object({});
export const connectionStatusInputSchema = z.object({});
export const reloadAppInputSchema = z.object({});

export const getLogsInputSchema = z.object({
  sinceCursor: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(MAX_LOG_LIMIT).optional(),
  levels: z.array(z.enum(LOG_LEVEL_VALUES)).min(1).optional(),
  tags: z.array(z.string().min(1)).min(1).optional(),
  sources: z.array(z.enum(LOG_SOURCE_VALUES)).min(1).optional(),
});

export const takeScreenshotInputSchema = z.object({});

export const getUiTreeInputSchema = z.object({
  maxDepth: z.number().int().nonnegative().max(50).optional(),
  maxNodes: z.number().int().positive().max(5000).optional(),
});

export const getVisibleElementsInputSchema = z.object({
  maxDepth: z.number().int().nonnegative().max(50).optional(),
  maxNodes: z.number().int().positive().max(5000).optional(),
  limit: z.number().int().positive().max(2000).optional(),
  clickableOnly: z.boolean().optional(),
  includeTextless: z.boolean().optional(),
  testId: z.string().min(1).optional(),
  testIdMatch: z.enum(TEST_ID_MATCH_VALUES).optional(),
});

export const getElementsByTestIdInputSchema = z.object({
  testId: z.string().min(1),
  maxDepth: z.number().int().nonnegative().max(50).optional(),
  maxNodes: z.number().int().positive().max(5000).optional(),
  limit: z.number().int().positive().max(2000).optional(),
  clickableOnly: z.boolean().optional(),
  includeTextless: z.boolean().optional(),
  testIdMatch: z.enum(TEST_ID_MATCH_VALUES).optional(),
});

export const tapInputSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

export const tapElementInputSchema = z.object({
  elementId: z.string().min(1),
  maxDepth: z.number().int().nonnegative().max(50).optional(),
  maxNodes: z.number().int().positive().max(5000).optional(),
});
