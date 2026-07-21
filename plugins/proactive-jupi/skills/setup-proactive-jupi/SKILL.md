---
name: setup-proactive-jupi
description: Cold-start (set up) an Auto-Jupi workspace — connect to Jupi/Neon/Supermemory and the tool MCPs, discover assets, apply the Neon schema, seed the brain with a fresh 1-month crawl of the core tools, initialize the backlog, and set cadence + guardrails. Run once per workspace (re-runnable to refresh). Portable — assumes nothing is pre-connected.
disable-model-invocation: true
---

# Setup — cold-start an Auto-Jupi workspace

Takes a workspace from zero to **ready to run act-and-decide**. Run once; re-runnable to refresh. Portable: assumes nothing is pre-connected. (Design rationale: the Auto-Jupi implementation plan, §7.)

## Posture — narrate every step, sell the payoff (not IT config)
Auto-Jupi exists to **do the user's work and learn how they operate** — frame each step as work being lifted off their plate, never as configuration. **Show your progress:** open each step by saying what you're about to do, and close it with a one-line status — **✅ already OK / 🔧 fixed / ⚠️ needs you**. The user should never wonder what the skill is doing or which step it's on.

## Before you start — user-side (I cannot do these)
The user creates the **accounts** out of band and has these on hand:
- **Jupi** workspace slug
- **Neon** project + connection string (project-scoped — see step 4)
- **Supermemory** account, added as an MCP **connector** (preferred over an API key)

I connect to them and to the tool MCPs, but **the user must complete any OAuth consent** when prompted. I never enter credentials or complete OAuth myself (prohibited by design).

## Config — the workspace's `.claude/setup.local.json` (gitignored)
Read it; if missing, copy from the bundled `reference/setup.local.json.template` into the workspace `.claude/setup.local.json`, then ask the user for any empty key and offer to save. Keys: `jupiWorkspace`, `neonProjectId`, `neonConnString`, `seedTools` (default `["gmail","calendar","linear"]`), `crawlWindowDays` (default `30`). **Never commit this file.** Supermemory needs **no** key here — it uses the installed connector; its container tag is hard-coded by `update-context`, not configured here.

## Steps

### 1 · Preflight & config
Load `.claude/setup.local.json` (create from the bundled template + collect missing keys). Confirm the three accounts exist. Stop with a clear checklist if anything's missing.

### 2 · Take inventory of what's already connected — *before* asking for anything
**Never push a redundant OAuth/connect flow for a tool the user already has.** But note a hard limit: **the session can only see tools whose MCP is loaded here — it usually CANNOT read the user's claude.ai / Cowork "Customize" connectors** (`list_connectors` comes back empty from inside the session; an empty result means "can't see," NOT "nothing installed"). So there are **three** states, not two — handle each differently:
  1. **Callable in this session** (its `mcp__…` tools resolve, a probe succeeds) → **connected.** Use it, tick it off, say so ("Gmail and Linear are live — I'll use those"). Never re-ask.
  2. **Not callable here, but the user may have it in Customize** → **ambiguous, do NOT force OAuth.** Tell the user plainly: *"I don't see GitHub active in this session. If you've already added it under Customize, just enable it for this workspace and I'll pick it up; otherwise here's how to connect it."* Reconcile with one toggle before ever proposing a full re-auth.
  3. **Nowhere** → genuine connect flow (guide OAuth / add the server).
- **Probe, don't assume.** Determine state by whether the tool's calls actually resolve — not by a `.mcp.json` entry (that only wires *local* Claude Code) and not by `list_connectors` (unreliable/empty here).
- **Jupi is the blocking gate — probe it first.** Jupi is Auto-Jupi's *only* interface; nothing downstream works without it. Probe with a cheap read-only call (e.g. `search-decisions-tool`, 1 result). If it fails, **STOP** — give the user the exact connect steps, then **re-probe in a loop; do not proceed to the rest of setup until Jupi answers.** (Every other tool is optional and non-blocking — only Jupi hard-stops.)
- **Then the rest of the required core:** **Supermemory** (the brain). Probe with a cheap read; if missing, guide the connect.
  - **Supermemory** — **use the installed MCP connector by default.** If it's already connected, use it directly and do **not** ask about, or request, an API key. Only if it is *not* connected, instruct the user to add it as a custom MCP server (`https://mcp.supermemory.ai/mcp`, header `Authorization: Bearer sm_<key>`, key from app.supermemory.ai). Prefer installation over API keys.
  - **Neon** — **project-scoped connection string via a driver, NOT the account-wide MCP** (see step 4).

### 2b · Discover the user's stack — don't assume it
**Make no assumption about which tools the user works in.** Do not present a hardcoded list (no fixed "Gmail/Calendar/Drive/Linear/GitHub/Slack" menu).
- Start from the essentials, asking one at a time: **main communication tool?** (e.g. Gmail / Outlook / Slack / Teams — where their work conversations actually happen), **calendar**, **file/doc storage** (Drive / Notion / Dropbox…). For each, sell the payoff ("I triage what comes in — only what needs you surfaces").
- Then the work-specific tools: ask **"what's your job, and which tools do you live in day to day?"** and connect the ones they actually name (PM/eng → Linear/Jira/GitHub; sales → CRM; design → Figma; support → helpdesk). Skip what they don't use.
- **For each tool the user confirms:** run a lightweight probe → if missing, pause and tell them exactly what to authorize → re-probe until it responds. Record each in `assets.md` (created from `reference/assets.template.md`) with its **action surface + risk default**, ticking `Connected`. Nothing here except Jupi blocks setup, but every skipped tool is value left on the table — so name the work that disappears once each is on.

### 3 · Discover assets → `assets.md`
Read the files of the **current project or workspace** to inventory what's already here — scan the **working tree** (the project/repo root if in a project, or the Cowork workspace if in one), **not** the wider computer. Look for: existing **agents/skills** (e.g. `.claude/skills/`, `.claude/agents/`, project plugins), **tool config** (`.mcp.json`, settings), and any **documented rules/playbooks** (READMEs, docs, playbook files). Register discovered agents for reuse (reuse, not lifecycle); record findings in `assets.md`. **At Jupi today there are no business rules → record "none", skip rule-discovery.** At a partner, crawl their docs.

### 4 · Apply the Neon schema
Run the bundled `reference/schema.sql` against the project using a driver (`psql` or `@neondatabase/serverless` / `pg`) over the **project-scoped `neonConnString`** — **not** the account-wide Neon MCP, whose OAuth spans every project on the account and would expose any production project. The connection string is scoped to one project: a hard isolation boundary. Idempotent — safe to re-run. Creates `tasks` + `actions` (no separate registry — the decision + its lifecycle live in Jupi).

### 5 · Seed the brain — hand off to `update-context`
Hand off to the **`update-context`** skill (`full` mode, last `crawlWindowDays` across `seedTools` = Gmail + Calendar + Linear). It is the **only writer of Facts** and owns how they're stored in Supermemory — **including the hard-coded container tag; setup neither chooses nor asks for it.**
- *`update-context` is a separate build. Until it exists, setup stops cleanly after step 4 (schema applied).*

### 6 · Initialize the backlog
Parse recent signals (within the crawl window) into **candidate tasks**; score them (impact × confidence). Insert into Neon `tasks` (status `candidate`).

### 7 · Pre-authorize for unattended runs
The routines run **unattended** (no human to click "Allow"), so an unconfigured permission prompt would hang them. Prepare the workspace now, even though the routines themselves land in later phases:
- **Detect the current mode first.** If this machine already runs a global bypass / `dontAsk` mode, say so and skip — nothing to write.
- Otherwise write/merge `<workspace>/.claude/settings.json`: `permissions.defaultMode: "dontAsk"` (auto-allow the allowlist, refuse the rest — safer than full bypass) and `permissions.allow` = the **real** MCP server ids resolved from the live connections (**never** hardcode placeholder UUIDs — they differ per machine) + `Bash(gh:*)`, `Bash(git:*)`, `Read`, `Write`, `Edit`.
- **Idempotent merge** — union the allow list; never clobber other keys.

### 8 · Set cadence / triggers
Schedule recurring **user-visible** routines: `update-context` (daily full) and `act-and-decide` (frequent). They must be controllable by the user (create them where the user can see and edit them — a hidden scheduler is not acceptable); tie to one recurring ritual and record the cadence.
- *`update-context` and `act-and-decide` are later-phase builds. Until they exist, describe the intended schedule and stop — do not schedule a routine that points at a skill that isn't there, and do not fire a first `act-and-decide` run yet.*

### 9 · Set guardrails
Write the initial **confidence × risk policy** — default **conservative (draft-only)**: which action classes may auto-act vs. always-decide. Risk keys on **internal vs external** destination, refined by recipient sensitivity (peer < manager < CEO < external). Persist in `assets.md` risk defaults.

## Output — setup report
Print a **per-step status line** (✅/🔧/⚠️) so the run is legible end-to-end: which tools were **already connected** vs newly connected vs skipped (+ the capability lost by each skip), any pending OAuth, schema applied, Facts seeded (counts by type), candidate tasks created, schedules set, guardrail policy. Flag anything that needs the user.

## Guardrails
- **Inventory before you ask, but know the blind spot.** A tool is "connected" iff its calls actually resolve in this session; the session usually can't read "Customize" connectors (`list_connectors` is empty here). For a tool that isn't callable, ask the user to *enable it in Customize* before ever proposing a full OAuth — never push a redundant re-auth on a tool they already have.
- **Discover the stack, don't hardcode it.** No fixed tool menu — ask the user's job and the tools they name; connect those.
- **Narrate progress** — every step opens with what it's doing and closes with ✅/🔧/⚠️. The user should never be left guessing which step is running.
- **Prefer an installed MCP connector over API-key config** for any service (e.g., Supermemory) — never ask connector-vs-key when a connector is already present.
- **Never** enter credentials or complete OAuth on the user's behalf — instruct them precisely.
- **Asset discovery stays within the current project/workspace tree** — read the working directory's files only; never scan the wider filesystem or unrelated personal files.
- **Default conservative** (draft-only) until trust builds; no external side-effects during setup.
- `.claude/setup.local.json` is **gitignored** — never commit it or echo secrets.
