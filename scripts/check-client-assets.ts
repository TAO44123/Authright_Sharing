import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const secretEntries = Object.entries(process.env).filter(
  ([key, value]) =>
    /^(DATABASE_URL|BETTER_AUTH_SECRET|CURSOR_SIGNING_SECRET|GOOGLE_CLIENT_SECRET|SUMMARY_API_KEY|YOUTUBE_API_KEY)$/.test(
      key,
    ) &&
    value &&
    value.length >= 8,
);
async function scan(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(file);
    else {
      const text = await readFile(file, "utf8");
      for (const [key, value] of secretEntries) {
        if (
          [
            value!,
            encodeURIComponent(value!),
            JSON.stringify(value!).slice(1, -1),
          ].some((candidate) => text.includes(candidate))
        )
          throw new Error(
            `Private configuration ${key} found in client asset ${file}`,
          );
      }
    }
  }
}
await scan(".next/static");
console.log("Client assets contain no configured server credentials.");
