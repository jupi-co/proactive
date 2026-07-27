# Asset Map

The system's own capability inventory. **Read in full** by act-or-decide; **hand-editable**. Written/updated by the `setup` skill (steps 2–3). Not in Supermemory.

## Tools — roles (when to use what)
**This table is the routing map: it tells every skill which tool to reach for, and when.** Setup regenerates it from what it actually probes (step 2b — no hardcoded menu): one row per tool the user names and that resolves in the session, `Connected` ticked after a successful probe. Rows below are **illustrative** — drop what the user doesn't use, add what they do.

**A tool can carry several roles.** Tag every role it genuinely plays; don't force it into one.

| Role | Means | Who reads this role |
|---|---|---|
| `inbox` | Parse tasks from it — things landing that need the user | `refresh-backlog` sweeps these into the backlog |
| `context` | Read to feed the brain, or to research an entity the brain doesn't know yet | `update-brain` crawls these; `act-or-decide` Stage 3 researches in them |
| `work` | Where the user does their actual job — so where Jupi does it too | `execute-action` writes here (draft, send, comment, book) |
| `decision` | The decision store | `act-or-decide` posts, `act-post-decision` reads settled ones |
| `rules` | The business-rule store | Stage 3 reads to pre-empt; a settled `[BR]` action writes |
| `brain` | The Facts store | `update-brain` is its only writer; everyone else recalls |

**`decision`, `rules` and `brain` are singular — exactly one tool each.** More than one means an ambiguous target and a split store (a second `brain` is how Facts get written under two container tags). Setup must fail loudly rather than tag a second. The other three roles are free to span many tools.

| Tool | Connected | Roles | When to use it |
|---|---|---|---|
| Gmail | ☐ | inbox, context, work | Triage what lands; read threads for context; draft/send replies |
| Google Calendar | ☐ | inbox, context | Meetings that need prep; who-met-whom for the brain |
| Google Drive | ☐ | context, work | Read the doc behind a decision; comment / create docs |
| Linear | ☐ | inbox, context, work | Assigned issues; project/owner context; comment + create issues |
| GitHub | ☐ | inbox, context, work | Review requests; code/PR context; comment, open PRs |
| Slack | ☐ | inbox, context, work | Mentions + DMs; conversation context; reply in thread |
| Jupi | ☐ | decision | The one decision store — search / create / finalize |
| Supermemory | ☐ | brain | The one Facts store — `update-brain` writes, others recall |
| _(rule store)_ | ☐ | rules | The one business-rule store — whichever tool the user named in step 2b·c (default: a local `business-rules.md`, so `file`) |

> **Neon carries no role** — it isn't a tool the user works in, it's Proactive-Jupi's own task/action database. Access is via the conn string in config, not this table.

## Routines — cadence + why
Populated by setup step 8. Each routine is anchored to a **real ritual the crawl discovered**, so the user sees *why* it fires when it does. Each entry: **routine** · **schedule** · **anchor event** (the ritual it's timed to).

| Routine | Schedule | Anchored to |
|---|---|---|
| _e.g. act-or-decide_ | _~45 min before daily standup_ | _standup 11:40_ |
| _e.g. update-brain_ | _daily, before the workday_ | _— (pre-day)_ |

_Empty until setup runs._

## Agents / skills — discovered, for reuse
*(Reuse only, no lifecycle registry.)* Populated by setup step 3.

_None discovered yet._

## Business rules — index
**Store:** the tool tagged **`rules`** in the tools table above (default: a local `.proactive-jupi/business-rules.md`). That tag is what names the store — any id or secret needed to *open* it lives in config, never here. This section is the **index** read in full by the context searches (shallow tags a candidate `rule_ref`; the deep dig opens the store entry to confirm and pre-empt the open question → confidence high → act).

Rules accrete reactively via task → recurring decision → rule: `act-or-decide` posts a `[BR]` rule-decision, the owner approves it in Jupi, `act-post-decision` runs its business-rule-update action (writes the store) and appends the entry here. Each entry: **rule id (Jupi decision)** · *when-X-always-Y* · owner · task types it unblocks · store ref (anchor / block id).

_Empty. No business rules yet._
