# Supermemory — connector usage (for update-brain)

## Tools (installed MCP connector; names may be namespaced by connection)
- **`memory`** — save/forget a fact. Params: `content` (≤200k chars), `containerTag`, `action` (`save` | `forget`). **The only write path.** No metadata / customId / isStatic. **`forget` is best-effort** and often fails: it requires ≥0.85 semantic similarity to Supermemory's *rewritten* stored form and there is no delete-by-id, so it routinely can't remove a paraphrased fact (verified 2026-07-21). Treat reliable correction/deletion as an **HTTP-API-only** capability.
- **`recall`** — search memories. Params: `query`, `containerTag`, `includeProfile` (default true → also returns a profile summary). **The read path** for act-or-decide.
- **`memory-graph`** — inspect the relationship graph for a container tag.
- **`listMemories`**, **`listProjects`** — enumerate.
- **`whoAmI`** — current Supermemory user (`userId`, `email`). Informational only — **not** the identity source: the container tag keys on the canonical `jupiUserId` (see below), not on Supermemory's own `userId`.

## Container-tag scheme
- **One company = one Supermemory org** (the connected account).
- **v1:** a single **user-level tag** = `user_<jupiUserId>`. **Jupi is the reference for the userId** — the `jupiUserId` setup cached in `.proactive-jupi/config.local.json`, the same tenant key Neon rows carry, so the brain and the backlog share one identity. The tag *scheme* (`user_<…>`) is hard-coded here (update-brain's concern); the id is read from config, never asked, never derived from Supermemory's `whoAmI`.
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
Noisy recall (duplicate/contradictory facts) or a need for structured filtering/enumeration → add the **HTTP API**: `POST /v3/documents` (raw content, `customId`, `metadata`) and `POST /v4/memories` (entity-centric, `isStatic`), authenticated with the Supermemory API key. Re-introduce the key in `config.local.json` only when this trigger fires.

## The trigger fired — 2026-07-29, for voice profiles only

`shared/memory.mjs` is the HTTP path. **One thing uses it: the voice profile** (`put-voice` / `get-voice` /
`list-voice`), because it needs both halves of the trigger at once — an *exact keyed read* rather than a ranked
one, and *fields that survive*. Everything else stays on the connector, which is simpler and is what semantic
recall is for. The cost of this path is a second secret (`supermemoryApiKey`) for a scheduled routine to carry
alongside the Neon string, so it should stay scoped to what genuinely needs it.

Measured behaviours, so nobody has to rediscover them:

| Behaviour | What we measured |
|---|---|
| `customId` | A true key. Three writes to `voice:nick:email` returned **one** document id. |
| `metadata` | **Returned verbatim, not rewritten** — the only reason a dated profile can be trusted. Merges on update: a field you omit keeps its prior value. |
| **null metadata value** | **400s the entire write.** Omit absent fields; never send `null`. |
| `POST` with an existing `customId` | **APPENDS** to content (`"<old>\n\n---\n\n<new>"`). Five re-observations would leave five contradictory registers in one document — the same "correction doesn't win" failure, relocated. |
| `PATCH /v3/documents/<customId>` | **Replaces content, merges metadata.** This is what re-observation means, so `put-voice` PATCHes to update and only POSTs to create. |
| `PUT /v3/documents/<customId>` | 404 — doesn't exist. |
| `DELETE /v3/documents/<customId>` | Works, but **409 while the document is still processing** — don't build a delete-then-write update on it. |
| `GET /v3/documents/<customId>` | 200, with metadata. The keyed read. |
| `filters` on `/v3/documents/list` | Works: `{"AND":[{"key":"kind","value":"voice","negate":false}]}` enumerates just the profiles. |

**Extraction lag is real** (~20s+). A read straight after a write can return the *previous* content and
metadata, which reads exactly like the write having failed. Poll until the new value appears rather than
concluding it didn't land — this is the same trap as the missing save-confirmation, one layer down.

### What this does NOT fix
The connector's content-rewriting still applies to every ordinary Fact: hedges and attributions are stripped
or occasionally **inverted** ("update-brain's inferred read is that…" → a flat assertion; an explicit inference
rendered as "…**confirm** that…"). In-clause hedging is a mitigation, not a fix. If a Fact is only safe
*because* it is hedged, either state the narrower claim unqualified or put the qualifier in `metadata` on this
path — the voice profile is the worked example.

### Correction to the concurrency note above
This file claims single-session parallel saves route correctly and misroutes need concurrent multi-session
writes. **Two eval runs contradicted that on 2026-07-29**: a save inside one session confirmed into a
*different* tenant's tag, and there was response cross-talk (a `save` returning a `recall` payload, a `recall`
returning a save confirmation). Consequence for the guard: *"check the confirmation names your tag, re-save on
mismatch"* fires on a false signal and manufactures duplicates you cannot delete. **Make `recall`-to-verify the
primary path and re-save only if the Fact is genuinely absent** — not the fallback for a missing confirmation.
