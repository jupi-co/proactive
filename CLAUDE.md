# Working in `proactive/`

Conventions for any Claude session operating this workspace. Full rationale in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md).

## The model — don't conflate these
- **Signal** = ephemeral trigger (email, meeting, Slack ping, issue, PR, doc). Never persisted.
- **Task** = the *input*, one unit of the backlog.
- **Action** = a *unit of execution*. **One task can fan out into several parallel actions.**
- **Decision** = a Jupi trade-off, raised only when act-or-decide can't safely act.
- **Rule** = a resolved rule-decision (*when X, always Y*), approved by an owner.
- **Fact** = knowledge about people/orgs/projects, in Supermemory.

## State homes (authoritative)
Setup runs **inside the user's existing repo**, so everything Proactive-Jupi owns is namespaced under a single **`proactive-jupi/`** data folder at the workspace root — it must not scatter files across the user's tree. Only harness-owned config stays in `.claude/` (`settings.json` *must* live there; `setup.local.json` by convention).
- **Facts → Supermemory.** Only `update-brain` writes them.
- **Backlog + actions → Neon** (`db/schema.sql`); each action carries `decision_id`/`option_id` (no separate registry).
- **Asset Map → `proactive-jupi/assets.md`** (hand-editable; read in full).
- **Decisions + lifecycle (`STARTED → FINALIZED → EXECUTED`) → Jupi.**

## Golden rules
- **Prefer an installed MCP connector over API-key config** for any service; never ask connector-vs-key when a connector is already present. A skill must not prompt for a concern another skill owns (e.g. the Supermemory container tag belongs to `update-brain`, hard-coded — not asked in setup).
- `act-or-decide` **reads** Facts, never writes them (delegates to `update-brain`).
- **Noise control = confidence × risk gate, not volume caps.** Draft = low risk → act. External send / sensitive recipient (peer < manager < CEO < external) = high risk → decide.
- **Value-based task selection lives INSIDE act-or-decide** (the coordination-node pass). Only the cheap Scorer is upstream.
- **Closing loop:** the execution trace on the signal *is* the notification; plus at most one optional EXECUTED ping (email/Slack/none).
- **Guardrails:** default conservative (draft-only) until trust builds. No external side-effect until a decision is settled and runs through the closing loop.

## Setup-skill parity
`setup-proactive-jupi` re-implements Nick's proven `jupi:setup` (`../jupi-skills-beta/plugins/jupi/skills/setup/SKILL.md`). When editing it, diff against that reference so nothing regresses silently. Capabilities to preserve: **Jupi is the blocking gate** (probe → loop until it answers, never continue without it) · **discover the user's stack** (ask their role/tools — never a hardcoded menu) · **inventory before asking** (a tool is connected iff its calls resolve here; the session can't read "Customize" connectors, so ask to enable-in-Customize before any redundant OAuth) · **pre-authorize for unattended runs** (`dontAsk` settings.json) · **user-visible scheduled routines** · **narrate per-step progress** (✅/🔧/⚠️) · **front-load everything human-gated** (all config keys, OAuth consents, stack questions, *and* the Neon credential+egress probe complete in an attended prelude behind a `✋ needs-you done` boundary; steps after it run unattended and must never introduce a fresh prompt). *Phase-gated (see IMPLEMENTATION-PLAN §11): actually scheduling the routines and firing a first `act-and-decide` wait on those skills existing.*

## Practice
Log build/design decisions to **Jupi** as finalized records as they're made.
