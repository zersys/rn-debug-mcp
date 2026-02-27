import type { ErrorCode, ToolErrorData } from "../types/api.js";

export class ToolError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }

  toData(): ToolErrorData {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
