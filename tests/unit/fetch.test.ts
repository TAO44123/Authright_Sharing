import { afterEach, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import type { IncomingMessage, RequestOptions } from "node:http";
const state = vi.hoisted(() => ({
  responses: [] as {
    status: number;
    headers: Record<string, string>;
    body?: Buffer;
    stall?: boolean;
  }[],
  addresses: {} as Record<string, { address: string; family: number }[]>,
  sockets: [] as string[],
  lookups: [] as string[],
}));
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    state.lookups.push(host);
    return state.addresses[host] ?? [{ address: "1.1.1.1", family: 4 }];
  },
}));
vi.mock("node:http", async () => {
  const { PassThrough } = await import("node:stream");
  const { EventEmitter } = await import("node:events");
  return {
    get: (
      _url: URL,
      options: RequestOptions,
      callback: (response: IncomingMessage) => void,
    ) => {
      const request = Object.assign(new EventEmitter(), {
        destroyed: false,
        destroy() {
          this.destroyed = true;
          return this;
        },
      });
      queueMicrotask(() => {
        const response = state.responses.shift();
        if (!response) {
          request.emit("error", new Error("No fixture"));
          return;
        }
        const stream = Object.assign(new PassThrough(), {
          statusCode: response.status,
          headers: response.headers,
        });
        options.lookup!(_url.hostname, { all: false }, (_err, address) =>
          state.sockets.push(String(address)),
        );
        options.signal?.addEventListener(
          "abort",
          () => {
            request.emit("error", new Error("aborted"));
            stream.destroy();
          },
          { once: true },
        );
        callback(stream as unknown as IncomingMessage);
        if (!response.stall)
          stream.end(response.body ?? Buffer.from("<html>Complete</html>"));
      });
      return request;
    },
  };
});
vi.mock("node:https", async () => {
  const http = await import("node:http");
  return { get: http.get };
});
import { fetchHtml } from "../../src/server/content/fetch.ts";
afterEach(() => {
  state.responses = [];
  state.addresses = {};
  state.sockets = [];
  state.lookups = [];
});
it("pins the verified DNS address and rechecks every redirect", async () => {
  state.responses.push({
    status: 302,
    headers: { location: "https://private.example/secret" },
  });
  state.addresses["private.example"] = [{ address: "10.0.0.1", family: 4 }];
  await expect(fetchHtml("https://public.example/start")).rejects.toMatchObject(
    { code: "UNSAFE_ADDRESS" },
  );
  expect(state.sockets).toEqual(["1.1.1.1"]);
  expect(state.lookups).toEqual(["public.example", "private.example"]);
});
it("bounds decompressed responses and rejects non-HTML", async () => {
  state.responses.push({
    status: 200,
    headers: { "content-type": "text/html", "content-encoding": "gzip" },
    body: gzipSync("x".repeat(5 * 1024 * 1024 + 1)),
  });
  await expect(fetchHtml("https://public.example/bomb")).rejects.toMatchObject({
    code: "RESPONSE_TOO_LARGE",
  });
  state.responses.push({
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
  await expect(fetchHtml("https://public.example/pdf")).rejects.toMatchObject({
    code: "UNSUPPORTED_CONTENT",
  });
});
it("aborts a stalled response without retaining its body", async () => {
  state.responses.push({
    status: 200,
    headers: { "content-type": "text/html" },
    stall: true,
  });
  const controller = new AbortController();
  const result = fetchHtml("https://public.example/slow", controller.signal);
  setTimeout(() => controller.abort(), 10);
  await expect(result).rejects.toMatchObject({ code: "FETCH_TIMEOUT" });
});
