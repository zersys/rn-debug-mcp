import test from "node:test";
import assert from "node:assert/strict";
import { parseWdaUiTree } from "../src/core/wdaUiParser.js";

test("parseWdaUiTree normalizes WDA JSON source", () => {
  const parsed = parseWdaUiTree({
    type: "XCUIElementTypeWindow",
    visible: true,
    enabled: true,
    rect: { x: 0, y: 0, width: 1170, height: 2532 },
    children: [
      {
        type: "XCUIElementTypeButton",
        label: "Login",
        identifier: "login.button",
        visible: true,
        enabled: true,
        rect: { x: 100, y: 2000, width: 970, height: 200 },
        children: [],
      },
    ],
  });

  assert.equal(parsed.source, "wda");
  assert.equal(parsed.nodeCount, 2);
  assert.equal(parsed.clickableCount, 1);
  assert.equal(parsed.root?.children[0]?.resourceId, "login.button");
  assert.equal(parsed.root?.children[0]?.testId, "login.button");
});

test("parseWdaUiTree infers stable testId from name when explicit identifier is missing", () => {
  const parsed = parseWdaUiTree({
    type: "XCUIElementTypeButton",
    name: "notification-permission-background",
    label: "Notification Permission",
    visible: true,
    enabled: true,
    rect: { x: 10, y: 20, width: 100, height: 50 },
    children: [],
  });

  assert.equal(parsed.root?.testId, "notification-permission-background");
  assert.equal(parsed.root?.resourceId, "notification-permission-background");
});

test("parseWdaUiTree does not infer testId from display labels", () => {
  const parsed = parseWdaUiTree({
    type: "XCUIElementTypeButton",
    label: "Login",
    visible: true,
    enabled: true,
    rect: { x: 10, y: 20, width: 100, height: 50 },
    children: [],
  });

  assert.equal(parsed.root?.testId, undefined);
});
