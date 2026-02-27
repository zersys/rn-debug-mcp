import test from "node:test";
import assert from "node:assert/strict";
import { buildScreenContext } from "../src/core/screenContext.js";
import type { UiNode } from "../src/types/api.js";

function makeRoot(): UiNode {
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
    bounds: { left: 0, top: 0, right: 1080, bottom: 2160, width: 1080, height: 2160 },
    children: [
      {
        id: "node-2",
        className: "android.widget.TextView",
        text: "Checkout",
        clickable: false,
        enabled: true,
        focusable: false,
        focused: false,
        selected: false,
        visibleToUser: true,
        scrollable: false,
        checkable: false,
        checked: false,
        bounds: { left: 40, top: 80, right: 500, bottom: 160, width: 460, height: 80 },
        children: [],
      },
    ],
  };
}

test("buildScreenContext uses activity + title with high confidence", () => {
  const ctx = buildScreenContext({
    deviceId: "emulator-5554",
    capturedAt: "2026-01-01T00:00:00.000Z",
    activityDump: "mResumedActivity: ActivityRecord{11 u0 com.app/.CheckoutActivity t123}",
    windowDump: "",
    uiRoot: makeRoot(),
  });

  assert.equal(ctx.activity, "com.app.CheckoutActivity");
  assert.equal(ctx.activityShort, "CheckoutActivity");
  assert.equal(ctx.packageName, "com.app");
  assert.equal(ctx.primaryTitle, "Checkout");
  assert.equal(ctx.screenSlug, "checkout.checkout");
  assert.equal(ctx.confidence, "high");
});

test("buildScreenContext falls back to window dump with medium confidence", () => {
  const ctx = buildScreenContext({
    deviceId: "emulator-5554",
    capturedAt: "2026-01-01T00:00:00.000Z",
    activityDump: "",
    windowDump: "mCurrentFocus=Window{22 u0 com.app/com.app.MainActivity}",
    uiRoot: undefined,
  });

  assert.equal(ctx.activity, "com.app.MainActivity");
  assert.equal(ctx.confidence, "medium");
});
