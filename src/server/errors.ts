import { randomUUID } from "node:crypto";
import { logger } from "./logger.ts";
import { z } from "zod";
import { errorCodeSchema } from "../contracts/index.ts";
export class AppError extends Error {
  constructor(
    public code: z.infer<typeof errorCodeSchema>,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function errorResponse(error: unknown) {
  const requestId = randomUUID();
  const headers = {
    "X-Request-ID": requestId,
    "Cache-Control": "private, no-store",
  };
  logger.warn({
    event: "request_failed",
    requestId,
    errorCode:
      error instanceof AppError
        ? error.code
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? "INVALID_INPUT"
          : "INTERNAL_ERROR",
  });
  if (error instanceof AppError)
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          request_id: requestId,
        },
      },
      { status: error.status, headers },
    );
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return Response.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "Invalid request.",
          request_id: requestId,
        },
      },
      { status: 400, headers },
    );
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Request failed. Please try again.",
        request_id: requestId,
      },
    },
    { status: 500, headers },
  );
}
