# Proactive-Jupi — `proactive/`

Workspace + skills for the Proactive-Jupi proactive engine (dogfood build). Full design in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md).

## What it does
`Signals → scored Tasks (backlog) → act-or-decide → Actions / Decisions → execute (closing loop)`.
The human is bothered **only for genuine trade-offs** (the confidence × risk gate). Everything confident-and-safe just happens.

## Where state lives
| Store | Home |
|---|---|
| Facts & relationships | **Supermemory** |
| Asset Map (capability inventory) | **`proactive-jupi/assets.md`** |
| Task backlog + actions | **Neon Postgres** (schema: `plugins/proactive-jupi/skills/setup-proactive-jupi/reference/schema.sql`) — every row keyed by `user_id` = the **Jupi user id** (same identity as the brain's container tag) |
| Decisions + lifecycle (incl. EXECUTED) | **Jupi** |

## Skills (in the plugin)
- **`plugins/proactive-jupi/skills/setup-proactive-jupi`** — cold-start a workspace (connect tools, discover assets, apply the Neon schema, seed the brain, init backlog, cadence + guardrails). **Built.** Invoke with `/setup-proactive-jupi` once the plugin is installed.
- **`plugins/proactive-jupi/skills/update-brain`** — the brain crawler: reads tools (read-only), writes Facts to Supermemory via the connector, incremental via the Neon `crawl_state` cursor. **Built.** Modes: `full` / `targeted`.
- `plugins/proactive-jupi/skills/act-and-decide` — the automation pipeline. *(next)*

## Plugin (local Cowork testing)
`proactive/` is packaged as a Claude plugin (marketplace `proactive-jupi`, plugin `proactive-jupi`), following jupi-skills.
- **Build:** `bash scripts/package-plugin.sh` → `dist/proactive-jupi.zip` (gitignored).
- **Validate:** `bash scripts/validate-plugin.sh` (fails on an invalid manifest or `<…>` tags in a skill description — Cowork rejects those).
- **Auto-build on commit:** `bash scripts/install-hooks.sh` once; the `post-commit` hook then validates + rebuilds `dist/*.zip`.
- **Test in Cowork:** Claude Desktop → Cowork → Customize → Plugins → Personal → **+** next to "Local uploads" → select `dist/proactive-jupi.zip` (keep the `.zip` extension).

## Status
Phase 0. `setup-proactive-jupi` + `update-brain` skills built + packaged (`dist/proactive-jupi.zip`); Neon schema (`tasks`, `actions`, `crawl_state`) applied to project `sparkling-violet-42081696`; Supermemory connected (connector-simple). **Next:** the `act-and-decide` engine.
