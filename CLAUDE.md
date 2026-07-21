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
- **Facts → Supermemory.** Only `update-context` writes them.
- **Backlog + actions → Neon** (`db/schema.sql`); each action carries `decision_id`/`option_id` (no separate registry).
- **Asset Map → `assets.md`** (hand-editable; read in full).
- **Decisions + lifecycle (`STARTED → FINALIZED → EXECUTED`) → Jupi.**

## Golden rules
- `act-or-decide` **reads** Facts, never writes them (delegates to `update-context`).
- **Noise control = confidence × risk gate, not volume caps.** Draft = low risk → act. External send / sensitive recipient (peer < manager < CEO < external) = high risk → decide.
- **Value-based task selection lives INSIDE act-or-decide** (the coordination-node pass). Only the cheap Scorer is upstream.
- **Closing loop:** the execution trace on the signal *is* the notification; plus at most one optional EXECUTED ping (email/Slack/none).
- **Guardrails:** default conservative (draft-only) until trust builds. No external side-effect until a decision is settled and runs through the closing loop.

## Practice
Log build/design decisions to **Jupi** as finalized records as they're made.
