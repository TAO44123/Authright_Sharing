import "dotenv/config";
import { spawn } from "node:child_process";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
// Deliberately omit all authentication, Google and provider credentials.
const child = spawn(process.execPath, ["dist/worker/index.js"], {
  env: { DATABASE_URL: process.env.DATABASE_URL, LOG_LEVEL: "info" },
  stdio: ["ignore", "pipe", "pipe"],
});
let ready = false;
let output = "";
const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
  if (!ready && output.includes('"event":"worker_ready"')) {
    ready = true;
    child.kill("SIGTERM");
  }
});
// Do not echo arbitrary startup errors or environment values into CI logs.
child.stderr.resume();
const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
}).finally(() => clearTimeout(timeout));
if (!ready || exitCode !== 0 || !output.includes('"contentConsumption":"paused"'))
  throw new Error("Worker failed its database-only startup/graceful-stop check.");
console.log("Worker starts without auth credentials, remains paused and exits cleanly.");
