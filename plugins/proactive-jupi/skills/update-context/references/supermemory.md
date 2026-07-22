# Supermemory — connector usage (for update-context)

## Tools (installed MCP connector; names may be namespaced by connection)
- **`memory`** — save/forget a fact. Params: `content` (≤200k chars), `containerTag`, `action` (`save` | `forget`). **The only write path.** No metadata / customId / isStatic. **`forget` is best-effort** and often fails: it requires ≥0.85 semantic similarity to Supermemory's *rewritten* stored form and there is no delete-by-id, so it routinely can't remove a paraphrased fact (verified 2026-07-21). Treat reliable correction/deletion as an **HTTP-API-only** capability.
- **`recall`** — search memories. Params: `query`, `containerTag`, `includeProfile` (default true → also returns a profile summary). **The read path** for act-and-decide.
- **`memory-graph`** — inspect the relationship graph for a container tag.
- **`listMemories`**, **`listProjects`** — enumerate.
- **`whoAmI`** — current user (`userId`, `email`). Use to derive the container tag.

## Container-tag scheme
- **One company = one Supermemory org** (the connected account).
- **v1:** a single **user-level tag** = `user_<whoAmI.userId>`. Hard-coded scheme, derived at runtime — never asked, never configured elsewhere.
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
- **Parallel `save` misroutes container tags — do NOT fan out saves.** Batched/parallel `memory save` calls were observed (two independent runs) landing in a *different* container tag than the one passed — an isolation/privacy break. **Save sequentially, one at a time, and verify each confirmation names your tag; re-save any that misrouted.**
- **`forget` is unreliable** — ≥0.85 similarity to the rewritten stored form, no delete-by-id; routinely can't remove a paraphrased fact. Reliable delete/correct = HTTP API (`DELETE /v3/documents/bulk` by `containerTags`, or by id).
- **`save` is async-rewritten/retitled** and extracted into *multiple* memories (one test: 4 saved docs → 11 memories; another: 5 → 19).

## Upgrade trigger
Noisy recall (duplicate/contradictory facts) or a need for structured filtering/enumeration → add the **HTTP API**: `POST /v3/documents` (raw content, `customId`, `metadata`) and `POST /v4/memories` (entity-centric, `isStatic`), authenticated with the Supermemory API key. Re-introduce the key in `setup.local.json` only when this trigger fires.
