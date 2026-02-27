import test from "node:test";
import assert from "node:assert/strict";
import { extractVisibleElements } from "../src/core/visibleElements.js";
import type { UiNode } from "../src/types/api.js";

function makeTree(): UiNode {
  return {
    id: "node-1",
    className: "android.widget.FrameLayout",
    clickable: false,
    enabled: true,
    focusable: false,
    focused: false,
    selected: false,
    visibleToUser: true,
    scrollable: false,
    checkable: false,
    checked: false,
    children: [
      {
        id: "node-2",
        className: "android.widget.Button",
        text: "Save",
        resourceId: "com.app:id/save_button",
        clickable: true,
        enabled: true,
        focusable: true,
        focused: false,
        selected: false,
        visibleToUser: true,
        scrollable: false,
        checkable: false,
        checked: false,
        children: [],
      },
      {
        id: "node-3",
        className: "android.widget.TextView",
        text: "Hidden",
        clickable: false,
        enabled: true,
        focusable: false,
        focused: false,
        selected: false,
        visibleToUser: false,
        scrollable: false,
        checkable: false,
        checked: false,
        children: [],
      },
    ],
  };
}

test("extractVisibleElements defaults to visible actionable elements", () => {
  const result = extractVisibleElements(makeTree(), {
    limit: 50,
    clickableOnly: true,
    includeTextless: false,
    testIdMatch: "exact",
    testId: undefined,
  });

  assert.equal(result.totalCandidates, 1);
  assert.equal(result.elements.length, 1);
  assert.equal(result.elements[0].id, "node-2");
  assert.equal(result.elements[0].label, "Save");
  assert.equal(result.elements[0].testId, "save_button");
});

test("extractVisibleElements supports includeTextless and respects limit", () => {
  const result = extractVisibleElements(makeTree(), {
    limit: 1,
    clickableOnly: false,
    includeTextless: true,
    testIdMatch: "exact",
    testId: undefined,
  });

  assert.equal(result.totalCandidates, 2);
  assert.equal(result.elements.length, 1);
  assert.equal(result.elements[0].id, "node-1");
});

test("extractVisibleElements filters by testId exact and contains", () => {
  const exact = extractVisibleElements(makeTree(), {
    limit: 50,
    clickableOnly: true,
    includeTextless: false,
    testId: "save_button",
    testIdMatch: "exact",
  });
  assert.equal(exact.totalCandidates, 1);
  assert.equal(exact.elements[0].id, "node-2");

  const contains = extractVisibleElements(makeTree(), {
    limit: 50,
    clickableOnly: true,
    includeTextless: false,
    testId: "save",
    testIdMatch: "contains",
  });
  assert.equal(contains.totalCandidates, 1);
  assert.equal(contains.elements[0].testId, "save_button");
});
