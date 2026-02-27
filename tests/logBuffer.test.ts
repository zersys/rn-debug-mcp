import test from "node:test";
import assert from "node:assert/strict";
import { LogBuffer } from "../src/core/logBuffer.js";

test("LogBuffer appends entries with incremental cursors", () => {
  const buffer = new LogBuffer(10);
  const one = buffer.append({ ts: "2026-01-01T00:00:00.000Z", level: "info", source: "logcat", message: "a" });
  const two = buffer.append({ ts: "2026-01-01T00:00:01.000Z", level: "error", source: "logcat", message: "b" });

  assert.equal(one.cursor, 1);
  assert.equal(two.cursor, 2);
});

test("LogBuffer query advances cursor when predicate filters everything", () => {
  const buffer = new LogBuffer(10);
  buffer.append({ ts: "2026-01-01T00:00:00.000Z", level: "info", source: "logcat", message: "a" });
  buffer.append({ ts: "2026-01-01T00:00:01.000Z", level: "warn", source: "logcat", message: "b" });

  const result = buffer.query({ sinceCursor: 0, predicate: (entry) => entry.level === "error" });
  assert.equal(result.items.length, 0);
  assert.equal(result.nextCursor, 2);
});

test("LogBuffer respects limit pagination", () => {
  const buffer = new LogBuffer(10);
  for (let i = 0; i < 5; i += 1) {
    buffer.append({ ts: "2026-01-01T00:00:00.000Z", level: "info", source: "logcat", message: String(i) });
  }

  const page1 = buffer.query({ sinceCursor: 0, limit: 2 });
  assert.equal(page1.items.length, 2);
  assert.equal(page1.nextCursor, 2);

  const page2 = buffer.query({ sinceCursor: page1.nextCursor, limit: 2 });
  assert.equal(page2.items.length, 2);
  assert.equal(page2.items[0].message, "2");
});
