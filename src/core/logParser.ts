import type { LogEntry, LogLevel } from "../types/api.js";

const BRIEF_LOG_PATTERN = /^(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d+)\s+([VDIWEF])\/([^\(]+)\(\s*(\d+)\):\s?(.*)$/;
const ERROR_MESSAGE_PATTERN = /(fatal exception|unhandled|uncaught|invariant violation|\berror\b)/i;

function parseTimestamp(datePart: string, timePart: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const isoGuess = `${year}-${datePart}T${timePart}Z`;
  const parsed = new Date(isoGuess);

  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function mapPriority(priority: string): LogLevel {
  switch (priority) {
    case "V":
    case "D":
      return "debug";
    case "I":
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

function inferLevel(tag: string, message: string, fallback: LogLevel): LogLevel {
  if (fallback === "fatal") {
    return "fatal";
  }

  if (ERROR_MESSAGE_PATTERN.test(message)) {
    return tag.includes("ReactNativeJS") ? "error" : fallback === "warn" ? "warn" : "error";
  }

  return fallback;
}

export function parseLogcatLine(rawLine: string): Omit<LogEntry, "cursor"> {
  const line = rawLine.trimEnd();
  const match = line.match(BRIEF_LOG_PATTERN);

  if (!match) {
    return {
      ts: new Date().toISOString(),
      level: ERROR_MESSAGE_PATTERN.test(line) ? "error" : "info",
      source: "logcat",
      message: line,
      raw: rawLine,
    };
  }

  const [, datePart, timePart, priority, tag, , message] = match;
  const mapped = mapPriority(priority);

  return {
    ts: parseTimestamp(datePart, timePart),
    level: inferLevel(tag.trim(), message, mapped),
    source: "logcat",
    tag: tag.trim(),
    message,
    raw: rawLine,
  };
}

export function isErrorLevel(level: LogLevel): boolean {
  return level === "error" || level === "fatal";
}
