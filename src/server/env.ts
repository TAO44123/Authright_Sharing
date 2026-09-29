import { z } from "zod";

const postgresUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.pathname.length > 1
    );
  });
const origin = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  })
  .transform((value) => new URL(value).origin);
const youtubeProxyUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          ["http:", "https:", "socks5:", "socks5h:"].includes(url.protocol) &&
          Boolean(url.hostname) &&
          !url.username &&
          !url.password &&
          (!url.pathname || url.pathname === "/") &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    })
    .optional(),
);
export const databaseEnvSchema = z.object({ DATABASE_URL: postgresUrl });
export const logEnvSchema = z.object({
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error", "silent"])
    .default("info"),
});
export const webEnvSchema = databaseEnvSchema
  .extend({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_URL: origin.default("http://localhost:3000"),
    BETTER_AUTH_URL: origin.optional(),
    BETTER_AUTH_SECRET: z.string().min(32),
    CURSOR_SIGNING_SECRET: z.string().min(32),
    GOOGLE_CLIENT_ID: z.string().default(""),
    GOOGLE_CLIENT_SECRET: z.string().default(""),
    GOOGLE_WORKSPACE_DOMAIN: z
      .string()
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
    MCP_RESOURCE_URL: z.string().url().default("http://localhost:3000/mcp"),
    ...logEnvSchema.shape,
  })
  .superRefine((env, ctx) => {
    const invalid = (field: string) =>
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: "Invalid configuration",
      });
    if (env.BETTER_AUTH_SECRET === env.CURSOR_SIGNING_SECRET)
      invalid("CURSOR_SIGNING_SECRET");
    if (env.BETTER_AUTH_URL && env.BETTER_AUTH_URL !== env.APP_URL)
      invalid("BETTER_AUTH_URL");
    if (env.MCP_RESOURCE_URL !== `${env.APP_URL}/mcp`)
      invalid("MCP_RESOURCE_URL");
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET))
      invalid("GOOGLE_CLIENT_SECRET");
    if (env.NODE_ENV === "production") {
      if (
        new URL(env.APP_URL).protocol !== "https:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(env.APP_URL).hostname,
        )
      )
        invalid("APP_URL");
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
        invalid("GOOGLE_CLIENT_ID");
    }
  });
export const workerEnvSchema = databaseEnvSchema
  .extend({
    ...logEnvSchema.shape,
    CONTENT_PROCESSING_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    YT_DLP_PATH: z.string().min(1).default("yt-dlp"),
    FFMPEG_PATH: z.string().min(1).default("ffmpeg"),
    YOUTUBE_PROXY_URL: youtubeProxyUrl,
    YOUTUBE_API_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_BILLING_TIER: z.enum(["free", "paid"]).optional(),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    SUMMARY_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(1),
  })
  .superRefine((env, ctx) => {
    if (env.SUMMARY_CONCURRENCY > env.WORKER_CONCURRENCY)
      ctx.addIssue({
        code: "custom",
        path: ["SUMMARY_CONCURRENCY"],
        message: "Must not exceed worker concurrency",
      });
    if (env.CONTENT_PROCESSING_ENABLED && !env.GEMINI_BILLING_TIER)
      ctx.addIssue({
        code: "custom",
        path: ["GEMINI_BILLING_TIER"],
        message: "Select the Gemini project's billing tier",
      });
  });
// Never include a Zod issue's input, URL, or credential in startup errors.
export function readEnv<T>(
  schema: z.ZodType<T>,
  env: Record<string, string | undefined> = process.env,
): T {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid environment configuration: ${[...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ")}`,
    );
  return result.data;
}
