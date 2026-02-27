import test from "node:test";
import assert from "node:assert/strict";
import { extractScreenTestIds, extractVisibleElements } from "../src/core/visibleElements.js";
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
    skipVisibilityCheck: true,
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
    skipVisibilityCheck: true,
    testIdMatch: "exact",
    testId: undefined,
  });

  assert.equal(result.totalCandidates, 3);
  assert.equal(result.elements.length, 1);
  assert.equal(result.elements[0].id, "node-1");
});

test("extractVisibleElements filters by testId exact and contains", () => {
  const exact = extractVisibleElements(makeTree(), {
    limit: 50,
    clickableOnly: true,
    includeTextless: false,
    skipVisibilityCheck: true,
    testId: "save_button",
    testIdMatch: "exact",
  });
  assert.equal(exact.totalCandidates, 1);
  assert.equal(exact.elements[0].id, "node-2");

  const contains = extractVisibleElements(makeTree(), {
    limit: 50,
    clickableOnly: true,
    includeTextless: false,
    skipVisibilityCheck: true,
    testId: "save",
    testIdMatch: "contains",
  });
  assert.equal(contains.totalCandidates, 1);
  assert.equal(contains.elements[0].testId, "save_button");
});

test("extractVisibleElements can enforce visibleToUser filter when requested", () => {
  const result = extractVisibleElements(makeTree(), {
    limit: 50,
    clickableOnly: false,
    includeTextless: true,
    skipVisibilityCheck: false,
    testIdMatch: "exact",
    testId: undefined,
  });

  assert.equal(result.totalCandidates, 2);
  assert.equal(result.elements.some((item) => item.id === "node-3"), false);
});

test("extractScreenTestIds lists unique testIDs with filtering", () => {
  const result = extractScreenTestIds(makeTree(), {
    limit: 50,
    includeNonClickable: true,
    includeInvisible: false,
  });

  assert.equal(result.totalCandidates, 1);
  assert.deepEqual(result.testIds, ["save_button"]);
  assert.equal(result.elements.length, 1);
});

test("extractScreenTestIds can restrict to clickable and visible", () => {
  const result = extractScreenTestIds(makeTree(), {
    limit: 50,
    includeNonClickable: false,
    includeInvisible: false,
  });

  assert.equal(result.totalCandidates, 1);
  assert.equal(result.testIds[0], "save_button");
  assert.equal(result.elements[0].id, "node-2");
});
