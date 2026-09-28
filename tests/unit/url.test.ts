import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../../src/server/url.ts";
import { listSharesInput, shareLinkInput } from "../../src/contracts/index.ts";
describe("public source URL contract", () => {
  it.each([
    "file:///tmp/a",
    "javascript:alert(1)",
    "http://localhost/a",
    "http://127.1/a",
    "http://2130706433/a",
    "http://10.0.0.1",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://169.254.169.254/",
    "https://user:pass@example.com/",
  ])("rejects %s", (input) => expect(() => normalizeUrl(input)).toThrow());
  it("keeps article query order, fragments and case-sensitive paths", () => {
    const result = normalizeUrl("https://EXAMPLE.com:443/News?a=1&b=2#section");
    expect(result.normalizedUrl).toBe(
      "https://example.com/News?a=1&b=2#section",
    );
    expect(result.dedupeKey).not.toBe(
      normalizeUrl("https://example.com/news?b=2&a=1#section").dedupeKey,
    );
  });
  it("reuses exact YouTube video IDs without trusting lookalike hosts", () => {
    expect(normalizeUrl("https://youtu.be/dQw4w9WgXcQ?t=2").dedupeKey).toBe(
      normalizeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ").dedupeKey,
    );
    expect(
      normalizeUrl("https://youtube.com.attacker.example/watch?v=dQw4w9WgXcQ")
        .type,
    ).toBe("article");
  });
  it("validates time zones, size, pagination, and actor injection", () => {
    expect(
      listSharesInput.safeParse({ from: "2026-01-01T12:00:00" }).success,
    ).toBe(false);
    expect(listSharesInput.safeParse({ limit: 101 }).success).toBe(false);
    expect(
      shareLinkInput.safeParse({
        url: "https://example.com",
        idempotency_key: "abcdefgh",
        userId: "admin",
      }).success,
    ).toBe(false);
  });
});
