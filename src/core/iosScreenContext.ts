import type { ScreenContextOutput, UiNode } from "../types/api.js";

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");
}

interface RankedText {
  text: string;
  top: number;
  left: number;
  depth: number;
}

function rankVisibleTexts(root: UiNode): RankedText[] {
  const ranked: RankedText[] = [];

  const visit = (node: UiNode, depth: number): void => {
    if (node.visibleToUser && node.text && node.text.trim().length > 0) {
      ranked.push({
        text: node.text.trim(),
        top: node.bounds?.top ?? Number.MAX_SAFE_INTEGER,
        left: node.bounds?.left ?? Number.MAX_SAFE_INTEGER,
        depth,
      });
    }

    for (const child of node.children) {
      visit(child, depth + 1);
    }
  };

  visit(root, 0);

  ranked.sort((a, b) => {
    if (a.top !== b.top) {
      return a.top - b.top;
    }
    if (a.left !== b.left) {
      return a.left - b.left;
    }
    return a.depth - b.depth;
  });

  return ranked;
}

function collectUiTitles(root: UiNode | undefined): string[] {
  if (!root) {
    return [];
  }

  const rootHeight = root.bounds?.height ?? Math.max(1, root.bounds ? root.bounds.bottom - root.bounds.top : 1000);
  const topThreshold = root.bounds ? root.bounds.top + Math.floor(rootHeight * 0.3) : 300;
  const allRanked = rankVisibleTexts(root);
  const ranked = allRanked.filter((entry) => entry.top <= topThreshold);
  const pool = ranked.length > 0 ? ranked : allRanked;

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of pool) {
    const key = item.text.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item.text);
    }
    if (unique.length >= 8) {
      break;
    }
  }

  return unique;
}

function makeScreenSlug(appName: string | undefined, primaryTitle: string | undefined): string {
  const baseRaw = appName ?? "ios_screen";
  const base = normalizeToken(baseRaw.replace(/(controller|view)$/i, "")) || "screen";
  const title = primaryTitle ? normalizeToken(primaryTitle) : "";
  return title ? `${base}.${title}` : base;
}

export function buildIosScreenContext(params: {
  sessionId: string;
  deviceId: string;
  capturedAt: string;
  bundleId?: string;
  appName?: string;
  uiRoot?: UiNode;
}): ScreenContextOutput {
  const uiTitleCandidates = collectUiTitles(params.uiRoot);
  const primaryTitle = uiTitleCandidates[0];
  const screenSlug = makeScreenSlug(params.appName, primaryTitle);

  return {
    platform: "ios",
    sessionId: params.sessionId,
    deviceId: params.deviceId,
    capturedAt: params.capturedAt,
    activity: params.appName,
    activityShort: params.appName,
    packageName: params.bundleId,
    uiTitleCandidates,
    primaryTitle,
    screenSlug,
    confidence: params.bundleId || primaryTitle ? "medium" : "low",
  };
}
