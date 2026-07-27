# Proactive-Jupi — `proactive/`

Workspace + skills for the Proactive-Jupi proactive engine (dogfood build). Full design in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md).

## What it does
`Signals → scored Tasks (backlog) → act-or-decide → Actions / Decisions → execute (closing loop)`.
The human is bothered **only for genuine trade-offs** (the confidence × risk gate). Everything confident-and-safe just happens.

## Config — two files, two jobs

Both are gitignored; each has a committed template. **Neither ever names a tool** — which tool plays which role lives in `.proactive-jupi/assets.md` (the roles table: `inbox`, `context`, `work`, `decision`, `rules`, `brain`).

| File | Holds | Template | Who reads it |
|---|---|---|---|
| `.proactive-jupi/config.local.json` | Per-workspace **ids/secrets** to reach a store (`jupiUserId`, `neonConnString`, `rulesStoreRef`, …) + **settings/thresholds** (`crawlWindowDays`, `ruleThreshold`, `guardrails`, …) | `plugins/proactive-jupi/skills/setup-proactive-jupi/reference/config.local.json.template` — setup copies it in and collects missing keys | The skills, at runtime |
| `.env` (repo root) | **Dev-tooling secrets for this repo only** (`SUPERMEMORY_API_KEY`) | [`.env.example`](.env.example) — `cp .env.example .env` | Repo scripts you run by hand (`evals/*/purge-scratch.sh`, ad-hoc HTTP-API ops) |

The Supermemory key is deliberately **not** in `config.local.json`: that file is mirrored into unattended/cloud run CWDs, so an admin-scoped key would travel with every scheduled routine. The runtime never needs it — the skills reach Supermemory through the installed MCP connector.

## Where state lives
| Store | Home |
|---|---|
| Facts & relationships | **Supermemory** |
| Asset Map (roles: which tool to use, when) | **`.proactive-jupi/assets.md`** |
| Task backlog + actions | **Neon Postgres** (schema: `plugins/proactive-jupi/skills/setup-proactive-jupi/reference/schema.sql`) — every row keyed by `user_id` = the **Jupi user id** (same identity as the brain's container tag) |
| Decisions + lifecycle (incl. EXECUTED) | **Jupi** |

## Skills (in the plugin)
- **`plugins/proactive-jupi/skills/setup-proactive-jupi`** — cold-start a workspace (connect tools, discover assets, apply the Neon schema, seed the brain, init backlog, cadence + guardrails). **Built.** Invoke with `/setup-proactive-jupi` once the plugin is installed.
- **`plugins/proactive-jupi/skills/update-brain`** — the brain crawler: reads tools (read-only), writes Facts to Supermemory via the connector, incremental via the Neon `crawl_state` cursor. **Built.** Modes: `full` / `targeted`.
- `plugins/proactive-jupi/skills/act-or-decide` — the automation pipeline. *(next)*

## Plugin (local Cowork testing)
`proactive/` is packaged as a Claude plugin (marketplace `proactive-jupi`, plugin `proactive-jupi`), following jupi-skills.
- **Build:** `bash scripts/package-plugin.sh` → `dist/proactive-jupi.zip` (gitignored).
- **Validate:** `bash scripts/validate-plugin.sh` (fails on an invalid manifest or `<…>` tags in a skill description — Cowork rejects those).
- **Auto-build on commit:** `bash scripts/install-hooks.sh` once; the `post-commit` hook then validates + rebuilds `dist/*.zip`.
- **Test in Cowork:** Claude Desktop → Cowork → Customize → Plugins → Personal → **+** next to "Local uploads" → select `dist/proactive-jupi.zip` (keep the `.zip` extension).

## Status
Phase 0. `setup-proactive-jupi` + `update-brain` skills built + packaged (`dist/proactive-jupi.zip`); Neon schema (`tasks`, `actions`, `crawl_state`) applied to project `sparkling-violet-42081696`; Supermemory connected (connector-simple). **Next:** the `act-or-decide` engine.
