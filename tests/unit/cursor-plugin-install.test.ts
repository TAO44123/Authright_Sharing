import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve("scripts/install-cursor-plugin.mjs");
const source = resolve("plugins/sharing");
let temp: string;
let target: string;
const run = (...args: string[]) =>
  execFileSync(process.execPath, [script, "--target", target, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });
const manifest = () =>
  JSON.parse(readFileSync(join(target, ".cursor-plugin/plugin.json"), "utf8"));

beforeEach(() => {
  temp = mkdtempSync(join(realpathSync(tmpdir()), "sharing-cursor-install-"));
  target = join(temp, "plugins/local/sharing");
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

describe("Cursor plugin installer", () => {
  it("installs hidden manifests, shared skills and the production connection", () => {
    run();
    expect(manifest().name).toBe("sharing");
    expect(readdirSync(join(target, "skills"))).toHaveLength(6);
    expect(readFileSync(join(target, ".mcp.json"), "utf8")).toBe(
      readFileSync(join(source, ".mcp.json"), "utf8"),
    );
    expect(readdirSync(join(temp, "plugins/local"))).toEqual(["sharing"]);
  });

  it("backs up an update outside local/ and supports restoring an earlier package", () => {
    run();
    for (const client of ["cursor", "claude", "codex"]) {
      const path = join(target, `.${client}-plugin/plugin.json`);
      const value = JSON.parse(readFileSync(path, "utf8"));
      value.version = "0.4.1";
      writeFileSync(path, JSON.stringify(value));
    }
    writeFileSync(join(target, "personal-note.txt"), "preserve me");
    const output = run();
    const backup = output.match(/Previous installation backup: (.+)/)![1];
    expect(readFileSync(join(backup, "personal-note.txt"), "utf8")).toBe(
      "preserve me",
    );
    expect(backup.startsWith(join(temp, "plugins/backups/"))).toBe(true);
    expect(readdirSync(join(temp, "plugins/local"))).toEqual(["sharing"]);
    run("--source", backup);
    expect(manifest().version).toBe("0.4.1");
  });

  it("rejects a bad source before changing the installed version", () => {
    run();
    const before = readFileSync(join(target, ".mcp.json"), "utf8");
    const invalid = join(temp, "invalid");
    cpSync(source, invalid, { recursive: true });
    writeFileSync(
      join(invalid, ".mcp.json"),
      '{"mcpServers":{"sharing":{"url":"http://localhost:3000/mcp"}}}',
    );
    expect(() => run("--source", invalid)).toThrow();
    expect(readFileSync(join(target, ".mcp.json"), "utf8")).toBe(before);
  });

  it("refuses to overwrite an unrelated plugin", () => {
    run();
    const path = join(target, ".cursor-plugin/plugin.json");
    writeFileSync(path, '{"name":"another-plugin"}');
    expect(() => run()).toThrow();
    expect(manifest().name).toBe("another-plugin");
  });

  it("rejects a symlink target without touching its destination", () => {
    target = join(temp, "alias");
    symlinkSync(source, target, "dir");
    expect(() => run()).toThrow();
    expect(existsSync(join(source, ".cursor-plugin/plugin.json"))).toBe(true);
  });

  it("uninstalls by moving the whole installation to a recoverable backup", () => {
    run();
    writeFileSync(join(target, "personal-note.txt"), "preserve me");
    const output = run("--uninstall");
    const backup = output.match(/recoverable backup: (.+)/)![1];
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(join(backup, "personal-note.txt"), "utf8")).toBe(
      "preserve me",
    );
    expect(run("--uninstall")).toContain("not installed");
  });
});
