import { clientBoundaryViolations } from "./lib/client-boundaries.ts";
const violations = clientBoundaryViolations(process.cwd());
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else console.log("Client/server import boundaries passed.");
