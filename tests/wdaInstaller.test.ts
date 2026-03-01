import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureWdaInstalled, type WdaExecRunner } from "../src/cli/wdaInstaller.js";

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wda-test-"));
  // Create a package.json so findPackageRoot resolves here.
  writeFileSync(join(dir, "package.json"), "{}");
  return dir;
}

class MockRunner implements WdaExecRunner {
  public readonly calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  public nextResult: { stdout: string; stderr: string; exitCode: number } = {
    stdout: "",
    stderr: "",
    exitCode: 0,
  };
  public onExec?: (command: string, args: string[], options?: { cwd?: string }) => void;

  async exec(
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.calls.push({ command, args, cwd: options?.cwd });
    this.onExec?.(command, args, options);
    return this.nextResult;
  }
}

test("ensureWdaInstalled returns installed: false when project already exists", async () => {
  const dir = makeTempDir();
  try {
    const wdaDir = join(dir, "WebDriverAgent");
    mkdirSync(wdaDir, { recursive: true });
    writeFileSync(join(wdaDir, "WebDriverAgent.xcodeproj"), "");

    const result = await ensureWdaInstalled({ packageRoot: dir });
    assert.equal(result.installed, false);
    assert.equal(result.projectPath, join(wdaDir, "WebDriverAgent.xcodeproj"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureWdaInstalled with runner calls runner.exec for git clone", async () => {
  const dir = makeTempDir();
  const runner = new MockRunner();
  // Simulate the clone creating the project directory.
  runner.onExec = () => {
    const wdaDir = join(dir, "WebDriverAgent");
    mkdirSync(wdaDir, { recursive: true });
    writeFileSync(join(wdaDir, "WebDriverAgent.xcodeproj"), "");
  };

  try {
    const progress: string[] = [];
    const result = await ensureWdaInstalled({
      packageRoot: dir,
      runner,
      onProgress: (msg) => progress.push(msg),
    });

    assert.equal(result.installed, true);
    assert.equal(runner.calls.length, 1);
    assert.equal(runner.calls[0].command, "git");
    assert.ok(runner.calls[0].args.includes("clone"));
    assert.ok(runner.calls[0].args.includes("WebDriverAgent"));
    assert.equal(runner.calls[0].cwd, dir);
    assert.ok(progress.length >= 2, "should emit at least 2 progress messages");
    assert.ok(progress[0].includes("Cloning"));
    assert.ok(progress[1].includes("complete"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureWdaInstalled with runner throws on non-zero exit code", async () => {
  const dir = makeTempDir();
  const runner = new MockRunner();
  runner.nextResult = { stdout: "", stderr: "fatal: repo not found", exitCode: 128 };

  try {
    await assert.rejects(
      () => ensureWdaInstalled({ packageRoot: dir, runner }),
      (err: Error) => {
        assert.ok(err.message.includes("git clone failed"));
        assert.ok(err.message.includes("128"));
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureWdaInstalled throws when WDA dir exists without xcodeproj", async () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, "WebDriverAgent"), { recursive: true });
    await assert.rejects(
      () => ensureWdaInstalled({ packageRoot: dir }),
      (err: Error) => {
        assert.ok(err.message.includes("missing WebDriverAgent.xcodeproj"));
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureWdaInstalled calls onProgress without runner (CLI path)", async () => {
  const dir = makeTempDir();
  // Pre-create the project so no actual git clone happens.
  const wdaDir = join(dir, "WebDriverAgent");
  mkdirSync(wdaDir, { recursive: true });
  writeFileSync(join(wdaDir, "WebDriverAgent.xcodeproj"), "");

  try {
    const progress: string[] = [];
    const result = await ensureWdaInstalled({
      packageRoot: dir,
      onProgress: (msg) => progress.push(msg),
    });

    // Already exists so no progress messages emitted.
    assert.equal(result.installed, false);
    assert.equal(progress.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
