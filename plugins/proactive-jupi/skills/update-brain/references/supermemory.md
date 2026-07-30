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

**Nothing has tripped it yet, and voice profiles do NOT.** A voice profile felt at first like it needed the
keyed read and the surviving date this trigger buys, so an earlier pass built an HTTP-path helper for it. That
was over-reach: a voice profile is an ordinary `[Process]` Fact, its freshness is handled by `act-or-decide`
cross-checking the register against the thread it is replying into (not by a stored timestamp), and the
correction-doesn't-win concern below is general to the brain rather than specific to voice. So it stays on the
connector like everything else. When the trigger *does* fire, it fires for the **whole brain**, never as a
side path for one fact-type — that is the mistake to avoid, and it was nearly made here.

### In-clause hedging is a mitigation, not a fix
The connector's content-rewriting strips hedges and attributions from the top-ranked memory a caller reads,
and occasionally **inverts** them ("update-brain's inferred read is that…" → a flat assertion; an explicit
inference rendered as "…**confirm** that…", measured 2026-07-29). Writing the hedge in-clause helps but does
not guarantee survival. So never let safety rest on a qualifier surviving: state the narrower claim you can
defend unqualified. The one place a qualifier is still worth writing is where it changes how the Fact is
*used* even if degraded — e.g. a voice register marked "not yet checked against the source" — but write it
knowing it may not come back, not depending on it.

### Correction to the concurrency note above
This file claims single-session parallel saves route correctly and misroutes need concurrent multi-session
writes. **Two eval runs contradicted that on 2026-07-29**: a save inside one session confirmed into a
*different* tenant's tag, and there was response cross-talk (a `save` returning a `recall` payload, a `recall`
returning a save confirmation). Consequence for the guard: *"check the confirmation names your tag, re-save on
mismatch"* fires on a false signal and manufactures duplicates you cannot delete. **Make `recall`-to-verify the
primary path and re-save only if the Fact is genuinely absent** — not the fallback for a missing confirmation.
