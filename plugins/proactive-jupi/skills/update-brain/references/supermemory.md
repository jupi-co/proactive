# Supermemory — connector usage (for update-brain)

## Tools (installed MCP connector; names may be namespaced by connection)
- **`memory`** — save/forget a fact. Params: `content` (≤200k chars), `containerTag`, `action` (`save` | `forget`). **The only write path.** No metadata / customId / isStatic. **`forget` is best-effort** and often fails: it requires ≥0.85 semantic similarity to Supermemory's *rewritten* stored form and there is no delete-by-id, so it routinely can't remove a paraphrased fact (verified 2026-07-21). Treat reliable correction/deletion as an **HTTP-API-only** capability.
- **`recall`** — search memories. Params: `query`, `containerTag`, `includeProfile` (default true → also returns a profile summary). **The read path** for act-and-decide.
- **`memory-graph`** — inspect the relationship graph for a container tag.
- **`listMemories`**, **`listProjects`** — enumerate.
- **`whoAmI`** — current Supermemory user (`userId`, `email`). Informational only — **not** the identity source: the container tag keys on the canonical `jupiUserId` (see below), not on Supermemory's own `userId`.

## Container-tag scheme
- **One company = one Supermemory org** (the connected account).
- **v1:** a single **user-level tag** = `user_<jupiUserId>`. **Jupi is the reference for the userId** — the `jupiUserId` setup cached in `.claude/setup.local.json`, the same tenant key Neon rows carry, so the brain and the backlog share one identity. The tag *scheme* (`user_<…>`) is hard-coded here (update-brain's concern); the id is read from config, never asked, never derived from Supermemory's `whoAmI`.
- **Later (privacy — Nick's public-vs-private split):** hierarchical `org_<id>` / `org_<id>_team_<id>` / `org_<id>_team_<id>_user_<id>`. Shared facts get the higher-level tag, private facts the user tag; Supermemory isolates by tag (a user can't read another's).

## What the connector does NOT give us — and how we compensate
| Missing (HTTP-only) | What it would buy | Our compensation |
|---|---|---|
| `customId` | idempotent dedup / precise update | **`crawl_state` cursor** → never re-ingest the same window. For changed facts, `save` the new statement and let Supermemory reconcile by recency (`forget` is unreliable — see the tool note) |
| `metadata` | structured filter/enumerate at recall | **encode type + provenance in the content text**; recall is semantic |
| `isStatic` | flag permanent traits for the profile | **phrase durable facts durably** |
| `/v3/documents` | raw file/URL ingestion + chunking | feed **text we already read** via the tool MCPs |

## Content conventions
```
[<Type>] <entity> — <fact>. (src: <tool> <ref> <date>; <confirmed|inferred>)
```
- One fact per `save`, entity-centric. Terse and standalone — `recall` returns it verbatim.
- Types: `Person · Org · Project · Process · Tool · Goal`.
- Provenance always; `confirmed` vs `inferred`; never a deduction as certainty.

## Verified connector findings (2026-07-21)
- **`save` can misroute a container tag under concurrency — verify each confirmed tag.** Single-session parallel saves route correctly (6/6 in test); the misroute was observed only under **concurrent writes from two sessions sharing one Supermemory account** (tags cross-applied both ways) — root cause looks server-side. **Guard:** don't run concurrent Facts-writers, and verify each save's confirmed tag, re-saving on mismatch. *Multi-user future: prefer per-user API tokens over container-tag isolation alone.*
- **`save` is async-rewritten/retitled** and extracted into *multiple* memories (tests: 4 saved docs → 11 memories; 5 → 19). The stored form differs from what you sent — which is also why `forget`-by-content fails (see the tool note).

## Upgrade trigger
Noisy recall (duplicate/contradictory facts) or a need for structured filtering/enumeration → add the **HTTP API**: `POST /v3/documents` (raw content, `customId`, `metadata`) and `POST /v4/memories` (entity-centric, `isStatic`), authenticated with the Supermemory API key. Re-introduce the key in `setup.local.json` only when this trigger fires.
