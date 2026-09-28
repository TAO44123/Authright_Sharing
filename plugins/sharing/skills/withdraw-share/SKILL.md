---
name: withdraw-share
description: Withdraw one of the authenticated user's Sharing links by share ID. Use only when the user asks to remove their own share from normal team queries.
---

# Withdraw a share

Use the `sharing` MCP connection's `withdraw_share` tool. If the user did not provide a `share_id`, find candidates with `list_shares` and ask which one they mean when ambiguous. Show the original URL or title before acting when it is needed to resolve the target.

Call `withdraw_share` only for a user request to withdraw that specific share. The service enforces ownership. A successful withdrawal hides this share from normal queries but does not remove another person's share of the same URL. Report success only after the tool returns `withdrawn: true`; otherwise explain the returned error.
