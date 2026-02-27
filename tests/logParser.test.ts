import test from "node:test";
import assert from "node:assert/strict";
import { isErrorLevel, parseLogcatLine } from "../src/core/logParser.js";

test("parseLogcatLine parses brief format and maps severity", () => {
  const parsed = parseLogcatLine("02-26 18:10:22.123 E/ReactNativeJS(1234): Unhandled JS Exception: boom");

  assert.equal(parsed.source, "logcat");
  assert.equal(parsed.tag, "ReactNativeJS");
  assert.equal(parsed.level, "error");
  assert.equal(parsed.message, "Unhandled JS Exception: boom");
});

test("parseLogcatLine handles unmatched lines", () => {
  const parsed = parseLogcatLine("some random output line");
  assert.equal(parsed.source, "logcat");
  assert.equal(parsed.level, "info");
  assert.equal(parsed.message, "some random output line");
});

test("isErrorLevel only matches error and fatal", () => {
  assert.equal(isErrorLevel("error"), true);
  assert.equal(isErrorLevel("fatal"), true);
  assert.equal(isErrorLevel("warn"), false);
});
