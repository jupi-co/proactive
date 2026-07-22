---
name: setup-proactive-jupi
description: Cold-start (set up) an Proactive-Jupi workspace — connect to Jupi/Neon/Supermemory and the tool MCPs, discover assets, apply the Neon schema, seed the brain with a fresh 1-month crawl of the core tools, initialize the backlog, and set cadence. Run once per workspace (re-runnable to refresh). Portable — assumes nothing is pre-connected.
disable-model-invocation: true
---

# Setup — cold-start an Proactive-Jupi workspace

Takes a workspace from zero to **ready to run act-and-decide**. Run once; re-runnable to refresh. Portable: assumes nothing is pre-connected. (Design rationale: the Proactive-Jupi implementation plan, §7.)

## Posture — narrate every step, sell the payoff (not IT config)
Proactive-Jupi exists to **do the user's work and learn how they operate** — frame each step as work being lifted off their plate, never as configuration. **Show your progress:** open each step by saying what you're about to do, and close it with a one-line status — **✅ already OK / 🔧 fixed / ⚠️ needs you**. The user should never wonder what the skill is doing or which step it's on.

## Before you start — user-side (I cannot do these)
The user creates the **accounts** out of band and has these on hand:
- **Jupi** workspace slug
- **Neon** project + connection string (project-scoped — see step 5)
- **Supermemory** account, added as an MCP **connector** (preferred over an API key)

I connect to them and to the tool MCPs, but **the user must complete any OAuth consent** when prompted. I never enter credentials or complete OAuth myself (prohibited by design).

## Where setup writes — keep the user's repo clean
Setup runs **inside the user's existing repo**, so everything Proactive-Jupi owns lives under one **`.proactive-jupi/`** folder at the workspace root (`.proactive-jupi/assets.md` today; the data trees later) — never scatter files across their tree. Create the folder if missing. The only exception is harness-owned config in `.claude/` (`settings.json` *must* be there; `proactive-jupi.local.json` by convention).

## Config — the workspace's `.claude/proactive-jupi.local.json` (gitignored)
Read it; if missing, copy from the bundled `reference/proactive-jupi.local.json.template` into the workspace `.claude/proactive-jupi.local.json`, then ask the user for any empty key and offer to save. Keys: `jupiWorkspace`, `neonProjectId`, `neonConnString`, `seedTools` (default `["gmail","calendar","linear"]`), `crawlWindowDays` (default `30`), `backlogWindowSize` (default `30` — the top-K of the scored backlog act-or-decide reasons over per run). One key is **resolved, not asked** — `jupiUserId` (the tenant identity; setup writes it in step 2 from the authenticated Jupi caller — the `user_id` on every Neon row and the brain's container tag). **Never commit this file.** Supermemory needs **no** key here — it uses the installed connector; its container tag is hard-coded by `update-brain`, not configured here.

## Steps

**Front-load everything that needs a human, then run hands-off.** Steps 1–2b are the **attended prelude** — every key, OAuth consent, and stack question the user must supply happens here, up front. Everything after the **"✋ needs-you done"** boundary (steps 3–8: assets, schema, crawl, backlog, cadence) runs **unattended**, so the user can walk away once the prelude clears. Nothing downstream may introduce a fresh human prompt — anything requiring the user must be pulled forward into the prelude.

### 1 · Preflight & config
Load `.claude/proactive-jupi.local.json` (create from the bundled template + collect missing keys). Confirm the three accounts exist. Stop with a clear checklist if anything's missing.
- **Validate the Neon `neonConnString` the moment it's collected, and prove the egress path end-to-end** — run a cheap `SELECT 1` over it (HTTPS serverless driver, the exact path step 5 will use). This single probe front-loads **both** human-gated risks step 5 would otherwise hit mid-run:
  - **Bad credential** — a wrong, expired, or wrong-project string fails here, while the user is present. Re-collect and re-probe until it succeeds.
  - **Blocked egress** — if the `SELECT 1` is refused (403/timeout on Neon's host), walk step 5's full fallback chain *now*: retry with the sandbox network disabled; if sandbox-disabling is itself disallowed, tell the user to allowlist **`*.neon.tech`** (Admin settings → Capabilities → network access) and re-probe until it clears.
  Only a string that **both** authenticates **and** completes the round-trip crosses into the unattended phase — so step 5 is guaranteed promptless.

### 2 · Take inventory of what's already connected — *before* asking for anything
**Never push a redundant OAuth/connect flow for a tool the user already has.** But note a hard limit: **the session can only see tools whose MCP is loaded here — it usually CANNOT read the user's claude.ai / Cowork "Customize" connectors** (`list_connectors` comes back empty from inside the session; an empty result means "can't see," NOT "nothing installed"). So there are **three** states, not two — handle each differently:
  1. **Callable in this session** (its `mcp__…` tools resolve, a probe succeeds) → **connected.** Use it, tick it off, say so ("Gmail and Linear are live — I'll use those"). Never re-ask.
  2. **Not callable here, but the user may have it in Customize** → **ambiguous, do NOT force OAuth.** Tell the user plainly: *"I don't see GitHub active in this session. If you've already added it under Customize, just enable it for this workspace and I'll pick it up; otherwise here's how to connect it."* Reconcile with one toggle before ever proposing a full re-auth.
  3. **Nowhere** → genuine connect flow (guide OAuth / add the server).
- **Probe, don't assume.** Determine state by whether the tool's calls actually resolve — not by a `.mcp.json` entry (that only wires *local* Claude Code) and not by `list_connectors` (unreliable/empty here).
- **Jupi is the blocking gate — probe it first.** Jupi is Proactive-Jupi's *only* interface; nothing downstream works without it. Probe with a cheap read-only call (e.g. `search-decisions-tool`, 1 result). If it fails, **STOP** — give the user the exact connect steps, then **re-probe in a loop; do not proceed to the rest of setup until Jupi answers.** (Every other tool is optional and non-blocking — only Jupi hard-stops.)
- **Resolve the tenant identity here — Jupi is the reference for the userId.** Once Jupi answers, capture the **authenticated caller's Jupi user id** (the same principal Jupi assigns as a decision's default `ownerId`) and cache it as **`jupiUserId`** in `.claude/proactive-jupi.local.json`. This one id is the single identity across all three stores: it is the Neon `user_id` on every row **and** the brain's Supermemory container tag `user_<jupiUserId>` — never a second source (do not derive identity from Supermemory's `whoAmI`). Resolve once; the routines read it from config.
- **Then the rest of the required core:** **Supermemory** (the brain). Probe with a cheap read; if missing, guide the connect.
  - **Supermemory** — **use the installed MCP connector by default.** If it's already connected, use it directly and do **not** ask about, or request, an API key. Only if it is *not* connected, instruct the user to add it as a custom MCP server (`https://mcp.supermemory.ai/mcp`, header `Authorization: Bearer sm_<key>`, key from app.supermemory.ai). Prefer installation over API keys.
  - **Neon** — **project-scoped connection string via a driver, NOT the account-wide MCP** (see step 5).

### 2b · Discover the user's stack — don't assume it
**Make no assumption about which tools the user works in.** Do not present a hardcoded list (no fixed "Gmail/Calendar/Drive/Linear/GitHub/Slack" menu).
- Ask the essentials in **one** message (not three round-trips): **main communication tool** (e.g. Gmail / Outlook / Slack / Teams — where their work conversations actually happen), **calendar**, and **file/doc storage** (Drive / Notion / Dropbox…). Give the one-line payoff for each so they answer all three at once ("I triage what comes in — only what needs you surfaces").
- Then the work-specific tools: ask **"what's your job, and which tools do you live in day to day?"** and connect the ones they actually name (PM/eng → Linear/Jira/GitHub; sales → CRM; design → Figma; support → helpdesk). Skip what they don't use.
- **For each tool the user confirms:** run a lightweight probe → if missing, pause and tell them exactly what to authorize → re-probe until it responds. Record each in `.proactive-jupi/assets.md` (created from `reference/assets.template.md`) with its **action surface**, ticking `Connected`. Nothing here except Jupi blocks setup, but every skipped tool is value left on the table — so name the work that disappears once each is on.

> **✋ needs-you done — the rest runs unattended.** Tell the user plainly: everything requiring their input (config keys, OAuth consents, tool choices, and the Neon credential + egress proven in step 1) is now complete; the remaining steps run on their own and they can step away. No downstream step may introduce a fresh human prompt — if anything environment-specific is still foreseeable, it should have been pulled into the prelude above.

### 3 · Discover assets → `.proactive-jupi/assets.md`
Read the files of the **current project or workspace** to inventory what's already here — scan the **working tree** (the project/repo root if in a project, or the Cowork workspace if in one), **not** the wider computer. Look for: existing **agents/skills** (e.g. `.claude/skills/`, `.claude/agents/`, project plugins), **tool config** (`.mcp.json`, settings), and any **documented rules/playbooks** (READMEs, docs, playbook files). Register discovered agents for reuse (reuse, not lifecycle); record findings in `.proactive-jupi/assets.md`. **At Jupi today there are no business rules → record "none", skip rule-discovery.** At a partner, crawl their docs.

### 4 · Pre-authorize for unattended runs
The routines run **unattended** (no human to click "Allow"), so an unconfigured permission prompt would hang them — and the **very next steps (schema apply, backlog writes) are the first that can prompt**, so pre-authorize *before* them. It only needs the real MCP ids, which are known once step 2's connections resolve. Prepare the workspace now, even though the routines themselves land in later phases:
- **Detect the current mode first.** If this machine already runs a global bypass / `dontAsk` mode, say so and skip — nothing to write.
- Otherwise write/merge `<workspace>/.claude/settings.json`: `permissions.defaultMode: "dontAsk"` (auto-allow the allowlist, refuse the rest — safer than full bypass) and `permissions.allow` = the **real** MCP server ids resolved from the live connections (**never** hardcode placeholder UUIDs — they differ per machine) + `Bash(gh:*)`, `Bash(git:*)`, `Read`, `Write`, `Edit`, and the **Neon schema-apply command** (e.g. `Bash(psql:*)`) so step 5's egress fallback runs without a prompt.
- **Idempotent merge** — union the allow list; never clobber other keys.

### 5 · Apply the Neon schema
Run the bundled `../../shared/schema.sql` (the plugin's DB contract) against the project over the **project-scoped `neonConnString`** — **not** the account-wide Neon MCP, whose OAuth spans every project on the account and would expose any production project. The connection string is scoped to one project: a hard isolation boundary. Idempotent — safe to re-run. Creates `tasks` + `actions` + `crawl_state` (no separate registry — the decision + its lifecycle live in Jupi). The string was already reachability-checked in step 1, so this runs unattended — any failure here is environment (network egress), not a bad credential.
- **Prefer the HTTPS serverless driver** (`@neondatabase/serverless`, port 443) over direct Postgres (`psql`, port 5432): 443 is the sandbox-friendly path and the easiest host to allowlist.
- **Stamp the tenant key `user_id` = the `jupiUserId` resolved in step 2** (Jupi is the reference — the same id behind the brain's container tag `user_<jupiUserId>`). Every row in all three tables carries it, and every query the skills issue filters by it — the project-scoped conn string is a *physical* boundary; `user_id` is the *row-level* one that lets a shared DB (the "matches Jupi's own Postgres, scale with no migration" path) separate users. Bind it as a parameter — never string-interpolate.
- **Egress is already proven in step 1** — the same host/port/driver completed a `SELECT 1` during the attended prelude, and any sandbox-disable or `*.neon.tech` allowlist it required is already in place. So this apply inherits a working path and runs **promptless** (step 4 also pre-authorized the command). If egress nonetheless fails here, apply the same fallback — retry with the sandbox network disabled — but treat a *new* block as a regression to flag, not a fresh user prompt: the prelude was supposed to have settled it.

### 6 · Seed the brain — run `update-brain`
**Invoke the `update-brain` skill in `full` mode** (it reads `seedTools` + `crawlWindowDays` from config — default Gmail + Calendar + Linear, last 30 days). It is the **only writer of Facts** and owns how they're stored in Supermemory — **including the hard-coded container tag; setup neither chooses nor asks for it.**
- When it returns, **verify it actually wrote Facts** — a quick `recall` on the container tag should return results — and fold its seed summary (facts by type, any unreachable tool) into the setup report.
- If it wrote nothing, or a tool was unreachable, **say so (⚠️)** rather than reporting success.

### 7 · Initialize the backlog — run `refresh-backlog`
**Invoke the `refresh-backlog` skill** (it reads `seedTools`, `crawlWindowDays`, `backlogWindowSize` from config). It parses recent signals into `tasks` and scores them (impact · relevance · urgency · bottleneck), writing via the shared `db.mjs` — which stamps `user_id` = the step-2 tenant key on every row and scopes every query by it. Read-only on the tools — no external side-effects.
- When it returns, fold its summary into the setup report: sources scanned, candidate tasks created, the current top window. If a source was unreachable, **say so (⚠️)**.
- It shares the `crawl_state` table with `update-brain`, separated by the `consumer` column (`backlog` vs `brain`), so the two don't interfere.

### 8 · Set cadence / triggers, then prove the loop
Schedule recurring **user-visible** routines: `update-brain` (daily full) and `act-and-decide` (frequent — its Stage 0 refreshes the backlog itself). They must be controllable by the user (create them where the user can see and edit them — a hidden scheduler is not acceptable); tie to one recurring ritual and record the cadence.
- **Prove the loop end-to-end:** fire **one first `act-and-decide` run in `--dry-run`** at the end of setup. Dry-run writes nothing (no rows, no decisions, no external side-effect on first contact) and returns the classification table — so onboarding shows the user exactly what Jupi *would* act on and decide, before anything happens. They flip `guardrails.mode` toward `perform` when trust builds.
- *All four skills now exist (`update-brain`, `refresh-backlog`, `act-and-decide`, `execute-actions`), so schedule for real. The **closing loop** (executing settled decisions) is a later phase — a decision posted now is settled by the user but not yet auto-executed; that's expected.*

## Output — setup report
Print a **per-step status line** (✅/🔧/⚠️) so the run is legible end-to-end: which tools were **already connected** vs newly connected vs skipped (+ the capability lost by each skip), any pending OAuth, schema applied, Facts seeded (counts by type), candidate tasks created, schedules set. Flag anything that needs the user.

## Guardrails
- **Inventory before you ask, but know the blind spot.** A tool is "connected" iff its calls actually resolve in this session; the session usually can't read "Customize" connectors (`list_connectors` is empty here). For a tool that isn't callable, ask the user to *enable it in Customize* before ever proposing a full OAuth — never push a redundant re-auth on a tool they already have.
- **Discover the stack, don't hardcode it.** No fixed tool menu — ask the user's job and the tools they name; connect those.
- **Narrate progress** — every step opens with what it's doing and closes with ✅/🔧/⚠️. The user should never be left guessing which step is running.
- **Prefer an installed MCP connector over API-key config** for any service (e.g., Supermemory) — never ask connector-vs-key when a connector is already present.
- **Never** enter credentials or complete OAuth on the user's behalf — instruct them precisely.
- **Asset discovery stays within the current project/workspace tree** — read the working directory's files only; never scan the wider filesystem or unrelated personal files.
- **No external side-effects during setup** — setup only reads, connects, and writes local/DB scaffolding; it never sends, posts, or messages anyone.
- `.claude/proactive-jupi.local.json` is **gitignored** — never commit it or echo secrets.
