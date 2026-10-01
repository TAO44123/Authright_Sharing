import assert from "node:assert/strict";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let source = join(root, "plugins/sharing");
let target = join(homedir(), ".cursor/plugins/local/sharing");
let uninstall = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--uninstall") uninstall = true;
  else if (["--source", "--target"].includes(args[i])) {
    const option = args[i];
    const value = args[++i];
    assert(value && !value.startsWith("--"), `Missing value for ${option}`);
    if (option === "--source") source = resolve(value);
    else target = resolve(value);
  } else
    throw new Error(
      "Usage: node scripts/install-cursor-plugin.mjs [--source <plugin-directory>] [--target <install-directory>] [--uninstall]",
    );
}
assert(
  target !== source &&
    !target.startsWith(source + sep) &&
    !source.startsWith(target + sep),
  "Source and target must be separate directories",
);

async function stat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function noSymlinks(path) {
  for (let current = path; ; current = dirname(current)) {
    assert(
      !(await stat(current))?.isSymbolicLink(),
      `Symlink not allowed: ${current}`,
    );
    if (current === dirname(current)) return;
  }
}
await noSymlinks(target);
const existing = await stat(target);
if (existing) {
  assert(existing.isDirectory(), "Install target must be a directory");
  const manifestPath = join(target, ".cursor-plugin/plugin.json");
  await noSymlinks(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(
    manifest.name,
    "sharing",
    "Refusing to replace a different plugin",
  );
}

// Backups and staging stay outside local/, so Cursor cannot discover them as plugins.
const backupRoot = join(dirname(dirname(target)), "backups", "sharing");
await noSymlinks(backupRoot);
assert(
  !backupRoot.startsWith(target + sep) && backupRoot !== target,
  "Invalid backup directory",
);
const operationId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
const backup = join(backupRoot, operationId);
if (uninstall) {
  if (existing) {
    await mkdir(backupRoot, { recursive: true });
    await rename(target, backup);
    console.log(`Uninstalled Sharing; recoverable backup: ${backup}`);
  } else console.log("Sharing is not installed at the target.");
} else {
  const names = [
    "sharing",
    "list-shares",
    "get-share",
    "list-members",
    "share-link",
    "withdraw-share",
  ];
  const paths = [
    ".cursor-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".mcp.json",
    ...names.map((name) => `skills/${name}/SKILL.md`),
  ];
  const files = new Map();
  for (const path of paths) {
    await noSymlinks(join(source, path));
    files.set(path, await readFile(join(source, path), "utf8"));
  }
  const parse = (path) => JSON.parse(files.get(path));
  const manifest = parse(".cursor-plugin/plugin.json");
  assert.equal(manifest.name, "sharing");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.skills, "./skills/");
  for (const client of ["claude", "codex"]) {
    const other = parse(`.${client}-plugin/plugin.json`);
    assert.equal(other.name, manifest.name);
    assert.equal(other.version, manifest.version);
  }
  assert.deepEqual(parse(".mcp.json"), {
    mcpServers: {
      sharing: { type: "http", url: "https://sharing.authright.com/mcp" },
    },
  });
  for (const name of names)
    assert.match(
      files.get(`skills/${name}/SKILL.md`),
      new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`),
    );
  const staging = join(backupRoot, `staging-${operationId}`);
  await mkdir(staging, { recursive: true });
  for (const [path, content] of files) {
    await mkdir(dirname(join(staging, path)), { recursive: true });
    await writeFile(join(staging, path), content);
  }
  await mkdir(dirname(target), { recursive: true });
  if (existing) await rename(target, backup);
  try {
    await rename(staging, target);
  } catch (error) {
    if (existing) await rename(backup, target);
    throw error;
  }
  console.log(
    `Installed Sharing ${manifest.version}: ${files.size} files → ${target}`,
  );
  if (existing) console.log(`Previous installation backup: ${backup}`);
}
console.log(
  "In Cursor, run Developer: Reload Window, then check Sharing in Customize. OAuth credentials are managed by Cursor.",
);
