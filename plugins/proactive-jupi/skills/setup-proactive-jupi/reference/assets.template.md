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

**`Draft call` — what draft mode can actually promise on this tool.** `act-or-decide`'s default `draft` mode
assumes it can prepare something and leave it for the user to look at. That came from mail, where a draft is
a real object sitting in a folder; most tools have nothing like it, and draft mode was quietly undefined for
them. So record, per tool, **the name of the call that leaves the last step to the user** — `gmail
create_draft` — or `none`, or `unknown`. A call qualifies only if **both** are true: (1) after it returns
the user still has to do something for it to count (they press send), and (2) until they do, nobody else can
see it. `create_draft` passes both; `save_comment` fails the first — the comment is posted and people are
notified, with nothing left to press. Write what the tool could actually do when it was probed, not what the
product can do in its own UI: Linear has drafts in-product but doesn't offer them over MCP, so its honest
value today is `none`.

Two things that look like a draft and fail that test: **hiding it isn't the same as not doing it** (an issue
`state`, a doc's sharing setting — the issue is created, the team can see it, and taking it back means
deleting it); and **a draft message *about* a commitment is not a draft of the commitment**.

This column is **a note from last time, not the last word**. `act-or-decide` works out per action, at run
time, whether the call it's about to make has a draft version, and falls back to this value when it can't
check — so a call it can genuinely name beats a `none` here, and a stale row costs a question to the user
rather than an unwanted send. **`unknown` counts as `no`**, and so does an empty cell: getting it wrong
towards "no" costs one question; getting it wrong towards "yes" does something in the user's name that can't
be taken back, under the very mode they picked to stop that.

| Tool | Connected | Roles | Draft call | When to use it |
|---|---|---|---|---|
| Gmail | ☐ | inbox, context, work | `create_draft` | Triage what lands; read threads for context; draft/send replies |
| Google Calendar | ☐ | inbox, context, work | none — `create_event` books and invites | Meetings that need prep; who-met-whom for the brain; create/move events, book slots |
| Google Drive | ☐ | context, work | none — a file can be unshared, but it exists | Read the doc behind a decision; comment / create docs |
| Linear | ☐ | inbox, context, work | none — `save_comment` posts and notifies; `save_issue` creates immediately (`state` only hides it) | Assigned issues; project/owner context; comment + create issues |
| GitHub | ☐ | inbox, context, work | check the tool — a draft PR counts, a comment doesn't | Review requests; code/PR context; comment, open PRs |
| Slack | ☐ | inbox, context, work | unknown — verify against the connected surface | Mentions + DMs; conversation context; reply in thread |
| Jupi | ☐ | decision | none — a contribution writes immediately | The one decision store — search / create / finalize |
| Supermemory | ☐ | brain | n/a — not an action surface | The one Facts store — `update-brain` writes, others recall |
| _(role system of record)_ | ☐ | inbox, context, work | _fill from the probed surface_ | The system the user's role actually runs on — ATS / CRM / helpdesk / billing / warehouse. **One row per system surfaced in step 2b**; work isn't only productivity tools |
| _(rule store)_ | ☐ | rules | _fill from the probed surface_ | The one business-rule store — the tool the user named in step 2b (their team's SOP home; a local `business-rules.md`/`file` only as fallback) |

> **Neon carries no role** — it isn't a tool the user works in, it's Proactive-Jupi's own task/action database. Access is via the conn string in config, not this table.

## Routines — cadence + why
Populated by setup step 8. Each routine is anchored to a **real ritual the crawl discovered**, so the user sees *why* it fires when it does. Record the **local** time and **the cron actually set** side by side: schedulers take UTC, the conversion shifts the day whenever it crosses midnight, and an off-by-one day is invisible until a Monday quietly never runs. Two columns cost nothing and make the conversion checkable without re-deriving it.

| Routine | Local time | Cron as set | Anchored to |
|---|---|---|---|
| _Proactive-Jupi — act & decide_ | _weekdays 10:55 CEST_ | _`55 8 * * 1-5` UTC_ | _standup 11:40_ |
| _Proactive-Jupi — refresh brain_ | _daily 06:45 CEST_ | _`45 4 * * *` UTC_ | _— (before the workday)_ |

_Empty until setup runs._

## Agents / skills — discovered, for reuse
**Capability already in this workspace that Proactive-Jupi can call instead of improvising.** Populated by setup step 3 (scan of `.claude/skills/`, `.claude/agents/`, installed plugins) and hand-extendable. `act-or-decide` reads this when planning an action: if an entry covers the work, its action **invokes that skill** rather than reasoning the task out from scratch — so *When to reach for it* is what makes an entry usable, and **`Sends?` is what makes it safe**. Draft mode rewrites act-or-decide's own verb; it cannot reach inside a skill you invoke. So a skill that sends, posts, publishes or books is **non-draftable** — it must be gated as a decision even in draft mode — and `unknown` counts as sending. An entry that says only "compiles the digest" while the skill quietly mails it is how an unauthorised external send gets through. **Reuse only — never a lifecycle registry:** nothing here is created, edited, or scheduled by Proactive-Jupi.

Proactive-Jupi's own skills (`update-brain`, `refresh-backlog`, `act-or-decide`, `execute-action`, `act-post-decision`) are the pipeline itself and are deliberately **not** listed.

**`Reachable` is the other safety field, and it is about *where the skill lives*.** A scheduled routine
runs in the cloud, so a skill sitting in this workspace's `.claude/skills/` is not callable from one —
`local only`. A skill from a plugin installed on the user's account travels with them — `yes`. Nothing
notices this at run time: a routine can plan a whole action around a competence that isn't there, and the
plan reads as sound until the moment it runs. So an entry marked `local only` is usable when the user
invokes Jupi themselves and **invisible to the routines** — plan without it, and say what that costs.

| Name | Kind | Invoked as | Sends? | Reachable | What it does | When to reach for it |
|---|---|---|---|---|---|---|
| _e.g. weekly-board-report_ | skill | `/weekly-board-report` | no — drafts only | local only | _Builds the investor update from Linear + the metrics sheet_ | _Any "board update / investor report" task — don't recompose it by hand_ |
| _e.g. partner-digest_ | skill | `/partner-digest` | **yes — emails the partners list** | yes (account plugin) | _Compiles the monthly digest and mails it_ | _Monthly partner comms — but it sends, so it can never be a silent ACT_ |

_Empty until setup runs. If a scan finds nothing, setup writes "none discovered" here — an empty table is ambiguous, an explicit "none" is not._

## Business rules
**Store:** the tool tagged **`rules`** in the tools table above — normally the shared space where the team's SOPs already live (a local `.proactive-jupi/business-rules.md` only when there is no external home). That tag is what names the store; the id or secret needed to *open* it lives in config, never here.

**The index lives in the store, not in this file.** Rules accrete at run time — `act-or-decide` posts a `[BR]` rule-decision, the owner approves it in Jupi, `act-post-decision` writes the rule and indexes it — and a scheduled routine cannot write back to a file on someone's laptop. Keeping the index beside the rules it indexes is what lets that loop close from anywhere; it also keeps the index next to the text a colleague reads, instead of in a workspace file only Jupi opens. Each entry, in the store's own index section: **rule id (Jupi decision)** · *when-X-always-Y* · owner · task types it unblocks · anchor / block id.

_This file names the store. It does not hold the rules._
