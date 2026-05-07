import { AppError } from "./AppError.js";
import type { Logger } from "./types.js";

function safeSerialize(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return String(value);
  }
}

function normalizeUnknownError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string") {
    return new Error(error);
  }

  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error("Unserializable thrown value");
  }
}

export function handleError(error: unknown, logger: Logger): void {
  // Known application errors
  if (error instanceof AppError) {
    logger.warn(error.message, {
      code: error.code,
      statusCode: error.statusCode,
    });
    return;
  }

  // Standard JS errors
  if (error instanceof Error) {
    logger.error(error.message, error);
    return;
  }

  // Unknown / non-error throws
  logger.error("Unknown error", normalizeUnknownError(error), {
    rawError: safeSerialize(error),
  });
}
