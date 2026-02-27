import test from "node:test";
import assert from "node:assert/strict";
import { parseIosLogLine } from "../src/core/iosLogParser.js";

test("parseIosLogLine parses compact simulator logs", () => {
  const entry = parseIosLogLine("2026-02-27 12:10:22.124 I MyApp[123:456] App started");
  assert.equal(entry.level, "info");
  assert.equal(entry.tag, "MyApp");
  assert.equal(entry.message, "App started");
});

test("parseIosLogLine detects error text in fallback lines", () => {
  const entry = parseIosLogLine("Unhandled JS Exception: boom");
  assert.equal(entry.level, "error");
});
