---
name: list-members
description: Find Sharing team members by name or email and resolve duplicate names before filtering shares. Use when the user asks who a sharer is or names a colleague ambiguously.
---

# Find Sharing members

Use the `sharing` MCP connection's `list_members` tool with the user's name or email query. Follow `next_cursor` if more matches may matter.

Show enough information to distinguish matches, especially email addresses. If more than one member fits, ask the user to select one before calling `list_shares` with `user_id`. Do not infer identity from a shared display name. A historical member can appear with `active: false`; do not describe that record as currently eligible to access Sharing.
