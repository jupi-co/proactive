# Supermemory bug report — container-tag misrouting under concurrent writes

**Date:** 2026-07-21 · **Severity:** high (cross-tenant isolation / privacy) · **Surface:** hosted MCP connector (`https://mcp.supermemory.ai/mcp`), `memory` (save) tool

## Summary
When **two independent client sessions share one Supermemory account** and write concurrently with **different `containerTag` values**, some writes land in the **other** session's container tag. Because container tags are the isolation boundary between users/tenants, this is a privacy break: one user's memory can be written into another user's container.

## Environment
- Hosted Supermemory MCP connector, one account (single API identity), MCP `memory` tool `save({ content, containerTag })`.
- Two independent MCP client sessions (call them A and B) authenticated as the same account.

## Reproduction
1. Session **A** issues several `save({ content, containerTag: "user_eval_scratch" })`.
2. Session **B**, running **at the same time**, issues several `save({ content, containerTag: "user_eval_baseline" })`.
3. **Observed:** 3 of A's 5 saves landed in `user_eval_baseline`, and 3 of B's saves landed in `user_eval_scratch` — **symmetric cross-contamination**. Both sessions passed the correct tag; the save **confirmation strings themselves reported the wrong container** (e.g. A got `… in user_eval_baseline project`).

### Negative control (isolates the cause)
A **single** session firing **6 parallel** saves that alternate two container tags routed **100% correctly (6/6)**. So this is **not** client-side, and **not** single-session parallelism — it is specific to **concurrent writes from multiple sessions under one account**.

## Impact
Container tags are documented as the per-user / per-tenant isolation mechanism (a user "can't read another's"). An application that uses **one account per organization with per-user container tags** (a documented pattern) will, under concurrent writes, leak memories across users. This defeats the privacy guarantee.

## Hypothesis
A **shared per-account (or per-token) "current container" state** on the server or the hosted MCP that is read/written per request and **races** when two concurrent requests carry different tags — so a request occasionally picks up the other in-flight request's tag.

## Questions / asks
1. Can you confirm and fix the tag binding to be strictly **per-request** (no shared mutable container state across concurrent requests)?
2. Is the **HTTP API** (`POST /v3/documents`, `POST /v4/memories`) affected the same way, or is it safe?
3. For strict multi-user isolation, do you recommend **per-user API tokens** rather than relying on container tags under a shared account?

## Adjacent observations (minor, same session)
- **`forget` is best-effort:** it requires ≥0.85 semantic similarity to the *rewritten* stored form and there is no delete-by-id, so `forget`-by-content routinely fails to remove a paraphrased memory. Bulk delete by `containerTag` via the HTTP API works reliably.
- **`save` is async-rewritten/retitled** and one document is extracted into multiple memories (observed 4 docs → 11 memories, 5 → 19), so the stored form differs from the submitted content.
