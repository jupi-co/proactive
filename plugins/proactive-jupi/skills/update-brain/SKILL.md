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
> Therefore: put whose claim it is and how sure you are **in the clause itself** — *"Nick's read after the 22 July call is that Antoine was looking for reasons not to run a pilot (holidays, compliance)"* — and keep the `(src: …)` parenthetical as a bonus for whoever reads the raw document, never as the only place the qualification lives.
>
> **In-clause hedging helps, but it is a mitigation, not a fix — don't treat it as a guarantee.** Four independent runs (2026-07-29) wrote the hedge inside the clause exactly as prescribed and still lost it at the top rank: *"update-brain's inferred read is that he is the main sourcer of inbound intros"* came back as the flat **"Nick Hernandez is the main sourcer of inbound intros at Jupi"**, and an explicitly-marked inference came back rendered as *"…**confirm** that Beamy is a live account"* — the aggregation layer upgraded a hedge into a confirmation. Temporal qualifiers fare worst: they are dropped essentially always. One run also saw a re-saved correction rank **below** the flattened original (0.81 vs 0.80), so "recency wins" is not dependable either.
>
> **So: never let safety rest on a qualifier surviving.** If a Fact is only safe *because* it is hedged or dated, it does not belong in the brain in that form — state the narrower claim you can defend unqualified, or put the qualifier in Neon where it comes back as written (§Voice profiles is the worked example). **Test it, don't assume:** after a batch, `recall` one hedged Fact and read what returns. If the hedge is gone, that is the store behaving as measured — report it, and reach for the structural fix rather than rewording the sentence again.

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

### Voice profiles — the one case that uses the Supermemory HTTP API
`act-or-decide` has to match the recipient's register before it drafts any message, and its only way to get
that has been to pull the ten most recent messages the user sent that person in that channel — **every run,
per recipient**. That is the most repeated expensive read in the whole system, and voice is about the most
durable thing there is to know about a relationship. So it should be stored.

**It stays in Supermemory — but through the HTTP API, not the connector:**
```
node "${CLAUDE_PLUGIN_ROOT}/shared/memory.mjs" put-voice '{"person":"nick","channel":"email",
  "register":"no greeting, 1–4 lines, question in the first sentence, no emoji, French",
  "observed_at":"2026-07-24","sample_size":12,"verified":true,
  "source_note":"gmail in:sent to:n@jupi.co, 12 threads 2026-07-03..21"}'

node "${CLAUDE_PLUGIN_ROOT}/shared/memory.mjs" get-voice <person> <channel>   → the profile, or null
node "${CLAUDE_PLUGIN_ROOT}/shared/memory.mjs" list-voice                     → every profile on file
```
One profile per **(person, channel)** pair, keyed `customId: voice:<person>:<channel>` — the same person is
often formal on email and terse in Linear, and a merged profile is worse than none.

**Why the API and not `memory`/`recall`.** This is the **upgrade trigger** `references/supermemory.md` has
described from the start — *"noisy recall (duplicate/contradictory facts) or a need for structured
filtering/enumeration → add the HTTP API"* — and a voice profile trips it on both counts:
- **`recall` is ranked and approximate; this lookup is exact.** You want *the* register for this pair, current
  value. Measured (2026-07-29): a re-saved correction ranked **below** the flattened original (0.81 vs 0.80),
  so "save a new statement and let recency reconcile" does not reliably return the current one. `customId`
  gives an exact keyed read with genuine last-write-wins.
- **The date has to survive, and in `content` it does not.** The extraction layer strips dates and
  attributions from the top-ranked memory a caller reads, wherever in the sentence they sit — including
  in-clause, which this skill used to prescribe as the fix. **`metadata` is not rewritten:** it comes back
  verbatim. A dateless voice profile is not a slightly-degraded one — nothing can tell a fresh register from a
  two-year-stale one, and it drafts in the user's name from it.

So the qualifiers (`observed_at`, `sample_size`, `verified`, `source_note`) live in **metadata**, and the
register prose lives in **content** where semantic recall still finds it ("how do we talk to Nick?"). Same
store, same container tag, same single-writer rule — you are still the only writer. Keep the content's claims
**timeless**: state the register, not how fresh it is. Wanting to write "as of <date>" into the content is the
signal it belongs in metadata.

`memory.mjs` handles three API behaviours you would otherwise have to rediscover: a null metadata value
**400s the whole write** (so absent fields are omitted); `POST` with an existing `customId` **appends** to
content (five re-observations would leave five contradictory registers in one document — the same failure
relocated), so it `PATCH`es to update and only `POST`s to create; and `verified` is OR-ed with its prior value
so a later unverified hand-over cannot erase the fact that someone once checked against the source.

**This is the only thing on the HTTP path.** Ordinary Facts stay on the connector — simpler, and semantic
recall is what they are for. The cost of the API path is a **second secret** (`supermemoryApiKey`) that a
scheduled routine has to carry alongside the Neon string, which is why it is scoped to what genuinely needs it
rather than becoming the default.

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
node "${CLAUDE_PLUGIN_ROOT}/shared/db.mjs" frontier-stats [days]   → pending / pushed vs drained / verdict
```
`kind` routes it: **`entity`** (who/what is this?) · **`voice`** (how does the user write to X in channel Y? —
§Voice profiles) · **`topic`** (a subject area worth a sweep).

**Push as you go — that is the heart of it.** Every run turns up things you weren't looking for: a name that
keeps appearing with no context, a project referenced in three threads you know nothing about, an org behind
an address you can't place. Push them (`pushed_by: "update-brain"`) instead of chasing them now: chasing
blows your budget on whatever you happened to notice first, while pushing lets the next run take them in
order, and lets an item that was pushed twice from two directions be recognised as one.

**But you are the biggest pusher, so you own the arithmetic.** A measured 5-item sweep of this skill pushed
**12** items — a healthy discovery rate and a queue that grows about six times faster than a ~1/3 frontier
budget can retire it. Left alone that ends in a queue nobody can work off, where the gap that blocked a
decision sits under forty that merely occurred. Two things follow:
- The queue is **bounded** (`frontierMaxPending`, default 50). At the cap `push-frontier` returns
  `{capped: true}` and writes nothing. **Say so in your summary with the count** — a refused push is a
  signal about drain rate, and one nobody sees is worse than the unbounded queue it replaced.
- **Push what a later run is genuinely better for having; not one row per name you saw.** Ten near-identical
  `entity` pushes from one calendar sweep is the failure mode — prefer the handful that block real work.

**Size the frontier budget from the queue, not from a fixed fraction.** `frontier-stats` gives you `pending`,
`pushed_recent` vs `drained_recent`, a `growth_ratio` and a plain `verdict`. Read it at step 2:
- `keeping up` → the usual ~1/3 to the frontier.
- `growing` / `growing, nothing drained` → **give the frontier half the budget or more, and say why.** A
  third of a small budget against a growing queue is a rule that guarantees it never converges.
- `full — pushes are being refused` → the frontier IS the run. Spend the whole budget draining, push nothing
  new, and open the summary with it.

**Close what you drain, honestly.** `done` = you looked (whether or not it yielded a Fact — a lookup that
found nothing is still answered, and re-queuing it forever is how a frontier silts up). `dropped` = not worth
looking at, or no longer meaningful. Never leave a drained item `pending`: the next run will drain it again
and pay for it again.

## Modes

### `full` (default) — windowed sweep to build/refresh the brain
Narrate each step (✅ done / 🔧 fixed / ⚠️ needs you); announce your budget.
1. Read `jupiUserId` from config → container tag `user_<jupiUserId>`. Read your cursors via `db.mjs get-cursor brain <source>` (user-scoped automatically).
2. **Pick a budget and say it** — a realistic number of items/sources this run. A few well-done beats skimming everything (agent length + credits are the real limits — this is why we crawl incrementally rather than all-at-once). **Read `frontier-stats` first and split the budget from its `verdict`** (§the two halves): `keeping up` → ~a third to the frontier; `growing` → half or more; `full` → all of it. Say the split *and the verdict you sized it from*, so a queue outrunning its drain rate is visible in the report rather than inferred three runs later.
3. **Drain the frontier first** — `list-frontier [N]`, oldest first, up to your frontier budget. These are gaps a *planner* hit while trying to do the user's work, so they are the highest-value thing you can spend a lookup on: the window is a guess about what matters, the frontier is evidence. Research each per its `kind` (`entity` → who/what is this · `voice` → §Voice profiles · `topic` → a filtered sweep), `save` the Facts, then `close-frontier <id> done|dropped`. Read each item's `note` before you start — it carries *why* it was queued, which is usually the difference between a useful lookup and a generic profile. If the frontier is empty, say so in one line and give the whole budget to the window.
4. For each `Connected` tool tagged **`context`** in `.proactive-jupi/assets.md` (that role means "read it to feed the brain"): read content **newer than its cursor** within `crawlWindowDays`, using **filters, not bulk reads**. Synthesize Facts → `save` to the container tag. **Push what you trip over** (`push-frontier`) rather than chasing it now.
   - **An empty `context` set means a stale map, not an empty world — never report a clean run having read nothing.** An `assets.md` written before the roles refactor has no `Roles` column at all, so no tool carries `context` even though every one of them is connected and healthy. In that case fall back to the `Connected` tools whose surface is plainly readable context (mail, calendar, docs, issues), **say in the summary that you inferred the sources from a pre-roles `assets.md`**, and recommend re-running `setup-proactive-jupi` to reconcile it. A `Roles` column that exists but tags nothing `context` is a real configuration answer — report it and crawl nothing.
5. **Advance each cursor** — `db.mjs advance-cursor brain <source> <cursor>` (user-scoped automatically).
6. **Refresh core facts**: `recall` the durable ones (user identity, key orgs/relationships); if a fact has changed, **`save` the corrected statement** — Supermemory reconciles same-entity memories and favors recency. Do **not** rely on `forget` to remove the stale one: on the connector it is best-effort (semantic match ≥0.85 against Supermemory's *rewritten* stored form) and routinely misses paraphrased facts; there is no delete-by-id. **Reliable correction/deletion needs the HTTP API** (upgrade trigger) — until then, phrase updates as new authoritative statements and let recency win.
7. **Screen a sample of what you wrote** (§Fact integrity) — `recall` a handful, check for degenerate text and lost qualification, re-save corrections.
8. Return a short summary: budget drained (**frontier vs window, and the `frontier-stats` verdict you sized it from**), facts written, **facts screened + any degenerate ones found**, cursors advanced, **frontier closed vs pushed vs still pending — plus any push that was refused at the cap** (that refusal is the clearest evidence the brain isn't crawled often enough; never drop it silently), any unreachable tool, zones still uncovered.

### `targeted "<request>"` — focused lookup for act-or-decide
1. Read `jupiUserId` from config → tag `user_<jupiUserId>`. `recall` what we already know about the entity — don't re-fetch what's known.
2. Pull specific **new** content from the relevant tool(s) (filtered search on the entity).
3. Synthesize + `save` new/updated Facts.
4. **Return a short synthesized summary (4–6 lines)** to the caller — that's the value; don't just say "done".
5. **Push what you tripped over** (`push-frontier`, `pushed_by: "update-brain"`) — a targeted lookup almost always turns up an adjacent unknown, and it's the cheapest moment to notice it. Don't chase it: the caller is waiting on an answer to *their* question.

**Two shapes of request arrive here.**
- **A lookup** — *"who is X / what is this org / what's the state of this project?"* — the flow above.
- **An observation to record**, most often a **voice profile** `act-or-decide` observed in its own Stage 6:
  it has already read the sent history and hands you the register it saw, plus the query and date range it
  read. You **spot-check it, then record it** (§Voice profiles). The single-writer rule is why it routes
  through you at all: `act-or-decide` may observe, but only you author what lands in the brain.

### Spot-check a handed-over observation — one call, not ten
An earlier version of this skill said to take the observation as given, on the reasoning that re-reading the
same ten messages would burn the exact cost the path exists to remove. **That was wrong, and an eval caught
it being wrong in the most direct way available:** a run that re-read the source found the handed-over
observation had the *language* wrong (French, not English) and the *sign-off* wrong (there wasn't one). A
voice profile is what `act-or-decide` imitates the user with on outbound mail, so a wrong one doesn't sit
inertly in the brain — it writes in the user's name, in the wrong language, to their counterparty.

The saving is real; the way to keep it is to make the check **cheap, not absent**:
- **One filtered call, metadata or a single thread** — the same `search_threads` query the caller says it
  used. You are checking the observation's *shape* (language, greeting, sign-off, rough length), which is
  visible in snippets. You are **not** re-reading ten bodies; that is the cost being avoided.
- **It agrees** → record it `verified: true`. Cost: one call, and the profile is now trustworthy.
- **It disagrees** → record what *you* saw, `verified: true`, and **say in your return that the hand-over
  was wrong and on what**. The caller drafted from the wrong register this run; it needs to know.
- **You genuinely can't check** (channel unreachable, no sent history) → record it `verified: false` and
  **say so in the register text itself** — *"as reported by act-or-decide, unchecked against the source"*.
  An unverified profile is still better than none, but only if whoever reads it knows which it is.

**This is a trailing call — treat it as such.** `act-or-decide` invokes it *after* its report is out,
deliberately off the critical path, so nothing is waiting on you. One spot-check call, then write. Don't
expand it into a crawl.

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
