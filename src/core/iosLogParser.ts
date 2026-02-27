import type { LogEntry, LogLevel } from "../types/api.js";

const IOS_LOG_PATTERN =
  /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+([A-Z])\w*\s+([^\[]+)\[(\d+):(\d+)\]\s*(.*)$/;
const ERROR_PATTERN = /(fatal|unhandled|uncaught|invariant violation|network request failed|\berror\b)/i;

function mapLevel(level: string): LogLevel {
  switch (level) {
    case "D":
      return "debug";
    case "I":
    case "N":
      return "info";
    case "W":
      return "warn";
    case "E":
      return "error";
    case "F":
      return "fatal";
    default:
      return "info";
  }
}

function inferLevel(message: string, fallback: LogLevel): LogLevel {
  if (fallback === "fatal") {
    return "fatal";
  }

  if (ERROR_PATTERN.test(message)) {
    return fallback === "warn" ? "warn" : "error";
  }

  return fallback;
}

function parseTimestamp(raw: string): string {
  const parsed = new Date(raw.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

export function parseIosLogLine(rawLine: string): Omit<LogEntry, "cursor"> {
  const line = rawLine.trimEnd();
  const match = line.match(IOS_LOG_PATTERN);

  if (!match) {
    return {
      ts: new Date().toISOString(),
      level: ERROR_PATTERN.test(line) ? "error" : "info",
      source: "logcat",
      message: line,
      raw: rawLine,
    };
  }

  const [, tsRaw, severity, processName, , , message] = match;
  const base = mapLevel(severity);
  return {
    ts: parseTimestamp(tsRaw),
    level: inferLevel(message, base),
    source: "logcat",
    tag: processName.trim(),
    message,
    raw: rawLine,
  };
}
