import test from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "../src/core/sessionManager.js";
import { ToolError } from "../src/core/toolError.js";

test("SessionManager enforces single active session", () => {
  const session = new SessionManager();
  session.beginConnecting();

  assert.throws(() => session.beginConnecting(), (error: unknown) => {
    return error instanceof ToolError && error.code === "COMMAND_FAILED";
  });
});

test("SessionManager requireConnected and reset behavior", async () => {
  const session = new SessionManager();
  let cleaned = false;

  session.beginConnecting();
  session.addCleanup(() => {
    cleaned = true;
  });
  session.setConnected("emulator-5554", 8081);

  const state = session.requireConnected();
  assert.equal(state.deviceId, "emulator-5554");

  await session.reset();
  assert.equal(cleaned, true);
  assert.equal(session.getState().status, "disconnected");

  assert.throws(() => session.requireConnected(), (error: unknown) => {
    return error instanceof ToolError && error.code === "NO_SESSION";
  });
});

test("SessionManager supports multiple sessions and active selection", async () => {
  const session = new SessionManager();
  const a = session.createSession("android", "emulator-5554", 8081);
  const b = session.createSession("ios", "SIM-1", 8081);

  assert.equal(session.listSessions().length, 2);
  assert.equal(session.requireConnected().sessionId, b.sessionId);

  session.setActiveSession(a.sessionId);
  assert.equal(session.requireConnected().sessionId, a.sessionId);

  await session.closeSession(a.sessionId);
  assert.equal(session.listSessions().length, 1);
  assert.equal(session.requireConnected().sessionId, b.sessionId);
});
