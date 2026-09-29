import { test, expect } from "@playwright/test";
import { randomUUID, createHash, createHmac } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { db, pool } from "../../src/server/db/index.ts";
import { user } from "../../src/server/db/auth-schema.ts";
import {
  members,
  contents,
  tasks,
  shares,
} from "../../src/server/db/schema.ts";
import { auth } from "../../src/server/auth.ts";
const id = `e2e-${randomUUID()}`;
let cookie: string;
test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.insert(user).values({
    id,
    name: "Browser Tester",
    email: `${id}@authright.com`,
    emailVerified: true,
  });
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(id);
  const [joined] = await db
    .select()
    .from(members)
    .where(eq(members.userId, id));
  expect(joined.role).toBe("member");
  await db
    .update(members)
    .set({ role: "admin" })
    .where(eq(members.id, joined.id));
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(session.token)
    .digest("base64");
  cookie = encodeURIComponent(`${session.token}.${signature}`);
});
test.afterAll(async () => {
  await pool.end();
});
test("OAuth consent opens Sharing while the client callback completes", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: cookie,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const redirectUri = "http://127.0.0.1:39999/callback";
  const registration = await auth.handler(
    new Request("http://localhost:3103/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Browser OAuth callback test",
        application_type: "native",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        scope: "shares:read",
      }),
    }),
  );
  expect(registration.status).toBe(201);
  const client = await registration.json();
  const challenge = createHash("sha256")
    .update(randomUUID() + randomUUID())
    .digest("base64url");
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "shares:read",
    state: randomUUID(),
    resource: "http://localhost:3103/mcp",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  await context.route("http://127.0.0.1:39999/callback**", (route) =>
    route.fulfill({ status: 200, body: "Client callback reached" }),
  );
  await page.goto(`/api/auth/oauth2/authorize?${query}`);
  await expect(page).toHaveURL(/\/consent\?/);
  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Allow access" }).click();
  const sharingTab = await opened;
  await expect(sharingTab).toHaveURL("http://localhost:3103/");
  await expect(
    sharingTab.getByRole("heading", { name: "Worth passing on." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/127\.0\.0\.1:39999\/callback\?code=/);
  await expect(page.getByText("Client callback reached")).toBeVisible();
});
test("share, failed processing, retry, detail, filters, account and withdrawal", async ({
  page,
  context,
}, info) => {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: cookie,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/");
  const url = `https://example.com/${id}/browser-article`;
  await page.getByLabel("Found something worth sharing?").fill(url);
  await page.getByLabel("Found something worth sharing?").press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "Shared." }),
  ).toBeVisible();
  const link = page.getByRole("link", { name: url, exact: true });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  const [content] = await db
    .select()
    .from(contents)
    .where(eq(contents.originalUrl, url));
  await db
    .update(tasks)
    .set({ state: "failed" })
    .where(eq(tasks.contentId, content.id));
  await db
    .update(contents)
    .set({ status: "failed", failureCode: "FETCH_FAILED" })
    .where(eq(contents.id, content.id));
  await link.click();
  await expect(
    page.getByText("Unable to generate summary", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Read the original article" }),
  ).toHaveAttribute("href", url);
  await db
    .update(contents)
    .set({ failureCode: "SUMMARY_RATE_LIMITED" })
    .where(eq(contents.id, content.id));
  await page.reload();
  await expect(
    page.getByRole("status").filter({
      hasText: "Gemini usage limit reached — retry later",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry processing" }).click();
  await expect(page.getByText("Summary queued", { exact: true })).toBeVisible();
  await db
    .update(contents)
    .set({
      status: "ready",
      summaryOverview: "A browser verified overview.",
      summaryKeyPoints: [
        "First verified point.",
        "Second verified point.",
        "Third verified point.",
      ],
    })
    .where(eq(contents.id, content.id));
  await expect(
    page.getByRole("heading", { name: "AI article summary" }),
  ).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-results/${info.project.name}-detail.png`,
    fullPage: true,
  });
  await page.goto("/");
  await expect(
    page.getByText("Filter the library", { exact: true }),
  ).toHaveCount(0);
  expect(await page.locator(".list .share").count()).toBeLessThanOrEqual(5);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByLabel("Found something worth sharing?")).toHaveCount(
    0,
  );
  await page.getByText("Filter the library", { exact: true }).click();
  await page
    .getByLabel("Keyword", { exact: true })
    .fill("browser verified overview");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "Matching shares" }),
  ).toBeVisible();
  await expect(page.locator(".list .share")).toHaveCount(1);
  await page.screenshot({
    path: `test-results/${info.project.name}-library.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page.getByLabel("Display time zone").fill("Europe/London");
  await page.getByRole("button", { name: "Save time zone" }).click();
  await expect(page.getByText("Time zone saved.")).toBeVisible();
  await page.getByRole("link", { name: "Manage members" }).click();
  await expect(
    page.getByRole("heading", { name: "Team members." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add member", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Disable member", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.post("/api/admin/members", {
        data: { email: "unused@authright.com" },
      })
    ).status(),
  ).toBe(405);
  const [joined] = await db
    .select()
    .from(members)
    .where(eq(members.userId, id));
  expect(
    (
      await page.request.patch(`/api/admin/members/${joined.id}`, {
        headers: { origin: "http://localhost:3103" },
        data: { status: "disabled" },
      })
    ).status(),
  ).toBe(400);
  await page.goto(`/admin?query=${encodeURIComponent(`${id}@authright.com`)}`);
  const ownMember = page
    .locator(".member-row")
    .filter({ hasText: `${id}@authright.com` });
  await expect(ownMember).toHaveCount(1);
  await expect(
    ownMember.getByText("Browser Tester · admin · You"),
  ).toBeVisible();
  await expect(ownMember.getByRole("button")).toHaveCount(0);
  await page.screenshot({
    path: `test-results/${info.project.name}-admin.png`,
    fullPage: true,
  });
  await page.goto(href!);
  await page.getByRole("button", { name: "Withdraw my share" }).click();
  await page.getByRole("button", { name: "Confirm withdrawal" }).click();
  await expect(page).toHaveURL("http://localhost:3103/");
  await page.goto(href!);
  await expect(
    page.getByRole("heading", { name: "This share is unavailable." }),
  ).toBeVisible();
});
test("browser authentication failures show recovery pages while API callers keep JSON", async ({
  page,
}, info) => {
  await page.goto("/api/auth/callback/google?error=access_denied");
  await expect(page).toHaveURL(/\/auth-error\?/);
  await expect(
    page.getByRole("heading", { name: "Your sign-in link has expired." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Try signing in again" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/api/auth/oauth2/authorize");
  await expect(page).toHaveURL(/\/auth-error\?/);
  await expect(
    page.getByRole("heading", { name: "We couldn’t complete sign-in." }),
  ).toBeVisible();
  await expect(
    page.getByText("No invitation or administrator approval is needed.", {
      exact: false,
    }),
  ).toBeVisible();
  const response = await page.request.post("/api/auth/oauth2/token", {
    headers: { accept: "application/json" },
    form: { grant_type: "unsupported_test_grant" },
  });
  expect(response.status()).toBe(400);
  expect(response.headers()["content-type"]).toContain("application/json");
  await page.goto(
    "/auth-error?error=unknown&message=SECRET_PROVIDER_DETAIL&error_description=SECRET_PROVIDER_DETAIL",
  );
  await expect(page.locator("main")).not.toContainText(
    "SECRET_PROVIDER_DETAIL",
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-auth-error.png`,
    fullPage: true,
  });
});
test("ordinary members cannot manage members through the page or API", async ({
  page,
  context,
}) => {
  await db
    .update(members)
    .set({ role: "member" })
    .where(eq(members.userId, id));
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: cookie,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Administrator access required." }),
  ).toBeVisible();
  expect((await page.request.get("/api/admin/members")).status()).toBe(403);
});

test("video description stays distinct and a non-embeddable video keeps its source link", async ({
  page,
  context,
}, info) => {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: cookie,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/");
  await page
    .getByLabel("Found something worth sharing?")
    .fill("https://youtu.be/dQw4w9WgXcQ");
  const shareButton = page.getByRole("button", {
    name: "Share link",
    exact: true,
  });
  if (info.project.name === "mobile") await shareButton.tap();
  else await shareButton.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Shared." }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  const [video] = await db
    .select()
    .from(contents)
    .where(eq(contents.dedupeKey, "youtube:dQw4w9WgXcQ"));
  await db
    .update(contents)
    .set({
      status: "ready",
      title: "Browser video preview",
      summaryOverview: "This video explains how the audio workflow works.",
      promptVersion: "youtube-audio-en-v1",
      summaryKeyPoints: [
        "Download audio",
        "Extract spoken information",
        "Generate a summary",
      ],
      author: "Original creator",
      videoDescription: "",
      embeddable: false,
      metadataFetchedAt: new Date(),
      metadataExpiresAt: new Date(Date.now() + 86400000),
    })
    .where(eq(contents.id, video.id));
  await page.reload();
  await page
    .getByRole("link", { name: "Browser video preview", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Video description" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "AI video summary" }),
  ).toBeVisible();
  await expect(
    page.getByText("This video explains how the audio workflow works."),
  ).toBeVisible();
  await expect(page.getByText("Based on the video’s audio.")).toBeVisible();
  await db
    .update(contents)
    .set({ promptVersion: "youtube-url-en-v1" })
    .where(eq(contents.id, video.id));
  await page.reload();
  await expect(
    page.getByText("Based on the video’s spoken content and sampled visuals."),
  ).toBeVisible();
  await expect(page.getByText("Based on the video’s audio.")).toHaveCount(0);
  await expect(
    page.getByText("The author did not provide a description."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", /youtu/);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "AI article summary" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: `test-results/${info.project.name}-video.png`,
    fullPage: true,
  });
  await db
    .update(contents)
    .set({ embeddable: true })
    .where(eq(contents.id, video.id));
  const playerRequest = page.waitForRequest((request) =>
    request
      .url()
      .startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"),
  );
  await page.reload();
  await expect(page.locator("iframe.video-player")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
  await page.locator("iframe.video-player").scrollIntoViewIfNeeded();
  expect((await playerRequest).headers().referer).toBe(
    "http://localhost:3103/",
  );
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toBeVisible();
});

test("library loads all history ten at a time, retries without duplicates and resets filters", async ({
  page,
  context,
}, info) => {
  const prefix = `history-${randomUUID()}`;
  const rows = [];
  for (let i = 0; i < 23; i++) {
    const url = `https://example.com/${prefix}/${String(i).padStart(2, "0")}`;
    const [content] = await db
      .insert(contents)
      .values({
        dedupeKey: `${prefix}-${i}`,
        originalUrl: url,
        normalizedUrl: url,
        type: "article",
        title: `${prefix}-${String(i).padStart(2, "0")}`,
        status: "ready",
      })
      .returning();
    const [share] = await db
      .insert(shares)
      .values({
        contentId: content.id,
        userId: id,
        originalUrl: url,
        createdAt: new Date(Date.now() - 30 * 86400000 - i * 60000),
      })
      .returning();
    rows.push(share);
  }
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: cookie,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/");
  await expect(page.locator(".list .share")).toHaveCount(5);
  await expect(
    page.getByText("Filter the library", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "View all shares" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.locator(".list .share")).toHaveCount(10);
  let requests = 0;
  let failNext = true;
  await page.route("**/api/shares?cursor=*", async (route) => {
    requests++;
    if (failNext) {
      failNext = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "INTERNAL_ERROR" } }),
      });
    } else await route.continue();
  });
  await page.goto(`/library?query=${prefix}`);
  await expect(page.locator(".list .share")).toHaveCount(10);
  expect(requests).toBe(0);
  await page
    .getByRole("button", { name: "Load more shares", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("alert").filter({ hasText: "Unable to load more shares" }),
  ).toBeVisible();
  await expect(page.locator(".list .share")).toHaveCount(10);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".list .share")).toHaveCount(20);
  await page
    .getByRole("button", { name: "Load more shares", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.locator(".list .share")).toHaveCount(23);
  await expect(
    page.getByText("You’ve reached the end of the library."),
  ).toBeVisible();
  expect(requests).toBe(3);
  expect(
    await page
      .locator(".share-title")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("href")),
      ),
  ).toEqual(rows.map((row) => `/shares/${row.id}`));
  await page.getByLabel("Keyword", { exact: true }).fill(`${prefix}-22`);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator(".list .share")).toHaveCount(1);
  await expect(page.locator(".share-title")).toHaveText(`${prefix}-22`);
  await page.getByLabel("Keyword", { exact: true }).fill(`${prefix}-absent`);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator(".list .share")).toHaveCount(0);
  await expect(
    page.getByText("No matching shares.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Reset filters", exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.locator(".list .share")).toHaveCount(10);
  await page.screenshot({
    path: `test-results/${info.project.name}-all-history.png`,
    fullPage: false,
  });
});
