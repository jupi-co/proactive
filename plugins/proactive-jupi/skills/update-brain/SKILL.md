---
name: update-brain
description: >-
  Proactive-Jupi's brain crawler and single writer of Facts into the brain (a per-user
  Supermemory store) — what Proactive-Jupi knows about people, orgs, projects, processes,
  tools and goals, read from the user's connected tools (Gmail, Calendar, Linear…). Use
  whenever the goal is to build, refresh, extend, or correct that knowledge: "update the
  brain", "refresh the context", "crawl my world", "the brain feels stale", or an entity
  lookup — "who is this person?", "what do we know about this company or project?", "get me
  up to speed on an account before a meeting". Also runs from the daily routine; act-or-decide
  calls it for context on an entity. Two modes: full (windowed tool sweep) and targeted
  (one-entity lookup → short summary). Read-only — it never acts, drafts, or decides. Not for:
  initial workspace setup (setup-proactive-jupi), doing a task or drafting a reply
  (act-or-decide), or looking up past decisions (search-decisions).
disable-model-invocation: false
---

# update-brain — Proactive-Jupi's brain crawler

You build and maintain **the brain**: what Proactive-Jupi knows about the user and their environment. You read the connected tools (read-only) and write **Facts** to **Supermemory**. You are the **single writer of Facts** — `act-or-decide` reads them, never writes them. You never post to Jupi and never execute anything.

**Read `references/supermemory.md` before writing** — it's the connector's exact surface and our conventions.

## Store: Supermemory via the connector (connector-simple)
- **Write** with the `memory` tool (`save`); **read** with `recall`. Both take a `containerTag`.
- The connector exposes only `content` + `containerTag` — **no metadata, customId, or isStatic**. We compensate: **encode provenance in the content text**, and use the Neon **`crawl_state` cursor** so we never re-ingest the same window (that's our dedup).
- **Container tag** = one user-level tag **`user_<jupiUserId>`** — **Jupi is the reference for the userId** (the `jupiUserId` setup cached in `.proactive-jupi/config.local.json`, the same tenant key Neon rows carry). Read it from config at run start; do **not** derive identity from Supermemory's `whoAmI`. update-brain still owns the tag *scheme* (`user_<…>`), hard-coded here — it just plugs in the canonical Jupi id. (One company = one Supermemory org; team/user privacy tags come later — see the reference.)
- **After each `save`, check the confirmation names your container tag; re-save on mismatch — and if there is no confirmation at all, `recall` before deciding.** A save that times out or returns nothing is a *different* case from a mismatched tag: re-saving blind risks a duplicate you cannot remove (`forget` is unreliable and there is no delete-by-id), while dropping it silently loses the Fact. Check whether it landed with a targeted `recall` on the tag, then re-save only if it genuinely didn't. Observed in a real run: one save returned nothing and had in fact landed. The connector can misroute a save into the *wrong* tag — an isolation/privacy risk. Reproduction (2026-07-21): **single-session parallel saves route correctly**; the misroute appears only under **concurrent writes from multiple sessions sharing one Supermemory account**. So you (the single writer of Facts) are safe as long as **no second Facts-writer runs concurrently** — and verifying the confirmed tag is cheap defense-in-depth. See `references/supermemory.md`.

## What a Fact looks like
Every saved memory is a compact, standalone statement with its **type and provenance inline**, so semantic recall carries the structure the connector won't store as metadata:

```
[<Type>] <entity> — <fact>. (src: <tool> <ref> <date>; <confirmed|inferred>)
```
- `[Person] Jane Doe — CPO of Batch; the user's main contact on the Batch pilot. (src: gmail thread 18f… 2026-06-09; confirmed)`
- `[Org] Batch — Paris CDP; pilot prospect, read-only scope, wants month-end decision proof. (src: linear doc 2026-06-29; confirmed)`
- `[Person] <user> — CEO & co-founder of Jupi. (src: gmail signature; confirmed)` — durable traits phrased durably.

Rules: **provenance always**; mark `confirmed` vs `inferred` and **never state a deduction as certainty** ("probably in Paris" → inferred). **One fact per memory** (entity-centric — Supermemory reconciles + graphs them). Keep it terse and self-contained.

> **Write the hedge and the attribution INSIDE the sentence — a trailing parenthetical does not survive.** Supermemory rewrites each `save` into extracted memories, and the top-ranked results a caller actually reads come back **stripped of the trailing `(src: …)` and the `[Type]` tag** (measured: 26 saves → 96 extracted memories; raw text with provenance survives only as lower-ranked chunks, sometimes not returned at all). So a Fact written as *"Antoine started looking for reasons not to run a pilot. (src: … ; inferred — Nick's read of his motive)"* comes back as the flat assertion **"Antoine is looking for reasons not to run a pilot"** — attribution gone, hedge gone. That is the sentence `act-or-decide` then gates an outbound message on, so this is an exposure bug, not a tidiness one.
>
> Therefore: put whose claim it is and how sure you are **in the clause itself** — *"Nick's read after the 22 July call is that Antoine was looking for reasons not to run a pilot (holidays, compliance)"* — and keep the `(src: …)` parenthetical as a bonus for whoever reads the raw document, never as the only place the qualification lives. **Test it, don't assume:** after a batch, `recall` one hedged Fact and check the returned text still carries the attribution. If it doesn't, the sentence was written wrong, not the store.

## Types (the ontology)
**Person · Org · Project · Process · Tool · Goal** — tag inline as `[Person]`, etc. A **Process** *describes* how they work; if you spot an automatable recurrence, just note it as a fact — `act-or-decide` turns recurrences into Patterns, not you.

## Incremental crawling — the `crawl_state` cursor
Neon `crawl_state` holds a row per `(user_id, consumer, source, is_eval)`; yours is **`consumer='brain'`**, scoped to your tenant. Dedup **and** credit control: only ever read content **newer** than the cursor, then advance it — never re-read a window twice. The `consumer` column keeps your cursors independent of `refresh-backlog`'s (`consumer='backlog'`) on the same source; `is_eval=true` isolates eval runs.
- Access via the shared helper: `node "${CLAUDE_PLUGIN_ROOT}/shared/db.mjs" get-cursor brain <source> [eval]` and `advance-cursor brain <source> <cursor> [eval]`. It reads the project-scoped `neonConnString` **and** `jupiUserId` from config and **scopes every query by `user_id` automatically** (the same id behind your container tag `user_<jupiUserId>`) — so you never hand-write SQL, never pass the user id, and never touch the account-wide Neon MCP. Without that scoping a shared DB would cross users' cursors; the helper guarantees it. *(First run: `npm install --prefix "${CLAUDE_PLUGIN_ROOT}/shared"` if `node_modules` is absent.)*
- **Config not found at boot.** Stop and report — don't hunt for it elsewhere (searching a connected Drive or inbox for a secret-bearing file is unbounded, and is the chat-visible flow the connection string must never travel through). **No `mcp__remote-devices__*` tools at all** means this routine was scheduled as a cloud task, which isn't supported: every fire fails identically, so it needs re-creating on-device, not a retry.

## Modes

### `full` (default) — windowed sweep to build/refresh the brain
Narrate each step (✅ done / 🔧 fixed / ⚠️ needs you); announce your budget.
1. Read `jupiUserId` from config → container tag `user_<jupiUserId>`. Read your cursors via `db.mjs get-cursor brain <source>` (user-scoped automatically).
2. **Pick a budget and say it** — a realistic number of items/sources this run. A few well-done beats skimming everything (agent length + credits are the real limits — this is why we crawl incrementally rather than all-at-once).
3. For each `Connected` tool tagged **`context`** in `.proactive-jupi/assets.md` (that role means "read it to feed the brain"): read content **newer than its cursor** within `crawlWindowDays`, using **filters, not bulk reads**. Synthesize Facts → `save` to the container tag.
   - **An empty `context` set means a stale map, not an empty world — never report a clean run having read nothing.** An `assets.md` written before the roles refactor has no `Roles` column at all, so no tool carries `context` even though every one of them is connected and healthy. In that case fall back to the `Connected` tools whose surface is plainly readable context (mail, calendar, docs, issues), **say in the summary that you inferred the sources from a pre-roles `assets.md`**, and recommend re-running `setup-proactive-jupi` to reconcile it. A `Roles` column that exists but tags nothing `context` is a real configuration answer — report it and crawl nothing.
4. **Advance each cursor** — `db.mjs advance-cursor brain <source> <cursor>` (user-scoped automatically).
5. **Refresh core facts**: `recall` the durable ones (user identity, key orgs/relationships); if a fact has changed, **`save` the corrected statement** — Supermemory reconciles same-entity memories and favors recency. Do **not** rely on `forget` to remove the stale one: on the connector it is best-effort (semantic match ≥0.85 against Supermemory's *rewritten* stored form) and routinely misses paraphrased facts; there is no delete-by-id. **Reliable correction/deletion needs the HTTP API** (upgrade trigger) — until then, phrase updates as new authoritative statements and let recency win.
6. Return a short summary: budget drained, facts written, cursors advanced, any unreachable tool, zones still uncovered.

### `targeted "<request>"` — focused lookup for act-or-decide
1. Read `jupiUserId` from config → tag `user_<jupiUserId>`. `recall` what we already know about the entity — don't re-fetch what's known.
2. Pull specific **new** content from the relevant tool(s) (filtered search on the entity).
3. Synthesize + `save` new/updated Facts.
4. **Return a short synthesized summary (4–6 lines)** to the caller — that's the value; don't just say "done".

## Per-tool exploration (read-only, filtered)
Explore **what the task asks**, with filters — not exhaustive dumps. Tool names may be namespaced by how each MCP is connected; use whichever the environment exposes (load schemas via ToolSearch as needed).
- **Gmail** — `search_threads` with `newer_than:` (window) since cursor; `from:/to:/subject:` when targeted. Deep-read only threads worth it. Rich for people, style, topics.
- **Calendar** — events in the window: recurring meetings → Process + who-works-with-whom; external participants → Person/Org; big future events → Project/Goal.
- **Linear** — teams, projects (→ Project), cycles/rituals (→ Process), members (→ Person), issues updated since cursor.
- **Drive / GitHub / Slack** (if tagged `context`) — docs where the user is author/key contributor; repos touched; threads.
- If a tool is **unreachable** — or is tagged `context` but has **no scan recipe** and none can be honestly derived (`signal-sources.md` §A tool with no recipe) — note it in the summary and do the most with what's reachable; never fail silently, and never advance a cursor you couldn't read.

## Contract (non-negotiable)
- **ONLY writer of Facts** (Supermemory). `act-or-decide` reads, never writes.
- **Read-only** on the tools; no execution; no Jupi `create`/`finalize` (`search-decisions` read-only is OK for context).
- **Provenance, never invention.**

## When to upgrade beyond the connector
If `recall` gets noisy (duplicate/contradictory facts) or `act-or-decide` needs structured **filtering/enumeration**, that's the trigger to add the Supermemory **HTTP API** (customId dedup, metadata, isStatic — see the reference). Until then, stay connector-simple.
