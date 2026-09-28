import { lookup } from "node:dns/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import ipaddr from "ipaddr.js";
import { normalizeUrl } from "../url.ts";
import { ProcessingError } from "./types.ts";

export function publicAddress(address: string) {
  return (
    ipaddr.isValid(address) && ipaddr.process(address).range() === "unicast"
  );
}
export async function resolvePublic(host: string, resolve = lookup) {
  const addresses = await resolve(host.replace(/^\[|\]$/g, ""), {
    all: true,
    verbatim: true,
  });
  if (
    !addresses.length ||
    addresses.some((item) => !publicAddress(item.address))
  )
    throw new ProcessingError("UNSAFE_ADDRESS");
  return addresses[0];
}
export async function fetchHtml(
  input: string,
  parentSignal?: AbortSignal,
): Promise<{ html: string; url: string }> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(20000),
    ...(parentSignal ? [parentSignal] : []),
  ]);
  let current = input;
  for (let hop = 0; hop <= 5; hop++) {
    try {
      normalizeUrl(current);
    } catch {
      throw new ProcessingError("UNSAFE_URL");
    }
    const url = new URL(current);
    const address = await Promise.race([
      resolvePublic(url.hostname),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new ProcessingError("FETCH_TIMEOUT", true));
        else
          signal.addEventListener(
            "abort",
            () => reject(new ProcessingError("FETCH_TIMEOUT", true)),
            { once: true },
          );
      }),
    ]);
    signal.throwIfAborted();
    const response = await new Promise<{ location?: string; html?: string }>(
      (resolve, reject) => {
        const request = (url.protocol === "https:" ? httpsGet : httpGet)(
          url,
          {
            agent: false,
            signal,
            lookup: (_host, options, callback) => {
              // Only the already-validated IP reaches the socket; the URL retains
              // the original hostname for Host/SNI/certificate verification.
              if (options.all) callback(null, [address]);
              else callback(null, address.address, address.family);
            },
            headers: {
              "User-Agent": "Sharing/0.1 ArticlePreview",
              Accept: "text/html,application/xhtml+xml",
              "Accept-Encoding": "gzip, deflate, br",
            },
          },
          (res) => {
            const status = res.statusCode ?? 500;
            if (
              [301, 302, 303, 307, 308].includes(status) &&
              res.headers.location
            ) {
              try {
                resolve({ location: new URL(res.headers.location, url).href });
              } catch {
                reject(new ProcessingError("INVALID_REDIRECT"));
              }
              res.destroy();
              return;
            }
            if (status !== 200) {
              reject(
                new ProcessingError(
                  status === 401 || status === 403
                    ? "ACCESS_RESTRICTED"
                    : "FETCH_HTTP_ERROR",
                  status === 429 || status >= 500,
                ),
              );
              res.destroy();
              return;
            }
            if (
              !/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(
                res.headers["content-type"] ?? "",
              )
            ) {
              reject(new ProcessingError("UNSUPPORTED_CONTENT"));
              res.destroy();
              return;
            }
            let wireBytes = 0,
              bytes = 0;
            const chunks: Buffer[] = [];
            const encoding = res.headers["content-encoding"];
            const decoder =
              encoding === "gzip"
                ? createGunzip()
                : encoding === "deflate"
                  ? createInflate()
                  : encoding === "br"
                    ? createBrotliDecompress()
                    : null;
            if (encoding && encoding !== "identity" && !decoder) {
              reject(new ProcessingError("UNSUPPORTED_ENCODING"));
              res.destroy();
              return;
            }
            const stream = decoder ? res.pipe(decoder) : res;
            const fail = (error: Error) => {
              reject(error);
              stream.destroy();
              res.destroy();
              request.destroy();
            };
            res.on("data", (chunk: Buffer) => {
              wireBytes += chunk.length;
              if (wireBytes > 5 * 1024 * 1024)
                fail(new ProcessingError("RESPONSE_TOO_LARGE"));
            });
            res.on("error", () =>
              fail(new ProcessingError("FETCH_FAILED", true)),
            );
            stream.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 5 * 1024 * 1024)
                fail(new ProcessingError("RESPONSE_TOO_LARGE"));
              else chunks.push(chunk);
            });
            stream.on("error", () =>
              fail(new ProcessingError("INVALID_RESPONSE")),
            );
            stream.on("end", () =>
              resolve({ html: Buffer.concat(chunks).toString("utf8") }),
            );
          },
        );
        request.on("error", () =>
          reject(
            new ProcessingError(
              signal.aborted ? "FETCH_TIMEOUT" : "FETCH_FAILED",
              true,
            ),
          ),
        );
      },
    );
    if (response.location) {
      current = response.location;
      continue;
    }
    return { html: response.html!, url: current };
  }
  throw new ProcessingError("TOO_MANY_REDIRECTS");
}
