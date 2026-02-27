import { z } from "zod";

export const DEFAULT_METRO_PORT = 8081;
export const DEFAULT_LOG_LIMIT = 200;
export const MAX_LOG_LIMIT = 1000;
export const DEFAULT_LOG_BUFFER_SIZE = 5000;
export const DEFAULT_NETWORK_LIMIT = 200;
export const MAX_NETWORK_LIMIT = 1000;
export const DEFAULT_NETWORK_BUFFER_SIZE = 5000;
export const DEFAULT_IOS_WDA_BASE_URL = "http://127.0.0.1:8100";

export type ErrorCode =
  | "NO_SESSION"
  | "ADB_UNAVAILABLE"
  | "IOS_UNAVAILABLE"
  | "DEVICE_NOT_FOUND"
  | "METRO_UNREACHABLE"
  | "COMMAND_FAILED";

export type Platform = "android" | "ios";
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type LogSource = "logcat" | "metro";
export type NetworkPhase = "request" | "response" | "error";
export type TestIdMatch = "exact" | "contains";
export type ResolutionStrategy = "test_id_exact" | "test_id_contains" | "none";
export type RecommendedFallback = "tap_element" | "tap_coordinates" | "add_test_id";
export type ScreenConfidence = "high" | "medium" | "low";
export type ScrollDirection = "up" | "down" | "left" | "right";
export const LOG_LEVEL_VALUES = ["debug", "info", "warn", "error", "fatal"] as const;
export const LOG_SOURCE_VALUES = ["logcat", "metro"] as const;
export const NETWORK_PHASE_VALUES = ["request", "response", "error"] as const;
export const PLATFORM_VALUES = ["android", "ios"] as const;
export const TEST_ID_MATCH_VALUES = ["exact", "contains"] as const;
export const RESOLUTION_STRATEGY_VALUES = ["test_id_exact", "test_id_contains", "none"] as const;
export const RECOMMENDED_FALLBACK_VALUES = ["tap_element", "tap_coordinates", "add_test_id"] as const;
export const SCREEN_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export const SCROLL_DIRECTION_VALUES = ["up", "down", "left", "right"] as const;

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
  sessionId?: string;
  platform?: Platform;
  deviceId?: string;
  metroPort?: number;
  startedAt?: string;
}

export interface SessionSummary extends Record<string, unknown> {
  sessionId: string;
  platform: Platform;
  status: "connected";
  deviceId: string;
  metroPort: number;
  startedAt: string;
  connectionHealth: "healthy" | "degraded" | "reconnecting";
  reconnectAttempts: number;
  lastDisconnectAt?: string;
  lastReconnectError?: string;
}

export interface ToolErrorData extends Record<string, unknown> {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ConnectAppInput {
  platform?: Platform;
  deviceId?: string;
  metroPort?: number;
}

export interface ConnectAppOutput extends Record<string, unknown> {
  connected: true;
  sessionId: string;
  platform: Platform;
  deviceId: string;
  metroPort: number;
  startedAt: string;
  capabilities: string[];
}

export interface SessionScopedInput {
  sessionId?: string;
}

export interface DisconnectAppOutput extends Record<string, unknown> {
  disconnected: true;
  sessionId?: string;
}

export interface ConnectionStatusOutput extends Record<string, unknown> {
  status: SessionState["status"];
  activeSessionId?: string;
  platform?: Platform;
  sessionId?: string;
  deviceId?: string;
  metroPort?: number;
  startedAt?: string;
  logBufferSize: number;
  networkBufferSize: number;
  connectionHealth?: "healthy" | "degraded" | "reconnecting";
  reconnectAttempts?: number;
  lastDisconnectAt?: string;
  lastReconnectError?: string;
}

export interface ReloadAppOutput extends Record<string, unknown> {
  reloaded: true;
  method: "metro" | "adb_fallback" | "ios_simulator_keyboard_fallback";
  sessionId?: string;
}

export interface GetLogsInput extends SessionScopedInput {
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

export interface NetworkRequestEntry {
  cursor: number;
  ts: string;
  source: LogSource;
  phase: NetworkPhase;
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  tag?: string;
  message: string;
  requestId?: string;
  raw?: string;
}

export interface GetNetworkRequestsInput extends SessionScopedInput {
  sinceCursor?: number;
  limit?: number;
  phases?: NetworkPhase[];
  methods?: string[];
  statuses?: number[];
  urlContains?: string;
  sources?: LogSource[];
}

export interface GetNetworkRequestsOutput extends Record<string, unknown> {
  nextCursor: number;
  items: NetworkRequestEntry[];
}

export interface ScreenshotOutput extends Record<string, unknown> {
  mimeType: "image/png";
  width?: number;
  height?: number;
  sessionId?: string;
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
  testId?: string;
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

export interface GetUiTreeInput extends SessionScopedInput {
  maxDepth?: number;
  maxNodes?: number;
}

export interface TapInput extends SessionScopedInput {
  x: number;
  y: number;
}

export interface TypeTextInput extends SessionScopedInput {
  text: string;
  submit?: boolean;
}

export interface ScrollInput extends SessionScopedInput {
  direction: ScrollDirection;
  distanceRatio?: number;
  durationMs?: number;
}

export interface TapElementInput extends GetUiTreeInput {
  elementId: string;
}

export interface GetVisibleElementsInput extends GetUiTreeInput {
  limit?: number;
  clickableOnly?: boolean;
  includeTextless?: boolean;
  skipVisibilityCheck?: boolean;
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
  platform: Platform;
  source: "uiautomator" | "wda";
  sessionId?: string;
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
  platform: Platform;
  source: "uiautomator" | "wda";
  sessionId?: string;
  deviceId: string;
  capturedAt: string;
  totalCandidates: number;
  count: number;
  maxDepth?: number;
  maxNodes?: number;
  limit: number;
  clickableOnly: boolean;
  includeTextless: boolean;
  skipVisibilityCheck: boolean;
  queryTestId?: string;
  testIdMatch: TestIdMatch;
  resolutionStrategy: ResolutionStrategy;
  recommendedFallback: RecommendedFallback;
  truncated: boolean;
  elements: VisibleElement[];
}

export interface GetElementsByTestIdInput extends GetUiTreeInput, SessionScopedInput {
  testId: string;
  limit?: number;
  clickableOnly?: boolean;
  includeTextless?: boolean;
  skipVisibilityCheck?: boolean;
  testIdMatch?: TestIdMatch;
}

export interface GetScreenTestIdsInput extends GetUiTreeInput, SessionScopedInput {
  limit?: number;
  includeNonClickable?: boolean;
  includeInvisible?: boolean;
}

export interface ScreenTestIdsOutput extends Record<string, unknown> {
  platform: Platform;
  source: "uiautomator" | "wda";
  sessionId?: string;
  deviceId: string;
  capturedAt: string;
  maxDepth?: number;
  maxNodes?: number;
  limit: number;
  includeNonClickable: boolean;
  includeInvisible: boolean;
  count: number;
  totalCandidates: number;
  testIds: string[];
  elements: VisibleElement[];
  truncated: boolean;
}

export interface TapOutput extends Record<string, unknown> {
  tapped: true;
  method: "coordinates" | "element";
  sessionId?: string;
  deviceId: string;
  x: number;
  y: number;
  elementId?: string;
}

export interface TypeTextOutput extends Record<string, unknown> {
  typed: true;
  sessionId?: string;
  deviceId: string;
  textLength: number;
  submitted: boolean;
}

export interface PressBackOutput extends Record<string, unknown> {
  pressed: true;
  key: "back";
  sessionId?: string;
  deviceId: string;
}

export interface ScrollOutput extends Record<string, unknown> {
  scrolled: true;
  direction: ScrollDirection;
  sessionId?: string;
  deviceId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  durationMs: number;
}

export interface ScreenContextOutput extends Record<string, unknown> {
  platform: Platform;
  sessionId?: string;
  deviceId: string;
  capturedAt: string;
  activity?: string;
  activityShort?: string;
  packageName?: string;
  uiTitleCandidates: string[];
  primaryTitle?: string;
  screenSlug: string;
  confidence: ScreenConfidence;
}

export interface GetTestIdRemediationPlanInput extends SessionScopedInput {
  desiredAction: string;
  desiredTestId?: string;
  matchMode?: TestIdMatch;
}

export interface PatchHint extends Record<string, unknown> {
  searchTerms: string[];
  preferredComponentHints: string[];
  exampleSnippet: string;
}

export interface RemediationStep extends Record<string, unknown> {
  step: string;
  reason: string;
}

export interface TestIdRemediationPlanOutput extends Record<string, unknown> {
  screenContext: ScreenContextOutput;
  suggestedTestId: string;
  normalizedDesiredTestId?: string;
  desiredTestIdWarning?: string;
  elementCandidates: VisibleElement[];
  patchHint: PatchHint;
  matchMode: TestIdMatch;
  nextSteps: RemediationStep[];
}

export interface ListSessionsInput extends Record<string, never> {}

export interface ListSessionsOutput extends Record<string, unknown> {
  activeSessionId?: string;
  count: number;
  sessions: SessionSummary[];
}

export interface SetActiveSessionInput {
  sessionId: string;
}

export interface SetActiveSessionOutput extends Record<string, unknown> {
  activeSessionId: string;
}

export interface CloseSessionInput {
  sessionId: string;
}

export interface CloseSessionOutput extends Record<string, unknown> {
  closed: true;
  sessionId: string;
}

export const connectAppInputSchema = z.object({
  platform: z.enum(PLATFORM_VALUES).optional(),
  deviceId: z.string().min(1).optional(),
  metroPort: z.number().int().positive().optional(),
});

export const disconnectAppInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
});
export const connectionStatusInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
});
export const getScreenContextInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
});
export const reloadAppInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
});

export const getLogsInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  sinceCursor: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(MAX_LOG_LIMIT).optional(),
  levels: z.array(z.enum(LOG_LEVEL_VALUES)).min(1).optional(),
  tags: z.array(z.string().min(1)).min(1).optional(),
  sources: z.array(z.enum(LOG_SOURCE_VALUES)).min(1).optional(),
});

export const getNetworkRequestsInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  sinceCursor: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(MAX_NETWORK_LIMIT).optional(),
  phases: z.array(z.enum(NETWORK_PHASE_VALUES)).min(1).optional(),
  methods: z.array(z.string().min(1)).min(1).optional(),
  statuses: z.array(z.number().int().min(100).max(599)).min(1).optional(),
  urlContains: z.string().min(1).optional(),
  sources: z.array(z.enum(LOG_SOURCE_VALUES)).min(1).optional(),
});

export const takeScreenshotInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
});

export const getUiTreeInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  maxDepth: z.number().int().nonnegative().max(50).optional(),
  maxNodes: z.number().int().positive().max(5000).optional(),
});

export const getVisibleElementsInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  maxDepth: z.number().int().nonnegative().max(50).optional(),
  maxNodes: z.number().int().positive().max(5000).optional(),
  limit: z.number().int().positive().max(2000).optional(),
  clickableOnly: z.boolean().optional(),
  includeTextless: z.boolean().optional(),
  skipVisibilityCheck: z.boolean().optional(),
  testId: z.string().min(1).optional(),
  testIdMatch: z.enum(TEST_ID_MATCH_VALUES).optional(),
});

export const getElementsByTestIdInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  testId: z.string().min(1),
  maxDepth: z.number().int().nonnegative().max(50).optional(),
  maxNodes: z.number().int().positive().max(5000).optional(),
  limit: z.number().int().positive().max(2000).optional(),
  clickableOnly: z.boolean().optional(),
  includeTextless: z.boolean().optional(),
  skipVisibilityCheck: z.boolean().optional(),
  testIdMatch: z.enum(TEST_ID_MATCH_VALUES).optional(),
});

export const getScreenTestIdsInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  maxDepth: z.number().int().nonnegative().max(50).optional(),
  maxNodes: z.number().int().positive().max(5000).optional(),
  limit: z.number().int().positive().max(2000).optional(),
  includeNonClickable: z.boolean().optional(),
  includeInvisible: z.boolean().optional(),
});

export const tapInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

export const typeTextInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  text: z.string().min(1),
  submit: z.boolean().optional(),
});

export const pressBackInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
});

export const scrollInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  direction: z.enum(SCROLL_DIRECTION_VALUES),
  distanceRatio: z.number().positive().max(1).optional(),
  durationMs: z.number().int().positive().max(5000).optional(),
});

export const tapElementInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  elementId: z.string().min(1),
  maxDepth: z.number().int().nonnegative().max(50).optional(),
  maxNodes: z.number().int().positive().max(5000).optional(),
});

export const getTestIdRemediationPlanInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  desiredAction: z.string().min(1),
  desiredTestId: z.string().min(1).optional(),
  matchMode: z.enum(TEST_ID_MATCH_VALUES).optional(),
});

export const listSessionsInputSchema = z.object({});

export const setActiveSessionInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const closeSessionInputSchema = z.object({
  sessionId: z.string().min(1),
});
