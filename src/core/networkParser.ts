import { parseLogcatLine } from "./logParser.js";
import type { NetworkRequestEntry } from "../types/api.js";

const METHOD_PATTERN = /(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/i;
const REQUEST_PATTERN = /-->\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(https?:\/\/\S+)/i;
const RESPONSE_PATTERN = /<--\s*(?:HTTP\/\d(?:\.\d)?\s+)?(\d{3})\s+(https?:\/\/\S+)(?:\s+\(([^)]*)\))?/i;
const GENERIC_REQUEST_PATTERN = /(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(https?:\/\/\S+)/i;
const GENERIC_RESPONSE_PATTERN = /(https?:\/\/\S+).*?\b(\d{3})\b/i;
const ERROR_PATTERN = /(network request failed|failed to connect|unable to resolve host|timed? out|sslhandshake|connection refused)/i;
const REQUEST_ID_PATTERN = /(?:request(?:id)?|req(?:uest)?)[=: ]+(\d+)/i;

function cleanUrl(url: string): string {
  return url.replace(/[)\],;"']+$/g, "");
}

function parseDurationMs(raw?: string): number | undefined {
  if (!raw) {
    return undefined;
  }

  const match = raw.match(/(\d+(?:\.\d+)?)\s*ms/i);
  if (!match) {
    return undefined;
  }

  return Math.round(Number.parseFloat(match[1]));
}

function parseRequestId(message: string): string | undefined {
  const match = message.match(REQUEST_ID_PATTERN);
  return match?.[1];
}

function buildBase(parsed: ReturnType<typeof parseLogcatLine>): Omit<NetworkRequestEntry, "cursor" | "phase"> {
  return {
    ts: parsed.ts,
    source: parsed.source,
    tag: parsed.tag,
    message: parsed.message,
    raw: parsed.raw,
    requestId: parseRequestId(parsed.message),
  };
}

export function parseNetworkEvent(rawLine: string): Omit<NetworkRequestEntry, "cursor"> | null {
  const parsed = parseLogcatLine(rawLine);
  const message = parsed.message.trim();
  const base = buildBase(parsed);

  const requestMatch = message.match(REQUEST_PATTERN);
  if (requestMatch) {
    return {
      ...base,
      phase: "request",
      method: requestMatch[1].toUpperCase(),
      url: cleanUrl(requestMatch[2]),
    };
  }

  const responseMatch = message.match(RESPONSE_PATTERN);
  if (responseMatch) {
    return {
      ...base,
      phase: "response",
      status: Number.parseInt(responseMatch[1], 10),
      url: cleanUrl(responseMatch[2]),
      durationMs: parseDurationMs(responseMatch[3]),
    };
  }

  if (/\b(response|responded|status)\b/i.test(message)) {
    const genericResponse = message.match(GENERIC_RESPONSE_PATTERN);
    if (genericResponse) {
      return {
        ...base,
        phase: "response",
        url: cleanUrl(genericResponse[1]),
        status: Number.parseInt(genericResponse[2], 10),
      };
    }
  }

  if (/\b(request|fetch|xhr)\b/i.test(message) || METHOD_PATTERN.test(message)) {
    const genericRequest = message.match(GENERIC_REQUEST_PATTERN);
    if (genericRequest) {
      return {
        ...base,
        phase: "request",
        method: genericRequest[1].toUpperCase(),
        url: cleanUrl(genericRequest[2]),
      };
    }
  }

  if (ERROR_PATTERN.test(message)) {
    const urlMatch = message.match(/https?:\/\/\S+/i);
    return {
      ...base,
      phase: "error",
      url: urlMatch ? cleanUrl(urlMatch[0]) : undefined,
    };
  }

  return null;
}
