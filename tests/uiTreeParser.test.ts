import test from "node:test";
import assert from "node:assert/strict";
import { parseUiAutomatorXml, pruneUiTree } from "../src/core/uiTreeParser.js";

test("parseUiAutomatorXml extracts nodes and decodes attributes", () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<hierarchy rotation="0">' +
    '<node index="0" class="android.widget.FrameLayout" text="" clickable="false" enabled="true" focusable="false" focused="false" selected="false" visible-to-user="true" scrollable="false" checkable="false" checked="false" bounds="[0,0][200,200]">' +
    '<node index="1" class="android.widget.TextView" text="A &amp; B" content-desc="hello &quot;world&quot;" clickable="true" enabled="true" focusable="true" focused="false" selected="false" visible-to-user="true" scrollable="false" checkable="false" checked="false" bounds="[10,10][190,40]" />' +
    "</node>" +
    "</hierarchy>";

  const parsed = parseUiAutomatorXml(xml);

  assert.equal(parsed.nodeCount, 2);
  assert.equal(parsed.clickableCount, 1);
  assert.equal(parsed.root?.className, "android.widget.FrameLayout");
  assert.equal(parsed.root?.children[0]?.text, "A & B");
  assert.equal(parsed.root?.children[0]?.contentDescription, 'hello "world"');
  assert.equal(parsed.root?.children[0]?.bounds?.height, 30);
});

test("pruneUiTree enforces maxDepth and maxNodes", () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<hierarchy rotation="0">' +
    '<node index="0" class="android.widget.FrameLayout" clickable="false" enabled="true" focusable="false" focused="false" selected="false" visible-to-user="true" scrollable="false" checkable="false" checked="false" bounds="[0,0][100,100]">' +
    '<node index="1" class="android.widget.LinearLayout" clickable="false" enabled="true" focusable="false" focused="false" selected="false" visible-to-user="true" scrollable="false" checkable="false" checked="false" bounds="[0,0][100,100]">' +
    '<node index="2" class="android.widget.Button" clickable="true" enabled="true" focusable="true" focused="false" selected="false" visible-to-user="true" scrollable="false" checkable="false" checked="false" bounds="[0,0][50,50]" />' +
    "</node>" +
    "</node>" +
    "</hierarchy>";

  const parsed = parseUiAutomatorXml(xml);
  const pruned = pruneUiTree(parsed.root, { maxDepth: 1, maxNodes: 2 });

  assert.equal(pruned.truncated, true);
  assert.equal(pruned.nodeCount, 2);
  assert.equal(pruned.root?.children.length, 1);
  assert.equal(pruned.root?.children[0]?.children.length, 0);
});
