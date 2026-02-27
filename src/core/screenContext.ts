import type { ScreenConfidence, ScreenContextOutput, UiNode } from "../types/api.js";

interface ActivityContext {
  activity?: string;
  activityShort?: string;
  packageName?: string;
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");
}

function splitActivity(component: string): ActivityContext {
  const [pkg, rawActivity] = component.split("/");
  if (!pkg || !rawActivity) {
    return {};
  }

  const fullActivity = rawActivity.startsWith(".") ? `${pkg}${rawActivity}` : rawActivity;
  const short = fullActivity.split(".").pop();

  return {
    activity: fullActivity,
    activityShort: short,
    packageName: pkg,
  };
}

function parseFromActivityDump(dump: string): ActivityContext {
  const patterns = [
    /mResumedActivity:.*\s([A-Za-z0-9._$]+\/[A-Za-z0-9._$]+)\b/,
    /topResumedActivity.*\s([A-Za-z0-9._$]+\/[A-Za-z0-9._$]+)\b/,
    /ResumedActivity:.*\s([A-Za-z0-9._$]+\/[A-Za-z0-9._$]+)\b/,
  ];

  for (const pattern of patterns) {
    const match = dump.match(pattern);
    if (match?.[1]) {
      return splitActivity(match[1]);
    }
  }

  return {};
}

function parseFromWindowDump(dump: string): ActivityContext {
  const patterns = [
    /mCurrentFocus=.*\s([A-Za-z0-9._$]+\/[A-Za-z0-9._$]+)\}/,
    /mFocusedApp=.*\s([A-Za-z0-9._$]+\/[A-Za-z0-9._$]+)\b/,
  ];

  for (const pattern of patterns) {
    const match = dump.match(pattern);
    if (match?.[1]) {
      return splitActivity(match[1]);
    }
  }

  return {};
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

function makeScreenSlug(activityShort: string | undefined, primaryTitle: string | undefined): string {
  const baseRaw = activityShort ?? "unknown_screen";
  const base = normalizeToken(baseRaw.replace(/(activity|screen|fragment)$/i, "")) || "screen";
  const title = primaryTitle ? normalizeToken(primaryTitle) : "";

  if (!title) {
    return base;
  }

  return `${base}.${title}`.replace(/\.+/g, ".").replace(/^\.|\.$/g, "");
}

function confidenceFor(activity?: string, primaryTitle?: string): ScreenConfidence {
  if (activity && primaryTitle) {
    return "high";
  }

  if (activity) {
    return "medium";
  }

  return "low";
}

export function buildScreenContext(params: {
  deviceId: string;
  capturedAt: string;
  activityDump?: string;
  windowDump?: string;
  uiRoot?: UiNode;
}): ScreenContextOutput {
  const fromActivity = params.activityDump ? parseFromActivityDump(params.activityDump) : {};
  const fromWindow = params.windowDump ? parseFromWindowDump(params.windowDump) : {};

  const merged: ActivityContext = {
    activity: fromActivity.activity ?? fromWindow.activity,
    activityShort: fromActivity.activityShort ?? fromWindow.activityShort,
    packageName: fromActivity.packageName ?? fromWindow.packageName,
  };

  const uiTitleCandidates = collectUiTitles(params.uiRoot);
  const primaryTitle = uiTitleCandidates[0];
  const screenSlug = makeScreenSlug(merged.activityShort, primaryTitle);

  return {
    platform: "android",
    deviceId: params.deviceId,
    capturedAt: params.capturedAt,
    activity: merged.activity,
    activityShort: merged.activityShort,
    packageName: merged.packageName,
    uiTitleCandidates,
    primaryTitle,
    screenSlug,
    confidence: confidenceFor(merged.activity, primaryTitle),
  };
}
