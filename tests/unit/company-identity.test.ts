import { expect, it } from "vitest";
import { isCompanyIdentity } from "../../src/server/company-identity.ts";

it("accepts verified company email case-insensitively and rejects other domains and unverified identities", () => {
  expect(
    isCompanyIdentity(
      { email: "Teammate@AUTHRIGHT.COM", emailVerified: true },
      "authright.com",
    ),
  ).toBe(true);
  for (const email of [
    "person@gmail.com",
    "person@sub.authright.com",
    "person@authright.com.evil.com",
    "person@fakeauthright.com",
    "person@authright.com@evil.com",
    "@authright.com",
  ])
    expect(
      isCompanyIdentity({ email, emailVerified: true }, "authright.com"),
    ).toBe(false);
  expect(
    isCompanyIdentity(
      { email: "person@authright.com", emailVerified: false },
      "authright.com",
    ),
  ).toBe(false);
});
