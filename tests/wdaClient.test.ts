import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { WdaClient } from "../src/adapters/wda.js";

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withFetchQueue(
  t: TestContext,
  responders: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>,
): FetchCall[] {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  let index = 0;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, body });

    const responder = responders[index];
    if (!responder) {
      throw new Error(`Unexpected fetch call #${index + 1}: ${method} ${url}`);
    }
    index += 1;
    return responder(url, init);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  return calls;
}

test("WdaClient tap uses W3C actions when available", async (t) => {
  const calls = withFetchQueue(t, [
    () => jsonResponse(200, { value: { sessionId: "S1", capabilities: {} } }),
    () => jsonResponse(200, { value: null }),
  ]);

  const client = new WdaClient("http://127.0.0.1:8100");
  await client.tap("SIM-1", 120, 240);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.endsWith("/session"), true);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[1].url.endsWith("/session/S1/actions"), true);
  assert.equal(calls[1].method, "POST");

  const actionBody = calls[1].body as { actions?: Array<{ actions?: Array<{ type?: string }> }> };
  assert.equal(Array.isArray(actionBody.actions), true);
  assert.equal(actionBody.actions?.[0]?.actions?.[1]?.type, "pointerDown");
});

test("WdaClient tap falls back to legacy endpoint when W3C action endpoint is unavailable", async (t) => {
  const calls = withFetchQueue(t, [
    () => jsonResponse(200, { value: { sessionId: "S1", capabilities: {} } }),
    () => jsonResponse(404, { value: { error: "unknown command", message: "Unhandled endpoint" } }),
    () => jsonResponse(200, { value: null }),
  ]);

  const client = new WdaClient("http://127.0.0.1:8100");
  await client.tap("SIM-1", 5, 10);

  assert.equal(calls.length, 3);
  assert.equal(calls[2].url.endsWith("/wda/tap/0"), true);
  assert.equal(calls[2].method, "POST");
});

test("WdaClient recreates session and retries when W3C reports invalid session", async (t) => {
  const calls = withFetchQueue(t, [
    () => jsonResponse(200, { value: { sessionId: "S1", capabilities: {} } }),
    () => jsonResponse(200, { value: null }),
    () => jsonResponse(404, { value: { error: "invalid session id", message: "Session does not exist" } }),
    () => jsonResponse(200, { value: { sessionId: "S2", capabilities: {} } }),
    () => jsonResponse(200, { value: null }),
  ]);

  const client = new WdaClient("http://127.0.0.1:8100");
  await client.tap("SIM-1", 10, 20);
  await client.tap("SIM-1", 30, 40);

  const sessionCreates = calls.filter((call) => call.url.endsWith("/session") && call.method === "POST");
  assert.equal(sessionCreates.length, 2);
  assert.equal(calls.some((call) => call.url.endsWith("/session/S2/actions")), true);
});

test("WdaClient typeText uses W3C key actions when available", async (t) => {
  const calls = withFetchQueue(t, [
    () => jsonResponse(200, { value: { sessionId: "S1", capabilities: {} } }),
    () => jsonResponse(200, { value: null }),
  ]);

  const client = new WdaClient("http://127.0.0.1:8100");
  await client.typeText("SIM-1", "hello");

  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.endsWith("/session/S1/actions"), true);
  const body = calls[1].body as { actions?: Array<{ type?: string; actions?: Array<{ type?: string; value?: string }> }> };
  assert.equal(body.actions?.[0]?.type, "key");
  assert.equal(body.actions?.[0]?.actions?.length, 10);
  assert.deepEqual(body.actions?.[0]?.actions?.slice(0, 2), [
    { type: "keyDown", value: "h" },
    { type: "keyUp", value: "h" },
  ]);
});

test("WdaClient typeText falls back to legacy /wda/keys when W3C actions are unavailable", async (t) => {
  const calls = withFetchQueue(t, [
    () => jsonResponse(200, { value: { sessionId: "S1", capabilities: {} } }),
    () => jsonResponse(404, { value: { error: "unknown command", message: "Unhandled endpoint" } }),
    () => jsonResponse(200, { value: null }),
  ]);

  const client = new WdaClient("http://127.0.0.1:8100");
  await client.typeText("SIM-1", "ok");

  assert.equal(calls.length, 3);
  assert.equal(calls[1].url.endsWith("/session/S1/actions"), true);
  assert.equal(calls[2].url.endsWith("/wda/keys"), true);
  assert.deepEqual(calls[2].body, { value: ["o", "k"] });
});
