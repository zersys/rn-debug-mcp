import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IosAdapter } from "../src/adapters/ios.js";
import { WdaClient } from "../src/adapters/wda.js";
import type {
  BinaryExecResult,
  ExecResult,
  ProcessRunner,
  SpawnedProcess,
} from "../src/adapters/processRunner.js";
import { ToolError } from "../src/core/toolError.js";

class StubRunner implements ProcessRunner {
  public readonly execCalls: Array<{ command: string; args: string[] }> = [];
  public spawnFactory?: () => SpawnedProcess;

  async exec(command: string, args: string[]): Promise<ExecResult> {
    this.execCalls.push({ command, args });
    // Default: simctl list returns one booted device.
    if (command === "xcrun" && args.includes("list")) {
      return {
        stdout: JSON.stringify({
          devices: {
            "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
              { udid: "TEST-SIM-1", name: "iPhone 16", state: "Booted" },
            ],
          },
        }),
        stderr: "",
        exitCode: 0,
      };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  async execBinary(): Promise<BinaryExecResult> {
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 };
  }

  spawn(): SpawnedProcess {
    if (this.spawnFactory) {
      return this.spawnFactory();
    }
    return {
      onStdout() {},
      onStderr() {},
      async stop() {},
      exited: Promise.resolve({ code: 0, signal: null }),
    };
  }
}

test("WDA_NO_AUTO_INSTALL=1 throws IOS_UNAVAILABLE when project is missing", async () => {
  const originalValue = process.env.WDA_NO_AUTO_INSTALL;
  // Point to a non-existent project path so it triggers the missing-project branch.
  const dir = mkdtempSync(join(tmpdir(), "wda-noauto-"));
  writeFileSync(join(dir, "package.json"), "{}");

  const fakeProjectPath = join(dir, "WebDriverAgent", "WebDriverAgent.xcodeproj");
  process.env.WDA_NO_AUTO_INSTALL = "1";
  process.env.WDA_PROJECT_PATH = fakeProjectPath;

  try {
    const runner = new StubRunner();
    const wda = new WdaClient("http://127.0.0.1:9999"); // unreachable port
    const adapter = new IosAdapter(runner, wda);

    await assert.rejects(
      () => adapter.ensureWdaReady("TEST-SIM-1"),
      (err: unknown) => {
        assert.ok(err instanceof ToolError);
        assert.equal(err.code, "IOS_UNAVAILABLE");
        assert.ok(err.message.includes("WebDriverAgent project not found"));
        assert.ok(err.message.includes("WDA_NO_AUTO_INSTALL"));
        return true;
      },
    );
  } finally {
    if (originalValue === undefined) {
      delete process.env.WDA_NO_AUTO_INSTALL;
    } else {
      process.env.WDA_NO_AUTO_INSTALL = originalValue;
    }
    delete process.env.WDA_PROJECT_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("setProgressCallback stores callback and setupSteps is initially empty", () => {
  const runner = new StubRunner();
  const wda = new WdaClient("http://127.0.0.1:9999");
  const adapter = new IosAdapter(runner, wda);

  assert.deepEqual(adapter.setupSteps, []);

  const messages: string[] = [];
  adapter.setProgressCallback((msg) => messages.push(msg));
  // The callback is stored; we can't trigger it without a full ensureWdaReady flow,
  // but at least we verify it doesn't throw.
  assert.deepEqual(messages, []);
});

test("concurrent ensureWdaReady calls share promise and preserve setupSteps", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wda-concurrent-"));
  writeFileSync(join(dir, "package.json"), "{}");
  // Create project so auto-install is skipped, only the build path runs.
  const wdaDir = join(dir, "WebDriverAgent");
  mkdirSync(wdaDir, { recursive: true });
  const projectPath = join(wdaDir, "WebDriverAgent.xcodeproj");
  writeFileSync(projectPath, "");

  const origProjectPath = process.env.WDA_PROJECT_PATH;
  process.env.WDA_PROJECT_PATH = projectPath;

  try {
    // WdaClient where checkStatus fails once (enter build path) then succeeds (poll loop).
    const wda = new WdaClient("http://127.0.0.1:9999");
    let statusCalls = 0;
    wda.checkStatus = async () => {
      statusCalls++;
      if (statusCalls <= 1) {
        throw new Error("not ready yet");
      }
    };
    wda.ensureSession = async () => "fake-session";

    // Runner whose spawn returns a process that never exits,
    // so the polling loop doesn't hit the "process exited" error branch.
    const runner = new StubRunner();
    runner.spawnFactory = () => ({
      onStdout() {},
      onStderr() {},
      async stop() {},
      exited: new Promise(() => {}), // never resolves
    });

    const adapter = new IosAdapter(runner, wda);

    // Call 1: enters ensureWdaReadyInternal, resets setupSteps, starts build.
    const p1 = adapter.ensureWdaReady("TEST-SIM-1");
    // Call 2: should reuse in-flight promise, NOT reset setupSteps.
    const p2 = adapter.ensureWdaReady("TEST-SIM-1");

    const [r1, r2] = await Promise.all([p1, p2]);

    // Both calls return the same spawned process.
    assert.strictEqual(r1, r2);
    // setupSteps must contain exactly "wda_built" — not wiped, not duplicated.
    assert.deepEqual(adapter.setupSteps, ["wda_built"]);
  } finally {
    if (origProjectPath === undefined) {
      delete process.env.WDA_PROJECT_PATH;
    } else {
      process.env.WDA_PROJECT_PATH = origProjectPath;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
