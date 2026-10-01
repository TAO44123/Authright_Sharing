---
name: list-members
description: List Sharing team members or find them by name or email. Use for member lists, identifying a sharer, or resolving duplicate names before filtering shares.
---

# Find Sharing members

Use the `sharing` MCP connection's `list_members` tool with the user's name or email query. Omit `query` when the user wants the member list. To list all members, follow `next_cursor` until no cursor remains, preserving any original query; do not present the first page as the complete list.

Show enough information to distinguish matches, especially email addresses. If more than one member fits, ask the user to select one before calling `list_shares` with `user_id`. Do not infer identity from a shared display name. A historical member can appear with `active: false`; do not describe that record as currently eligible to access Sharing.
