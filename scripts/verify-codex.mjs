// Calls Codex's own MCP client through its app-server API. No model turn is run.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";

const binary = process.env.SHARING_CODEX_BINARY || "codex";
const pluginMode = process.env.SHARING_CODEX_PLUGIN === "1";
const serverName = pluginMode ? "sharing" : "sharing-local";
const child = spawn(
  binary,
  [
    ...(pluginMode
      ? []
      : [
          "-c",
          'mcp_servers={sharing-local={url="http://localhost:3000/mcp"}}',
        ]),
    "app-server",
    "--stdio",
  ],
  { stdio: ["pipe", "pipe", "pipe"] },
);
const pending = new Map();
let sequence = 0;
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const job = pending.get(message.id);
  if (job && !message.method) {
    clearTimeout(job.timer);
    pending.delete(message.id);
    if (message.error) job.reject(new Error(JSON.stringify(message.error)));
    else job.resolve(message.result);
  } else if (message.method && message.id !== undefined)
    child.stdin.write(
      JSON.stringify({
        id: message.id,
        error: {
          code: -32601,
          message:
            "Interactive requests must be completed in the Codex client.",
        },
      }) + "\n",
    );
});
// Do not mirror unrelated app-server logs or credentials into the validation record.
child.stderr.on("data", () => {});
child.on("error", (error) => {
  for (const job of pending.values()) job.reject(error);
});
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 60000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
try {
  await rpc("initialize", {
    clientInfo: { name: "sharing-validation", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(
    JSON.stringify({ method: "initialized", params: {} }) + "\n",
  );
  if (pluginMode) {
    const available = await rpc("skills/list", {
      cwds: [process.cwd()],
      forceReload: true,
    });
    const skillNames = available.data.flatMap((entry) =>
      entry.skills.map((skill) => skill.name),
    );
    console.log(
      JSON.stringify(
        {
          event: "codex_sharing_skills",
          skills: skillNames.filter((name) => name.startsWith("sharing")),
        },
        null,
        2,
      ),
    );
    for (const name of [
      "sharing:sharing",
      "sharing:list-shares",
      "sharing:get-share",
      "sharing:list-members",
      "sharing:share-link",
      "sharing:withdraw-share",
    ])
      if (!skillNames.includes(name))
        throw new Error(`Codex did not load the ${name} skill.`);
  }
  // Ephemeral execution context only: no saved sidebar task, no turn/start, no LLM call.
  const started = await rpc("thread/start", {
    cwd: process.cwd(),
    ephemeral: true,
  });
  const threadId = started.thread.id;
  const inventory = await rpc("mcpServerStatus/list", {
    threadId,
    detail: "toolsAndAuthOnly",
  });
  const server = inventory.data.find((item) => item.name === serverName);
  if (!server) throw new Error("Sharing was not loaded by Codex.");
  console.log(
    JSON.stringify(
      {
        event: "codex_mcp_inventory",
        server: server.name,
        tools: Object.keys(server.tools ?? {}),
        authStatus: server.authStatus,
      },
      null,
      2,
    ),
  );
  if (pluginMode) {
    for (const name of [
      "share_link",
      "list_shares",
      "get_share",
      "list_members",
      "withdraw_share",
    ])
      if (!Object.hasOwn(server.tools ?? {}, name))
        throw new Error(`Codex did not load ${name}.`);
  }
  if (process.env.SHARING_CODEX_INVENTORY_ONLY === "1") {
    if (!["oAuth", "loggedIn"].includes(server.authStatus))
      throw new Error(`Sharing authorization is ${server.authStatus}.`);
  } else {
    const prior = JSON.parse(
      await readFile("docs/validation/codex-result.json", "utf8"),
    );
    const targetId = process.env.SHARING_CODEX_SHARE_ID || prior.share.id;
    const detail = await rpc("mcpServer/tool/call", {
      threadId,
      server: serverName,
      tool: "get_share",
      arguments: { share_id: targetId },
    });
    if (detail.isError) throw new Error("Codex get_share failed.");
    const share =
      detail.structuredContent ??
      JSON.parse(detail.content.find((item) => item.type === "text").text);
    if (share.share_id !== targetId)
      throw new Error("Codex returned a different share.");
    const day = new Date(share.shared_at);
    const result = await rpc("mcpServer/tool/call", {
      threadId,
      server: serverName,
      tool: "list_shares",
      arguments: {
        from: new Date(day.getTime() - 86400000).toISOString(),
        to: new Date(day.getTime() + 86400000).toISOString(),
        keyword: share.original_url,
      },
    });
    if (result.isError) throw new Error("Codex list_shares failed.");
    const data =
      result.structuredContent ??
      JSON.parse(result.content.find((item) => item.type === "text").text);
    if (!data.items.some((item) => item.share_id === targetId))
      throw new Error("Codex list_shares did not find the target share.");
    const members = await rpc("mcpServer/tool/call", {
      threadId,
      server: serverName,
      tool: "list_members",
      arguments: { query: share.sharer.name },
    });
    if (members.isError) throw new Error("Codex list_members failed.");
    const memberData =
      members.structuredContent ??
      JSON.parse(members.content.find((item) => item.type === "text").text);
    if (!memberData.members.some((member) => member.id === share.sharer.id))
      throw new Error("Codex list_members did not find the share's author.");
    const evidence = {
      checked_at: new Date().toISOString(),
      client: "Codex app-server (installed CLI)",
      model_turn_run: false,
      server: serverName,
      tools_passed: ["list_shares", "get_share", "list_members"],
      share: data.items.find((item) => item.share_id === targetId),
    };
    await writeFile(
      "docs/validation/codex-result.json",
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(JSON.stringify(evidence, null, 2));
  }
} finally {
  for (const job of pending.values()) clearTimeout(job.timer);
  lines.close();
  child.stdin.end();
  child.kill("SIGTERM");
}
