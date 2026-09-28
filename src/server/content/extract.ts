import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { ProcessingError } from "./types.ts";
export function extractArticle(html: string, url: string) {
  // No scripts, resources, cookies, or jsdom console forwarding are enabled.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  try {
    const document = dom.window.document;
    const restricted = [
      ...document.querySelectorAll('script[type="application/ld+json"]'),
    ].some((node) =>
      /"isAccessibleForFree"\s*:\s*(false|"false")/.test(
        node.textContent ?? "",
      ),
    );
    const article = new Readability(document, {
      maxElemsToParse: 30000,
      charThreshold: 140,
    }).parse();
    const text = article?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (
      restricted ||
      /(?:subscribe|sign in|log in) to (?:continue reading|read (?:the full|this) article)|订阅后阅读|登录后阅读/i.test(
        text,
      )
    )
      throw new ProcessingError("ACCESS_RESTRICTED");
    if (
      !article ||
      text.length < 140 ||
      !article.title?.trim() ||
      /(?:continue reading|read more)\s*[.…]*$/i.test(text)
    )
      throw new ProcessingError("INSUFFICIENT_CONTENT");
    if (text.length > 60000) throw new ProcessingError("CONTENT_TOO_LONG");
    return {
      title: article.title.slice(0, 1000),
      text,
      author: article.byline?.slice(0, 500) ?? null,
    };
  } finally {
    dom.window.close();
  }
}
