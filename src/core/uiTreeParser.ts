import type { UiBounds, UiNode } from "../types/api.js";

export interface UiTreeParseResult {
  root?: UiNode;
  nodeCount: number;
  clickableCount: number;
}

export interface UiTreePruneOptions {
  maxDepth?: number;
  maxNodes?: number;
}

export interface UiTreePruneResult {
  root?: UiNode;
  nodeCount: number;
  clickableCount: number;
  truncated: boolean;
}

const NODE_TAG_PATTERN = /<\/?node\b[^>]*>/g;
const ATTR_PATTERN = /([\w:-]+)="([^"]*)"/g;
const BOUNDS_PATTERN = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};

  let match: RegExpExecArray | null;
  while ((match = ATTR_PATTERN.exec(tag)) !== null) {
    attributes[match[1]] = decodeXml(match[2]);
  }

  ATTR_PATTERN.lastIndex = 0;
  return attributes;
}

function parseBoolean(value?: string): boolean {
  return value === "true";
}

function parseBounds(raw?: string): UiBounds | undefined {
  if (!raw) {
    return undefined;
  }

  const match = raw.match(BOUNDS_PATTERN);
  if (!match) {
    return undefined;
  }

  const left = Number.parseInt(match[1], 10);
  const top = Number.parseInt(match[2], 10);
  const right = Number.parseInt(match[3], 10);
  const bottom = Number.parseInt(match[4], 10);

  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function normalizeText(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function createNode(attributes: Record<string, string>, id: number): UiNode {
  return {
    id: `node-${id}`,
    className: normalizeText(attributes.class),
    resourceId: normalizeText(attributes["resource-id"]),
    packageName: normalizeText(attributes.package),
    text: normalizeText(attributes.text),
    contentDescription: normalizeText(attributes["content-desc"]),
    bounds: parseBounds(attributes.bounds),
    clickable: parseBoolean(attributes.clickable),
    enabled: parseBoolean(attributes.enabled),
    focusable: parseBoolean(attributes.focusable),
    focused: parseBoolean(attributes.focused),
    selected: parseBoolean(attributes.selected),
    visibleToUser: parseBoolean(attributes["visible-to-user"]),
    scrollable: parseBoolean(attributes.scrollable),
    checkable: parseBoolean(attributes.checkable),
    checked: parseBoolean(attributes.checked),
    children: [],
  };
}

export function parseUiAutomatorXml(xml: string): UiTreeParseResult {
  const roots: UiNode[] = [];
  const stack: UiNode[] = [];
  let id = 1;

  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = NODE_TAG_PATTERN.exec(xml)) !== null) {
    const tag = tagMatch[0];

    if (tag.startsWith("</")) {
      stack.pop();
      continue;
    }

    const attributes = parseAttributes(tag);
    const node = createNode(attributes, id);
    id += 1;

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }

    const selfClosing = tag.endsWith("/>");
    if (!selfClosing) {
      stack.push(node);
    }
  }

  if (roots.length === 0) {
    return {
      root: undefined,
      nodeCount: 0,
      clickableCount: 0,
    };
  }

  const root = roots[0];
  for (let i = 1; i < roots.length; i += 1) {
    root.children.push(roots[i]);
  }

  let nodeCount = 0;
  let clickableCount = 0;
  const visit = (node: UiNode): void => {
    nodeCount += 1;
    if (node.clickable) {
      clickableCount += 1;
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);

  return { root, nodeCount, clickableCount };
}

function cloneNodeWithoutChildren(node: UiNode): UiNode {
  return {
    ...node,
    children: [],
  };
}

export function pruneUiTree(root: UiNode | undefined, options: UiTreePruneOptions): UiTreePruneResult {
  if (!root) {
    return {
      root: undefined,
      nodeCount: 0,
      clickableCount: 0,
      truncated: false,
    };
  }

  const maxDepth = options.maxDepth;
  const maxNodes = options.maxNodes;

  let used = 0;
  let clickableCount = 0;
  let truncated = false;

  const visit = (node: UiNode, depth: number): UiNode | undefined => {
    if (maxNodes !== undefined && used >= maxNodes) {
      truncated = true;
      return undefined;
    }

    used += 1;
    const clone = cloneNodeWithoutChildren(node);

    if (clone.clickable) {
      clickableCount += 1;
    }

    if (maxDepth !== undefined && depth >= maxDepth) {
      if (node.children.length > 0) {
        truncated = true;
      }
      return clone;
    }

    for (const child of node.children) {
      const childClone = visit(child, depth + 1);
      if (childClone) {
        clone.children.push(childClone);
      } else {
        truncated = true;
      }

      if (maxNodes !== undefined && used >= maxNodes) {
        if (node.children.length > clone.children.length) {
          truncated = true;
        }
        break;
      }
    }

    return clone;
  };

  const prunedRoot = visit(root, 0);

  return {
    root: prunedRoot,
    nodeCount: used,
    clickableCount,
    truncated,
  };
}
