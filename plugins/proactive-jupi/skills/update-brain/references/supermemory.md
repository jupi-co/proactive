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

## Connector behaviour you must design around
- **`save` is async-rewritten, retitled, and split into several memories** (4 docs → 11, 5 → 19). The stored form differs from what you sent, which is why `forget`-by-content fails and why the top-ranked memory a caller reads often isn't your sentence.
- **The rewrite strips — and sometimes inverts — hedges and attributions.** *"update-brain's inferred read is that…"* comes back as a flat assertion; an explicit inference has been seen rendered as *"…confirm that…"*. In-clause hedging reduces this but does not prevent it, so **never let safety rest on a qualifier surviving**: state the narrower claim you can defend unqualified. Write a qualifier only where it changes how the Fact is *used* even when degraded — e.g. a voice register marked "not yet checked against the source" — and write it knowing it may not come back.
- **`save` can land under the wrong container tag, and responses can cross-talk** — a save confirming into another tenant's tag; a `save` returning a `recall` payload, or vice versa. This is not confined to multi-session concurrency. **So verify by reading, not by trusting the confirmation:** after a batch, `recall` on your tag and check the Fact is present under it; re-save only if it is genuinely absent. Re-saving on a mismatched *confirmation* manufactures duplicates you cannot delete, because the confirmation is the unreliable part. Don't run a second Facts-writer concurrently, and prefer per-user API tokens over container-tag isolation alone once there is more than one user.

## Upgrade trigger
Noisy recall (duplicate/contradictory facts) or a need for structured filtering/enumeration → add the **HTTP API**: `POST /v3/documents` (raw content, `customId`, `metadata`) and `POST /v4/memories` (entity-centric, `isStatic`), authenticated with the Supermemory API key. Re-introduce the key in `config.local.json` only when this trigger fires.

**When it fires, it fires for the whole brain — never as a side path for one fact-type.** In particular a voice profile does not trip it: it is an ordinary `[Process]` Fact, and its freshness is handled by `act-or-decide` cross-checking the register against the thread it is replying into, not by a stored date. Anything that tempts a keyed store or a surviving timestamp for a single kind of Fact is the same underlying gap (rewrite-loses-qualifiers, recall-is-ranked) that the HTTP-API upgrade addresses uniformly; solve it there, for all Facts, or not at all.
