import type { GetVisibleElementsInput, TestIdMatch, UiNode, VisibleElement } from "../types/api.js";

export interface VisibleExtractionResult {
  totalCandidates: number;
  elements: VisibleElement[];
}

function buildLabel(node: UiNode): string | undefined {
  return node.text ?? node.contentDescription ?? node.resourceId;
}

function extractTestId(node: UiNode): string | undefined {
  if (!node.resourceId) {
    return undefined;
  }

  const match = node.resourceId.match(/[:/]([^/:]+)$/);
  return match?.[1] ?? node.resourceId;
}

function matchesTestId(candidate: string | undefined, query: string, mode: TestIdMatch): boolean {
  if (!candidate) {
    return false;
  }

  const left = candidate.toLowerCase();
  const right = query.toLowerCase();
  if (mode === "contains") {
    return left.includes(right);
  }

  return left === right;
}

function qualifies(
  node: UiNode,
  options: Required<Pick<GetVisibleElementsInput, "clickableOnly" | "includeTextless" | "testIdMatch">> &
    Pick<GetVisibleElementsInput, "testId">,
): boolean {
  if (!node.visibleToUser) {
    return false;
  }

  if (options.clickableOnly && (!node.clickable || !node.enabled)) {
    return false;
  }

  if (!options.includeTextless) {
    const hasTextSignal = Boolean(node.text || node.contentDescription || node.resourceId || extractTestId(node));
    if (!hasTextSignal) {
      return false;
    }
  }

  if (options.testId) {
    const testId = extractTestId(node);
    if (!matchesTestId(testId, options.testId, options.testIdMatch)) {
      return false;
    }
  }

  return true;
}

export function extractVisibleElements(
  root: UiNode | undefined,
  options: Required<Pick<GetVisibleElementsInput, "clickableOnly" | "includeTextless" | "testIdMatch">> &
    Pick<GetVisibleElementsInput, "testId"> & { limit: number },
): VisibleExtractionResult {
  if (!root) {
    return { totalCandidates: 0, elements: [] };
  }

  const out: VisibleElement[] = [];
  let totalCandidates = 0;

  const visit = (node: UiNode): void => {
    if (qualifies(node, options)) {
      totalCandidates += 1;
      if (out.length < options.limit) {
        out.push({
          id: node.id,
          testId: extractTestId(node),
          className: node.className,
          resourceId: node.resourceId,
          text: node.text,
          contentDescription: node.contentDescription,
          label: buildLabel(node),
          bounds: node.bounds,
          clickable: node.clickable,
          enabled: node.enabled,
          focusable: node.focusable,
          selected: node.selected,
          visibleToUser: node.visibleToUser,
        });
      }
    }

    for (const child of node.children) {
      visit(child);
    }
  };

  visit(root);

  return {
    totalCandidates,
    elements: out,
  };
}
