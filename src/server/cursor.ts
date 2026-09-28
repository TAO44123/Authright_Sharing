import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import { AppError } from "./errors.ts";
export function encodeCursor(value: Record<string, unknown>) {
  const body = Buffer.from(
    JSON.stringify({ ...value, expires: Date.now() + 3600000 }),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", config.CURSOR_SIGNING_SECRET).update(body).digest("base64url")}`;
}
export function decodeCursor(value: string): Record<string, unknown> {
  try {
    const [body, signature, extra] = value.split(".");
    const expected = createHmac("sha256", config.CURSOR_SIGNING_SECRET)
      .update(body)
      .digest();
    const actual = Buffer.from(signature, "base64url");
    if (
      extra ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new Error();
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof parsed.expires !== "number" || parsed.expires < Date.now())
      throw new Error();
    return parsed;
  } catch {
    throw new AppError(
      "INVALID_CURSOR",
      "Pagination expired or changed. Start a new search.",
    );
  }
}
