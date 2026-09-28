---
name: share-link
description: Save a user-provided article or YouTube URL to Sharing for the authenticated user. Use only when the user asks to share a link with the team.
---

# Share a link

Use the `sharing` MCP connection's `share_link` tool with the URL the user supplied. The service assigns the sharer from the OAuth connection; do not provide or imply another identity.

Generate one unique `idempotency_key` for this intended submission, such as a UUID. Reuse that exact key when retrying an uncertain network result. Use a new key only if the user intentionally wants another share. Report the returned share URL, ID, `replayed` value, and processing status. Saving a link does not mean its summary is ready.

If the tool returns an error, explain its code and message. Do not claim the link was saved without a successful result.
