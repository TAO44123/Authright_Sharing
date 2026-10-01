import assert from "node:assert/strict";
import { mkdir, readFile, readdir, lstat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const targets = args.filter((arg) => arg !== "--check");
assert(
  targets.length === 1 && !targets[0].startsWith("-"),
  "Usage: node scripts/export-plugin.mjs [--check] <distribution-directory>",
);
const target = resolve(targets[0]);
assert(
  target !== root && !root.startsWith(target + sep),
  "Export to a dedicated distribution directory, not the application or its parent.",
);

const skillNames = [
  "sharing",
  "list-shares",
  "get-share",
  "list-members",
  "share-link",
  "withdraw-share",
];
const pluginFiles = [
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  ".mcp.json",
  ...skillNames.map((name) => `skills/${name}/SKILL.md`),
];
const sources = new Map(
  pluginFiles.map((file) => [
    `plugins/sharing/${file}`,
    `plugins/sharing/${file}`,
  ]),
);
sources.set(
  ".agents/plugins/marketplace.json",
  "plugins/distribution/codex-marketplace.json",
);
sources.set(
  ".claude-plugin/marketplace.json",
  ".claude-plugin/marketplace.json",
);
sources.set("README.md", "plugins/distribution/README.md");
sources.set(
  ".cursor-plugin/marketplace.json",
  ".cursor-plugin/marketplace.json",
);
sources.set(
  "scripts/install-cursor-plugin.mjs",
  "scripts/install-cursor-plugin.mjs",
);
sources.set("CHANGELOG.md", "plugins/distribution/CHANGELOG.md");

async function rejectSymlinks(path) {
  for (let current = path; ; current = dirname(current)) {
    try {
      assert(
        !(await lstat(current)).isSymbolicLink(),
        `Symlink not allowed: ${current}`,
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current === dirname(current)) break;
  }
}

const files = new Map();
for (const [destination, source] of sources) {
  const path = join(root, source);
  await rejectSymlinks(path);
  files.set(destination, await readFile(path, "utf8"));
}
files.set(
  ".gitignore",
  ".DS_Store\n.env\n.env.*\n*.log\n*.pem\n*.key\n*.dump\n*.backup\n.local/\nnode_modules/\n",
);
const parse = (path) => JSON.parse(files.get(path));
const codex = parse("plugins/sharing/.codex-plugin/plugin.json");
const claude = parse("plugins/sharing/.claude-plugin/plugin.json");
const cursor = parse("plugins/sharing/.cursor-plugin/plugin.json");
assert.equal(cursor.name, codex.name);
assert.equal(cursor.version, codex.version, "Client versions must match");
assert.equal(cursor.mcpServers, "./.mcp.json");
assert.equal(cursor.skills, "./skills/");
assert.equal(codex.name, "sharing");
assert.equal(claude.name, codex.name);
assert.equal(claude.version, codex.version, "Client versions must match");
assert.match(codex.version, /^\d+\.\d+\.\d+$/);
assert.deepEqual(
  parse("plugins/sharing/.mcp.json"),
  {
    mcpServers: {
      sharing: { type: "http", url: "https://sharing.authright.com/mcp" },
    },
  },
  "Release MCP config must contain only the production URL and transport",
);
for (const path of [
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".cursor-plugin/marketplace.json",
]) {
  const catalog = parse(path);
  assert.equal(catalog.name, "authright-sharing");
  assert.equal(catalog.plugins.length, 1);
  assert.equal(catalog.plugins[0].name, "sharing");
  assert.equal(
    typeof catalog.plugins[0].source === "string"
      ? catalog.plugins[0].source
      : catalog.plugins[0].source.path,
    "./plugins/sharing",
  );
}

await rejectSymlinks(target);
async function inspect(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (directory === target && entry.name === ".git") continue;
    const path = join(directory, entry.name);
    const key = relative(target, path).split(sep).join("/");
    assert(!entry.isSymbolicLink(), `Symlink not allowed: ${key}`);
    if (entry.isDirectory()) {
      assert(
        [...files.keys()].some((file) => file.startsWith(key + "/")),
        `Unexpected directory in distribution: ${key}`,
      );
      await inspect(path);
    } else {
      assert(
        entry.isFile() && files.has(key),
        `Unexpected file in distribution: ${key}`,
      );
    }
  }
}
await inspect(target);
for (const [file, content] of files) {
  const path = join(target, file);
  if (check) {
    assert.equal(
      await readFile(path, "utf8"),
      content,
      `Distribution differs: ${file}`,
    );
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}
console.log(
  `${check ? "Verified" : "Exported"} Sharing ${codex.version}: ${files.size} allowlisted files → ${target}`,
);
