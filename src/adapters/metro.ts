import { ToolError } from "../core/toolError.js";

function metroUrl(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

async function requestText(url: string, init?: RequestInit, timeoutMs = 3000): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    const body = await response.text();
    return {
      status: response.status,
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export class MetroAdapter {
  async checkStatus(port: number): Promise<void> {
    let response: { status: number; body: string };

    try {
      response = await requestText(metroUrl(port, "/status"));
    } catch (error) {
      throw new ToolError("METRO_UNREACHABLE", `Unable to reach Metro on port ${port}`, {
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    if (response.status < 200 || response.status >= 300 || !response.body.includes("packager-status:running")) {
      throw new ToolError("METRO_UNREACHABLE", `Metro is not running on port ${port}`, {
        status: response.status,
        body: response.body,
      });
    }
  }

  async probeInspector(port: number): Promise<void> {
    try {
      await requestText(metroUrl(port, "/json/list"), undefined, 2000);
    } catch {
      // Supplemental channel discovery is best effort in Phase 1.
    }
  }

  async reload(port: number): Promise<void> {
    const postResponse = await requestText(metroUrl(port, "/reload"), { method: "POST" }, 3000).catch(() => null);
    if (postResponse && postResponse.status >= 200 && postResponse.status < 300) {
      return;
    }

    const getResponse = await requestText(metroUrl(port, "/reload"), { method: "GET" }, 3000).catch(() => null);
    if (getResponse && getResponse.status >= 200 && getResponse.status < 300) {
      return;
    }

    throw new ToolError("COMMAND_FAILED", "Metro reload request failed", {
      postStatus: postResponse?.status,
      getStatus: getResponse?.status,
    });
  }
}
