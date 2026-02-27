import test from "node:test";
import assert from "node:assert/strict";
import { retryWithBackoff } from "../src/core/retry.js";

test("retryWithBackoff retries until success", async () => {
  let calls = 0;
  const result = await retryWithBackoff(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("transient");
      }
      return "ok";
    },
    { retries: 3, initialDelayMs: 0 },
  );

  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("retryWithBackoff stops when shouldRetry returns false", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new Error("fatal");
        },
        {
          retries: 5,
          initialDelayMs: 0,
          shouldRetry: () => false,
        },
      ),
    /fatal/,
  );

  assert.equal(calls, 1);
});
