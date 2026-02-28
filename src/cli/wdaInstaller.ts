import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_WDA_REPO_URL = "https://github.com/appium/WebDriverAgent.git";
export const DEFAULT_WDA_GIT_REF = "v11.1.6";

function findPackageRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

function modulePackageRoot(): string {
  return findPackageRoot(dirname(fileURLToPath(import.meta.url)));
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", (error) => reject(error));
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed (code=${code}, signal=${signal ?? "none"})`));
    });
  });
}

export function getWdaProjectPath(packageRoot = modulePackageRoot()): string {
  return join(packageRoot, "WebDriverAgent", "WebDriverAgent.xcodeproj");
}

export async function ensureWdaInstalled(options?: {
  packageRoot?: string;
  repoUrl?: string;
  gitRef?: string;
}): Promise<{ installed: boolean; projectPath: string }> {
  const packageRoot = options?.packageRoot ?? modulePackageRoot();
  const projectPath = getWdaProjectPath(packageRoot);
  if (existsSync(projectPath)) {
    return { installed: false, projectPath };
  }

  const wdaDir = join(packageRoot, "WebDriverAgent");
  if (existsSync(wdaDir)) {
    throw new Error(`Found '${wdaDir}' but missing WebDriverAgent.xcodeproj. Remove it and retry.`);
  }

  const repoUrl = options?.repoUrl ?? process.env.WDA_REPO_URL ?? DEFAULT_WDA_REPO_URL;
  const gitRef = options?.gitRef ?? process.env.WDA_GIT_REF ?? DEFAULT_WDA_GIT_REF;
  await run("git", ["clone", "--depth", "1", "--branch", gitRef, repoUrl, "WebDriverAgent"], packageRoot);

  if (!existsSync(projectPath)) {
    throw new Error(`Clone completed, but expected project is missing at '${projectPath}'.`);
  }

  return { installed: true, projectPath };
}
