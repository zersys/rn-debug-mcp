import test from "node:test";
import assert from "node:assert/strict";
import { AdbAdapter } from "../src/adapters/adb.js";
import type {
  BinaryExecResult,
  ExecResult,
  ProcessRunner,
  SpawnedProcess,
} from "../src/adapters/processRunner.js";
import { ToolError } from "../src/core/toolError.js";

class FakeRunner implements ProcessRunner {
  private execIndex = 0;
  public readonly execCalls: Array<{ command: string; args: string[] }> = [];

  constructor(
    private readonly binaryResult: BinaryExecResult,
    private readonly execResults: ExecResult[] = [],
  ) {}

  async exec(command: string, args: string[]): Promise<ExecResult> {
    this.execCalls.push({ command, args });
    const next = this.execResults[this.execIndex];
    this.execIndex += 1;
    return next ?? { stdout: "", stderr: "", exitCode: 0 };
  }

  async execBinary(): Promise<BinaryExecResult> {
    return this.binaryResult;
  }

  spawn(): SpawnedProcess {
    return {
      onStdout() {},
      onStderr() {},
      async stop() {},
      exited: Promise.resolve({ code: 0, signal: null }),
    };
  }
}

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5+6RsAAAAASUVORK5CYII=",
  "base64",
);

test("AdbAdapter takeScreenshot validates png and extracts dimensions", async () => {
  const adapter = new AdbAdapter(
    new FakeRunner({
      stdout: ONE_BY_ONE_PNG,
      stderr: Buffer.alloc(0),
      exitCode: 0,
    }),
  );

  const screenshot = await adapter.takeScreenshot("emulator-5554");
  assert.equal(screenshot.width, 1);
  assert.equal(screenshot.height, 1);
  assert.equal(screenshot.png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("AdbAdapter takeScreenshot throws ToolError on invalid png", async () => {
  const adapter = new AdbAdapter(
    new FakeRunner({
      stdout: Buffer.from("not-a-png", "utf8"),
      stderr: Buffer.alloc(0),
      exitCode: 0,
    }),
  );

  await assert.rejects(() => adapter.takeScreenshot("emulator-5554"), (error: unknown) => {
    return error instanceof ToolError && error.code === "COMMAND_FAILED";
  });
});

test("AdbAdapter getUiTree parses UIAutomator XML", async () => {
  const xml =
    '<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>' +
    '<hierarchy rotation=\"0\">' +
    '<node index=\"0\" text=\"\" resource-id=\"\" class=\"android.widget.FrameLayout\" package=\"com.app\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" selected=\"false\" visible-to-user=\"true\" scrollable=\"false\" checkable=\"false\" checked=\"false\" bounds=\"[0,0][1080,2160]\">' +
    '<node index=\"1\" text=\"Save\" resource-id=\"com.app:id/save\" class=\"android.widget.Button\" package=\"com.app\" clickable=\"true\" enabled=\"true\" focusable=\"true\" focused=\"false\" selected=\"false\" visible-to-user=\"true\" scrollable=\"false\" checkable=\"false\" checked=\"false\" bounds=\"[100,1800][980,2000]\" />' +
    "</node>" +
    "</hierarchy>";

  const adapter = new AdbAdapter(
    new FakeRunner(
      {
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        exitCode: 0,
      },
      [
        { stdout: "UI hierchary dumped to: /sdcard/rndb-ui-dump.xml\n", stderr: "", exitCode: 0 },
        { stdout: xml, stderr: "", exitCode: 0 },
      ],
    ),
  );

  const result = await adapter.getUiTree("emulator-5554", { maxDepth: 10, maxNodes: 10 });
  assert.equal(result.source, "uiautomator");
  assert.equal(result.nodeCount, 2);
  assert.equal(result.clickableCount, 1);
  assert.equal(result.truncated, false);
  assert.equal(result.root?.className, "android.widget.FrameLayout");
  assert.equal(result.root?.children[0]?.text, "Save");
  assert.equal(result.root?.children[0]?.bounds?.width, 880);
});

test("AdbAdapter getUiTree applies pruning constraints", async () => {
  const xml =
    '<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>' +
    '<hierarchy rotation=\"0\">' +
    '<node index=\"0\" class=\"android.widget.FrameLayout\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" selected=\"false\" visible-to-user=\"true\" scrollable=\"false\" checkable=\"false\" checked=\"false\" bounds=\"[0,0][100,100]\">' +
    '<node index=\"1\" class=\"android.widget.LinearLayout\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" selected=\"false\" visible-to-user=\"true\" scrollable=\"false\" checkable=\"false\" checked=\"false\" bounds=\"[0,0][100,100]\">' +
    '<node index=\"2\" class=\"android.widget.TextView\" text=\"Deep\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" selected=\"false\" visible-to-user=\"true\" scrollable=\"false\" checkable=\"false\" checked=\"false\" bounds=\"[0,0][100,100]\" />' +
    "</node>" +
    "</node>" +
    "</hierarchy>";

  const adapter = new AdbAdapter(
    new FakeRunner(
      {
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        exitCode: 0,
      },
      [
        { stdout: "ok", stderr: "", exitCode: 0 },
        { stdout: xml, stderr: "", exitCode: 0 },
      ],
    ),
  );

  const result = await adapter.getUiTree("emulator-5554", { maxDepth: 1, maxNodes: 2 });
  assert.equal(result.truncated, true);
  assert.equal(result.nodeCount, 2);
  assert.equal(result.root?.children.length, 1);
  assert.equal(result.root?.children[0]?.children.length, 0);
});

test("AdbAdapter gets activity and window dumps", async () => {
  const adapter = new AdbAdapter(
    new FakeRunner(
      {
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        exitCode: 0,
      },
      [
        { stdout: "activity dump", stderr: "", exitCode: 0 },
        { stdout: "window dump", stderr: "", exitCode: 0 },
      ],
    ),
  );

  const activity = await adapter.getActivityDump("emulator-5554");
  const window = await adapter.getWindowDump("emulator-5554");

  assert.equal(activity, "activity dump");
  assert.equal(window, "window dump");
});

test("AdbAdapter typeText escapes text and optionally submits", async () => {
  const runner = new FakeRunner(
    {
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      exitCode: 0,
    },
    [
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "", exitCode: 0 },
    ],
  );
  const adapter = new AdbAdapter(runner);

  await adapter.typeText("emulator-5554", "hello world!", true);

  assert.equal(runner.execCalls.length, 2);
  assert.deepEqual(runner.execCalls[0], {
    command: "adb",
    args: ["-s", "emulator-5554", "shell", "input", "text", "hello%sworld\\!"],
  });
  assert.deepEqual(runner.execCalls[1], {
    command: "adb",
    args: ["-s", "emulator-5554", "shell", "input", "keyevent", "66"],
  });
});

test("AdbAdapter pressBack sends back keyevent", async () => {
  const runner = new FakeRunner(
    {
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      exitCode: 0,
    },
    [{ stdout: "", stderr: "", exitCode: 0 }],
  );
  const adapter = new AdbAdapter(runner);

  await adapter.pressBack("emulator-5554");

  assert.equal(runner.execCalls.length, 1);
  assert.deepEqual(runner.execCalls[0], {
    command: "adb",
    args: ["-s", "emulator-5554", "shell", "input", "keyevent", "4"],
  });
});

test("AdbAdapter scroll calculates swipe coordinates from wm size", async () => {
  const runner = new FakeRunner(
    {
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      exitCode: 0,
    },
    [
      { stdout: "Physical size: 1080x2160\n", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "", exitCode: 0 },
    ],
  );
  const adapter = new AdbAdapter(runner);

  const result = await adapter.scroll("emulator-5554", "down", 0.5, 420);
  assert.deepEqual(result, {
    from: { x: 540, y: 1620 },
    to: { x: 540, y: 540 },
    durationMs: 420,
  });

  assert.equal(runner.execCalls.length, 2);
  assert.deepEqual(runner.execCalls[0], {
    command: "adb",
    args: ["-s", "emulator-5554", "shell", "wm", "size"],
  });
  assert.deepEqual(runner.execCalls[1], {
    command: "adb",
    args: ["-s", "emulator-5554", "shell", "input", "swipe", "540", "1620", "540", "540", "420"],
  });
});
