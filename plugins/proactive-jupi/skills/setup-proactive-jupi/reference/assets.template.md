# Asset Map

The system's own capability inventory. **Read in full** by act-or-decide; **hand-editable**. Written/updated by the `setup` skill (steps 2–3). Not in Supermemory.

## Who this is — role & accountabilities
Written by setup step 2b from what the user said (or from the LinkedIn profile they offered). **This is what makes "does this matter to them?" answerable** — `refresh-backlog` scores relevance against it, and `act-or-decide` weighs exposure against the seniority of the people involved. Keep it short and concrete; correct it by hand whenever the job changes.

- **Role / function:** _e.g. Head of Revenue Ops, mid-market SaaS_
- **Accountable for:** _the outcomes they own — e.g. pipeline hygiene, forecast accuracy, quota-to-comp_
- **Works with:** _the recurring counterparties — teams, accounts, agencies_

_Empty until setup runs._

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
| Google Calendar | ☐ | inbox, context, work | Meetings that need prep; who-met-whom for the brain; create/move events, book slots |
| Google Drive | ☐ | context, work | Read the doc behind a decision; comment / create docs |
| Linear | ☐ | inbox, context, work | Assigned issues; project/owner context; comment + create issues |
| GitHub | ☐ | inbox, context, work | Review requests; code/PR context; comment, open PRs |
| Slack | ☐ | inbox, context, work | Mentions + DMs; conversation context; reply in thread |
| Jupi | ☐ | decision | The one decision store — search / create / finalize |
| Supermemory | ☐ | brain | The one Facts store — `update-brain` writes, others recall |
| _(role system of record)_ | ☐ | inbox, context, work | The system the user's role actually runs on — ATS / CRM / helpdesk / billing / warehouse. **One row per system surfaced in step 2b**; work isn't only productivity tools |
| _(rule store)_ | ☐ | rules | The one business-rule store — the tool the user named in step 2b (their team's SOP home; a local `business-rules.md`/`file` only as fallback) |

> **Neon carries no role** — it isn't a tool the user works in, it's Proactive-Jupi's own task/action database. Access is via the conn string in config, not this table.

## Routines — cadence + why
Populated by setup step 8. Each routine is anchored to a **real ritual the crawl discovered**, so the user sees *why* it fires when it does. Each entry: **routine** · **schedule** · **anchor event** (the ritual it's timed to).

| Routine | Schedule | Anchored to |
|---|---|---|
| _e.g. act-or-decide_ | _~45 min before daily standup_ | _standup 11:40_ |
| _e.g. update-brain_ | _daily, before the workday_ | _— (pre-day)_ |

_Empty until setup runs._

## Agents / skills — discovered, for reuse
**Capability already in this workspace that Proactive-Jupi can call instead of improvising.** Populated by setup step 3 (scan of `.claude/skills/`, `.claude/agents/`, installed plugins) and hand-extendable. `act-or-decide` reads this when planning an action: if an entry covers the work, its action **invokes that skill** rather than reasoning the task out from scratch — so *When to reach for it* is what makes an entry usable, and **`Sends?` is what makes it safe**. Draft mode rewrites act-or-decide's own verb; it cannot reach inside a skill you invoke. So a skill that sends, posts, publishes or books is **non-draftable** — it must be gated as a decision even in draft mode — and `unknown` counts as sending. An entry that says only "compiles the digest" while the skill quietly mails it is how an unauthorised external send gets through. **Reuse only — never a lifecycle registry:** nothing here is created, edited, or scheduled by Proactive-Jupi.

Proactive-Jupi's own skills (`update-brain`, `refresh-backlog`, `act-or-decide`, `execute-action`, `act-post-decision`) are the pipeline itself and are deliberately **not** listed.

| Name | Kind | Invoked as | Sends? | What it does | When to reach for it |
|---|---|---|---|---|---|
| _e.g. weekly-board-report_ | skill | `/weekly-board-report` | no — drafts only | _Builds the investor update from Linear + the metrics sheet_ | _Any "board update / investor report" task — don't recompose it by hand_ |
| _e.g. partner-digest_ | skill | `/partner-digest` | **yes — emails the partners list** | _Compiles the monthly digest and mails it_ | _Monthly partner comms — but it sends, so it can never be a silent ACT_ |

_Empty until setup runs. If a scan finds nothing, setup writes "none discovered" here — an empty table is ambiguous, an explicit "none" is not._

## Business rules — index
**Store:** the tool tagged **`rules`** in the tools table above — normally the shared space where the team's SOPs already live (a local `.proactive-jupi/business-rules.md` only when there is no external home). That tag is what names the store — any id or secret needed to *open* it lives in config, never here. This section is the **index** read in full by the context searches (shallow tags a candidate `rule_ref`; the deep dig opens the store entry to confirm and pre-empt the open question → confidence high → act).

Rules accrete reactively via task → recurring decision → rule: `act-or-decide` posts a `[BR]` rule-decision, the owner approves it in Jupi, `act-post-decision` runs its business-rule-update action (writes the store) and appends the entry here. Each entry: **rule id (Jupi decision)** · *when-X-always-Y* · owner · task types it unblocks · store ref (anchor / block id).

_Empty. No business rules yet._
