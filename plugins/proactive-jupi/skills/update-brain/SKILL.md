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

## Fact integrity — check what came back, not just that something did

**Screen a sample each run.** After a batch of saves, `recall` a handful and read what returns. Two failures
hide behind a successful write:

- **Degenerate Facts.** Some come back as token loops — one observed at ~2KB of *"Mandate obligating…
  mandrcer mandatory mandatory props…"*. Sources were clean; the corruption is store-side. **Recall-
  verification does not catch this** — the Facts *do* return, so every "did it land?" check passes and only
  the content is rotten. Screen for a **high repeated-token ratio** and **implausible length** (a Fact is one
  compact sentence; past a few hundred characters is already suspect).
- **Lost qualification** — check one hedged Fact still carries its attribution in the sentence itself.

**Surface what you find.** Re-save a corrected statement (recency wins) and report how many you screened and
how many were degenerate — never a clean run. Note that the corrupt memory **stays retrievable** (`forget` is
unreliable, no delete-by-id), so `act-or-decide` can still recall it: persistent corruption is the **upgrade
trigger** toward the HTTP API, where a Fact can actually be rewritten by id.

**Provenance back to the source task.** When a Fact derives from a task `refresh-backlog` parsed, **name the
task in the source clause** — `(src: task <id> / gmail thread 18f… 2026-06-09; confirmed)`. Without it there
is no path from "the Parser misread this" to "the Fact it produced is wrong": on the reference run a mail
about Jupi's own team was read as being about pilot companies, became a Fact, and the brain now *corroborates*
the error — re-crawling won't fix it, because the Fact reads as independent confirmation of its own source.
Carry a `parse_confidence: low|medium` hedge into the Fact's own sentence too, since the store strips trailing
parentheticals.

## Types (the ontology)
**Person · Org · Project · Process · Tool · Goal** — tag inline as `[Person]`, etc. A **Process** *describes* how they work; if you spot an automatable recurrence, just note it as a fact — `act-or-decide` turns recurrences into Patterns, not you.

### Voice profiles — a `[Process]` Fact about how the user writes to someone
`act-or-decide` has to match the recipient's register before it drafts any message, and its only way to get
that has been to pull the ten most recent messages the user sent that person in that channel — **every run,
per recipient**. That is the most repeated expensive read in the whole system, and voice is about the most
durable thing there is to know about a relationship. So it belongs in the brain:

```
[Process] <user> → <person> on <channel> — <register>. Observed from <n> sent messages up to <date>.
```
- `[Process] Anne-Claire → Nick on email — writes in English, no greeting, 2–4 lines, signs off "AC", no emoji, asks the question in the first sentence. Observed from 12 sent messages up to 2026-07-24.`
- `[Process] Anne-Claire → Batch (Antoine) on email — French, formal "Bonjour Antoine", full sentences, closes "Bien à vous". Observed from 10 sent messages up to 2026-06-30.`

**The observation date goes inside the sentence, not in the `(src: …)` parenthetical** — same reason as every
other qualification here: the store strips trailing parentheticals from the chunks a caller actually reads,
and a voice profile with no date is one the planner can't tell is two years stale. Register drifts as a
relationship changes; the date is what makes the Fact safely reusable instead of quietly wrong.

Keep one profile per **(person, channel)** pair — the same person is often formal on email and terse in
Linear, and a merged profile is worse than none. When you re-observe a pair, save a fresh statement with the
new date and let recency win (correction works the same way as everywhere else — §full step 5).

## Incremental crawling — the `crawl_state` cursor
Neon `crawl_state` holds a row per `(user_id, consumer, source, is_eval)`; yours is **`consumer='brain'`**, scoped to your tenant. Dedup **and** credit control: only ever read content **newer** than the cursor, then advance it — never re-read a window twice. The `consumer` column keeps your cursors independent of `refresh-backlog`'s (`consumer='backlog'`) on the same source; `is_eval=true` isolates eval runs.
- Access via the shared helper: `node "${CLAUDE_PLUGIN_ROOT}/shared/db.mjs" get-cursor brain <source> [eval]` and `advance-cursor brain <source> <cursor> [eval]`. It reads the project-scoped `neonConnString` **and** `jupiUserId` from config and **scopes every query by `user_id` automatically** (the same id behind your container tag `user_<jupiUserId>`) — so you never hand-write SQL, never pass the user id, and never touch the account-wide Neon MCP. Without that scoping a shared DB would cross users' cursors; the helper guarantees it. *(Deps: run `bash "${CLAUDE_PLUGIN_ROOT}/shared/ensure-deps.sh"` once at the top of the run — **the** dependency path every `db.mjs` caller shares, idempotent and silent when they already resolve. Never symlink another directory's `node_modules` into `shared/`; it lasts exactly as long as the session.)*
- **Config not found at boot.** Stop and report — don't hunt for it elsewhere (searching a connected Drive or inbox for a secret-bearing file is unbounded, and is the chat-visible flow the connection string must never travel through). A scheduled routine **carries** its config and writes it to `./.proactive-jupi/config.local.json` before invoking you, so config missing under a routine means that boot step didn't happen — the routine needs re-creating by setup, not a retry. Say which case you're in.

## You are a crawler, and a crawler has two halves
The `crawl_state` cursor is your **visited set** — "don't read this window again". On its own it makes you a
crawler that only ever walks forward in time: whatever the window happens to contain is what the brain learns,
and a gap nobody's mail happens to mention stays a gap forever.

The **frontier** (`crawl_frontier`) is the other half — *what is worth looking at next*, pushed by whoever
tripped over it. `act-or-decide` plans against the brain all day and is the one that discovers its holes: it
hits an unknown counterparty mid-cluster, or needs a voice profile that doesn't exist, and pushes the gap here
rather than dropping it. **You drain it.** That loop is what makes the brain converge on what the work
actually needs, instead of merely accumulating whatever floated through the window.

Frontier rows are **requests to look, never Facts** — which is precisely what lets other skills steer your
crawling without becoming writers of the brain. You still read the tools and author every Fact.

```
node "${CLAUDE_PLUGIN_ROOT}/shared/db.mjs" list-frontier [N]        → pending items, oldest first
node "${CLAUDE_PLUGIN_ROOT}/shared/db.mjs" push-frontier '<json>'   → {kind, entity, note, source_ref, pushed_by}
node "${CLAUDE_PLUGIN_ROOT}/shared/db.mjs" close-frontier <id> done|dropped
```
`kind` routes it: **`entity`** (who/what is this?) · **`voice`** (how does the user write to X in channel Y? —
§Voice profiles) · **`topic`** (a subject area worth a sweep).

**Push as you go — that is the heart of it.** Every run turns up things you weren't looking for: a name that
keeps appearing with no context, a project referenced in three threads you know nothing about, an org behind
an address you can't place. Push them (`pushed_by: "update-brain"`) instead of chasing them now: chasing
blows your budget on whatever you happened to notice first, while pushing lets the next run take them in
order, and lets an item that was pushed twice from two directions be recognised as one.

**Close what you drain, honestly.** `done` = you looked (whether or not it yielded a Fact — a lookup that
found nothing is still answered, and re-queuing it forever is how a frontier silts up). `dropped` = not worth
looking at, or no longer meaningful. Never leave a drained item `pending`: the next run will drain it again
and pay for it again.

## Modes

### `full` (default) — windowed sweep to build/refresh the brain
Narrate each step (✅ done / 🔧 fixed / ⚠️ needs you); announce your budget.
1. Read `jupiUserId` from config → container tag `user_<jupiUserId>`. Read your cursors via `db.mjs get-cursor brain <source>` (user-scoped automatically).
2. **Pick a budget and say it** — a realistic number of items/sources this run. A few well-done beats skimming everything (agent length + credits are the real limits — this is why we crawl incrementally rather than all-at-once). **Split it explicitly between the frontier and the window** (a reasonable default is roughly a third to the frontier) and say the split, so a frontier that's growing faster than you drain it is visible rather than inferred.
3. **Drain the frontier first** — `list-frontier [N]`, oldest first, up to your frontier budget. These are gaps a *planner* hit while trying to do the user's work, so they are the highest-value thing you can spend a lookup on: the window is a guess about what matters, the frontier is evidence. Research each per its `kind` (`entity` → who/what is this · `voice` → §Voice profiles · `topic` → a filtered sweep), `save` the Facts, then `close-frontier <id> done|dropped`. Read each item's `note` before you start — it carries *why* it was queued, which is usually the difference between a useful lookup and a generic profile. If the frontier is empty, say so in one line and give the whole budget to the window.
4. For each `Connected` tool tagged **`context`** in `.proactive-jupi/assets.md` (that role means "read it to feed the brain"): read content **newer than its cursor** within `crawlWindowDays`, using **filters, not bulk reads**. Synthesize Facts → `save` to the container tag. **Push what you trip over** (`push-frontier`) rather than chasing it now.
   - **An empty `context` set means a stale map, not an empty world — never report a clean run having read nothing.** An `assets.md` written before the roles refactor has no `Roles` column at all, so no tool carries `context` even though every one of them is connected and healthy. In that case fall back to the `Connected` tools whose surface is plainly readable context (mail, calendar, docs, issues), **say in the summary that you inferred the sources from a pre-roles `assets.md`**, and recommend re-running `setup-proactive-jupi` to reconcile it. A `Roles` column that exists but tags nothing `context` is a real configuration answer — report it and crawl nothing.
5. **Advance each cursor** — `db.mjs advance-cursor brain <source> <cursor>` (user-scoped automatically).
6. **Refresh core facts**: `recall` the durable ones (user identity, key orgs/relationships); if a fact has changed, **`save` the corrected statement** — Supermemory reconciles same-entity memories and favors recency. Do **not** rely on `forget` to remove the stale one: on the connector it is best-effort (semantic match ≥0.85 against Supermemory's *rewritten* stored form) and routinely misses paraphrased facts; there is no delete-by-id. **Reliable correction/deletion needs the HTTP API** (upgrade trigger) — until then, phrase updates as new authoritative statements and let recency win.
7. **Screen a sample of what you wrote** (§Fact integrity) — `recall` a handful, check for degenerate text and lost qualification, re-save corrections.
8. Return a short summary: budget drained (**frontier vs window**), facts written, **facts screened + any degenerate ones found**, cursors advanced, **frontier items closed vs pushed, and how many are still pending** — a pending count that only grows is the signal that the frontier budget is too small — any unreachable tool, zones still uncovered.

### `targeted "<request>"` — focused lookup for act-or-decide
1. Read `jupiUserId` from config → tag `user_<jupiUserId>`. `recall` what we already know about the entity — don't re-fetch what's known.
2. Pull specific **new** content from the relevant tool(s) (filtered search on the entity).
3. Synthesize + `save` new/updated Facts.
4. **Return a short synthesized summary (4–6 lines)** to the caller — that's the value; don't just say "done".
5. **Push what you tripped over** (`push-frontier`, `pushed_by: "update-brain"`) — a targeted lookup almost always turns up an adjacent unknown, and it's the cheapest moment to notice it. Don't chase it: the caller is waiting on an answer to *their* question.

**Two shapes of request arrive here, and the second needs no tool read.**
- **A lookup** — *"who is X / what is this org / what's the state of this project?"* — the flow above.
- **An observation to record**, most often a **voice profile** `act-or-decide` observed in its own Stage 6:
  it has already read the sent history and hands you the register it saw. There is nothing to go and fetch —
  **write the Fact from what it gave you** (§Voice profiles), in the shape with the observation date inside
  the sentence, and return one line confirming it. Re-reading the same ten messages to "verify" would burn
  the exact cost this whole path exists to remove. The reason it routes through you at all is the
  single-writer rule: `act-or-decide` may observe, but only you author what lands in the brain.

**This is a trailing call — treat it as such.** `act-or-decide` invokes it *after* its report is out,
deliberately off the critical path, so nothing is waiting on you. Be quick and don't expand scope; if the
observation is thin, save the thin version with its date rather than launching a crawl to enrich it.

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
- **You own the frontier's drain side** (`close-frontier`) and share its push side with the skills that feed it. Frontier rows are requests to look, never Facts — which is exactly why another skill queuing one doesn't make it a writer of the brain, and why draining one still means *you* read the tools and author what lands.

## When to upgrade beyond the connector
If `recall` gets noisy (duplicate/contradictory facts) or `act-or-decide` needs structured **filtering/enumeration**, that's the trigger to add the Supermemory **HTTP API** (customId dedup, metadata, isStatic — see the reference). Until then, stay connector-simple.
