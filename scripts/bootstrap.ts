import { pool } from "../src/server/db/index.ts";
import { bootstrapAdmin } from "../src/server/bootstrap.ts";
try {
  const email = process.argv[2];
  const domain = process.env.GOOGLE_WORKSPACE_DOMAIN;
  if (!email || !domain)
    throw new Error(
      "Usage: pnpm admin:bootstrap <email>; GOOGLE_WORKSPACE_DOMAIN is required.",
    );
  await bootstrapAdmin(email, domain);
  console.log(
    "Initial administrator role ready. Google sign-in will bind the identity; other company users join automatically.",
  );
} finally {
  await pool.end();
}
