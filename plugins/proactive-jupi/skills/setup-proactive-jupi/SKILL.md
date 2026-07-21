---
name: setup-proactive-jupi
description: Cold-start (set up) an Auto-Jupi workspace — connect to Jupi/Neon/Supermemory and the tool MCPs, discover assets, apply the Neon schema, seed the brain with a fresh 1-month crawl of the core tools, initialize the backlog, and set cadence + guardrails. Run once per workspace (re-runnable to refresh). Portable — assumes nothing is pre-connected.
disable-model-invocation: true
---

# Setup — cold-start an Auto-Jupi workspace

Takes a workspace from zero to **ready to run act-and-decide**. Run once; re-runnable to refresh. Portable: assumes nothing is pre-connected. (Design rationale: the Auto-Jupi implementation plan, §7.)

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

### 2 · Connect & probe MCPs → write `assets.md`
Ensure these MCP servers are connected (add the server entry if absent, then verify): **Supermemory**, **Jupi**, and the tool MCPs (**Gmail, Calendar, Drive, Linear, GitHub, Slack**).
- For each, run a **lightweight probe** (a cheap read/list) to confirm it responds.
- If a tool needs OAuth, **pause and tell the user exactly what to authorize**, then continue once done.
- Create the workspace `assets.md` from the bundled `reference/assets.template.md`, and record each tool's **action surface + risk default**, ticking `Connected`.
- Access paths (neither is in the connector registry):
  - **Supermemory** — **use the installed MCP connector by default.** If it's already connected, use it directly and do **not** ask about, or request, an API key. Only if it is *not* connected, instruct the user to add it as a custom MCP server (`https://mcp.supermemory.ai/mcp`, header `Authorization: Bearer sm_<key>`, key from app.supermemory.ai). Prefer installation over API keys.
  - **Neon** — **project-scoped connection string via a driver, NOT the account-wide MCP** (see step 4).

### 3 · Discover assets → `assets.md`
Inventory existing **agents/skills** and any **documented rules/playbooks**; register agents for reuse (reuse, not lifecycle). **At Jupi today there are no business rules → record "none", skip rule-discovery.** At a partner, crawl their docs.

### 4 · Apply the Neon schema
Run the bundled `reference/schema.sql` against the project using a driver (`psql` or `@neondatabase/serverless` / `pg`) over the **project-scoped `neonConnString`** — **not** the account-wide Neon MCP, whose OAuth spans every project on the account and would expose any production project. The connection string is scoped to one project: a hard isolation boundary. Idempotent — safe to re-run. Creates `tasks` + `actions` (no separate registry — the decision + its lifecycle live in Jupi).

### 5 · Seed the brain — hand off to `update-context`
Hand off to the **`update-context`** skill (`full` mode, last `crawlWindowDays` across `seedTools` = Gmail + Calendar + Linear). It is the **only writer of Facts** and owns how they're stored in Supermemory — **including the hard-coded container tag; setup neither chooses nor asks for it.**
- *`update-context` is a separate build. Until it exists, setup stops cleanly after step 4 (schema applied).*

### 6 · Initialize the backlog
Parse recent signals (within the crawl window) into **candidate tasks**; score them (impact × confidence). Insert into Neon `tasks` (status `candidate`).

### 7 · Set cadence / triggers
Schedule recurring runs: `update-context` (periodic full) and `act-and-decide` (frequent). Tie to one recurring ritual; record the cadence.

### 8 · Set guardrails
Write the initial **confidence × risk policy** — default **conservative (draft-only)**: which action classes may auto-act vs. always-decide. Risk keys on **internal vs external** destination, refined by recipient sensitivity (peer < manager < CEO < external). Persist in `assets.md` risk defaults.

## Output — setup report
Print: which MCPs connected (and any pending OAuth), schema applied, Facts seeded (counts by type), candidate tasks created, schedules set, guardrail policy. Flag anything that needs the user.

## Guardrails
- **Prefer an installed MCP connector over API-key config** for any service (e.g., Supermemory) — never ask connector-vs-key when a connector is already present.
- **Never** enter credentials or complete OAuth on the user's behalf — instruct them precisely.
- **Default conservative** (draft-only) until trust builds; no external side-effects during setup.
- `.claude/setup.local.json` is **gitignored** — never commit it or echo secrets.
