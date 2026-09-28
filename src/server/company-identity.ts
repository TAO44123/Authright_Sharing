import { z } from "zod";

export function isCompanyIdentity(
  identity: { email: string; emailVerified: boolean },
  domain: string,
) {
  return (
    identity.emailVerified === true &&
    z.email().safeParse(identity.email).success &&
    identity.email.toLowerCase().split("@")[1] === domain.toLowerCase()
  );
}
