import { pruneUiTree, type UiTreePruneOptions } from "./uiTreeParser.js";
import type { UiNode } from "../types/api.js";

export interface WdaUiTreeResult {
  root?: UiNode;
  nodeCount: number;
  clickableCount: number;
  truncated: boolean;
  source: "wda";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function boolish(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true" || value === "1") {
      return true;
    }
    if (value.toLowerCase() === "false" || value === "0") {
      return false;
    }
  }
  return fallback;
}

function looksClickable(typeName: string): boolean {
  return /(Button|Cell|Link|Switch|Segment|TextField|SecureTextField|Image)/i.test(typeName);
}

function looksScrollable(typeName: string): boolean {
  return /(ScrollView|Table|Collection|WebView)/i.test(typeName);
}

function normalizedNonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function inferStableTestId(candidate: string | undefined): string | undefined {
  if (!candidate) {
    return undefined;
  }
  if (candidate.length < 3 || candidate.length > 80) {
    return undefined;
  }
  if (/\s/.test(candidate)) {
    return undefined;
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(candidate)) {
    return undefined;
  }
  if (!/[-._:]/.test(candidate)) {
    return undefined;
  }
  return candidate;
}

function extractRect(raw: Record<string, unknown>): { x: number; y: number; width: number; height: number } | undefined {
  const rect = (raw.rect ?? raw.frame ?? raw.bounds) as Record<string, unknown> | undefined;
  if (rect) {
    const x = asNumber(rect.x ?? rect.left);
    const y = asNumber(rect.y ?? rect.top);
    const width = asNumber(rect.width);
    const height = asNumber(rect.height);
    if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
      return { x, y, width, height };
    }
  }

  const x = asNumber(raw.x);
  const y = asNumber(raw.y);
  const width = asNumber(raw.width);
  const height = asNumber(raw.height);
  if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
    return { x, y, width, height };
  }

  return undefined;
}

function toUiNode(raw: Record<string, unknown>, nextId: () => string): UiNode {
  const typeName = String(raw.type ?? raw.className ?? raw.class ?? "XCUIElementTypeOther");
  const name = normalizedNonEmpty(raw.name);
  const label = normalizedNonEmpty(raw.label);
  const value = normalizedNonEmpty(raw.value);
  const identifier =
    normalizedNonEmpty(raw.identifier) ??
    normalizedNonEmpty(raw.accessibilityIdentifier) ??
    inferStableTestId(name) ??
    inferStableTestId(label);

  const enabled = boolish(raw.enabled, true);
  const visible = boolish(raw.visible ?? raw.isVisible, true);
  const selected = boolish(raw.selected, false);
  const accessible = boolish(raw.accessible, true);
  const clickable = enabled && (boolish(raw.hittable, false) || looksClickable(typeName));
  const rect = extractRect(raw);
  const childrenRaw = Array.isArray(raw.children) ? (raw.children as Array<Record<string, unknown>>) : [];

  return {
    id:
      (typeof raw.uid === "string" && raw.uid) ||
      (typeof raw.id === "string" && raw.id) ||
      (typeof raw.elementId === "string" && raw.elementId) ||
      nextId(),
    testId: identifier,
    className: typeName,
    resourceId: identifier,
    packageName: typeof raw.bundleId === "string" ? raw.bundleId : undefined,
    text: value ?? label,
    contentDescription: label ?? name,
    bounds: rect
      ? {
          left: Math.floor(rect.x),
          top: Math.floor(rect.y),
          right: Math.floor(rect.x + rect.width),
          bottom: Math.floor(rect.y + rect.height),
          width: Math.floor(rect.width),
          height: Math.floor(rect.height),
        }
      : undefined,
    clickable,
    enabled,
    focusable: /TextField|SecureTextField/i.test(typeName),
    focused: false,
    selected,
    visibleToUser: visible && accessible,
    scrollable: looksScrollable(typeName),
    checkable: /Switch/i.test(typeName),
    checked: boolish(raw.value === "1" || raw.value === "true", false),
    children: childrenRaw.map((child) => toUiNode(child, nextId)),
  };
}

function unwrapWdaSource(raw: unknown): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }

  if (typeof raw === "string") {
    return undefined;
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.value && typeof obj.value === "object") {
      return obj.value as Record<string, unknown>;
    }
    return obj;
  }

  return undefined;
}

export function parseWdaUiTree(rawSource: unknown, options: UiTreePruneOptions = {}): WdaUiTreeResult {
  const rootRaw = unwrapWdaSource(rawSource);
  if (!rootRaw) {
    return {
      root: undefined,
      nodeCount: 0,
      clickableCount: 0,
      truncated: false,
      source: "wda",
    };
  }

  let idCounter = 0;
  const nextId = (): string => {
    idCounter += 1;
    return `ios-node-${idCounter}`;
  };

  const root = toUiNode(rootRaw, nextId);
  const pruned = pruneUiTree(root, options);

  return {
    root: pruned.root,
    nodeCount: pruned.nodeCount,
    clickableCount: pruned.clickableCount,
    truncated: pruned.truncated,
    source: "wda",
  };
}
