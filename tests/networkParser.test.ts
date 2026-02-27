import test from "node:test";
import assert from "node:assert/strict";
import { parseNetworkEvent } from "../src/core/networkParser.js";

test("parseNetworkEvent parses okhttp request lines", () => {
  const event = parseNetworkEvent("02-26 18:10:22.130 I/OkHttp(1234): --> POST https://api.example.com/login");
  assert.ok(event);
  assert.equal(event.phase, "request");
  assert.equal(event.method, "POST");
  assert.equal(event.url, "https://api.example.com/login");
});

test("parseNetworkEvent parses okhttp response lines", () => {
  const event = parseNetworkEvent("02-26 18:10:22.180 I/OkHttp(1234): <-- 201 https://api.example.com/login (86ms)");
  assert.ok(event);
  assert.equal(event.phase, "response");
  assert.equal(event.status, 201);
  assert.equal(event.durationMs, 86);
});

test("parseNetworkEvent parses network errors", () => {
  const event = parseNetworkEvent(
    "02-26 18:10:22.181 E/ReactNativeJS(1234): Network request failed: https://api.example.com/login",
  );
  assert.ok(event);
  assert.equal(event.phase, "error");
  assert.equal(event.url, "https://api.example.com/login");
});

test("parseNetworkEvent ignores non-network lines", () => {
  const event = parseNetworkEvent("02-26 18:10:22.123 I/ReactNativeJS(1234): console info");
  assert.equal(event, null);
});
