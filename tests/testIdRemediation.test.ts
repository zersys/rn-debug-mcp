import test from "node:test";
import assert from "node:assert/strict";
import { buildRemediationPlan } from "../src/core/testIdRemediation.js";

const screenContext = {
  platform: "android" as const,
  deviceId: "emulator-5554",
  capturedAt: "2026-01-01T00:00:00.000Z",
  activity: "com.app.CheckoutActivity",
  activityShort: "CheckoutActivity",
  packageName: "com.app",
  uiTitleCandidates: ["Checkout"],
  primaryTitle: "Checkout",
  screenSlug: "checkout.payment",
  confidence: "high" as const,
};

test("buildRemediationPlan returns normalized suggested testID and hints", () => {
  const plan = buildRemediationPlan({
    input: {
      desiredAction: "tap submit button",
      desiredTestId: "SubmitButton",
      matchMode: "exact",
    },
    screenContext,
    elementCandidates: [
      {
        id: "node-2",
        testId: "save_button",
        label: "Save",
        clickable: true,
        enabled: true,
        focusable: true,
        selected: false,
        visibleToUser: true,
      },
    ],
  });

  assert.equal(plan.suggestedTestId.startsWith("checkout.payment."), true);
  assert.equal(plan.suggestedTestId.endsWith(".button"), true);
  assert.equal(plan.matchMode, "exact");
  assert.equal(Array.isArray(plan.patchHint.searchTerms), true);
  assert.equal(plan.nextSteps.length >= 3, true);
  assert.equal(typeof plan.desiredTestIdWarning, "string");
});
