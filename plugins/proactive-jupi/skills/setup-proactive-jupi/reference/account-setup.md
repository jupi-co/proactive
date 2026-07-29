# Creating the Neon and Supermemory accounts

Read this the moment setup establishes that one of these accounts **doesn't exist yet** — Neon in step 1, Supermemory in step 2. Don't paraphrase it from memory: the URLs, the pooled-connection toggle, and the OAuth-before-API-key ordering are the parts that go wrong when recalled rather than read.

## Posture — this is a two-minute errand, not a prerequisite

Most people arriving at setup have never heard of either service. They aren't products the user chose; they're where Jupi keeps things. So lead with what it buys *them* ("this is where your task list lives", "this is where I keep what I learn about your people and projects"), give them the short version of the click-path, and stop talking. A wall of infrastructure explanation makes a five-click signup feel like a migration.

**What stays theirs, always:** signing up, naming things, typing a password, and every OAuth consent. **Never create the account, enter credentials, or complete OAuth on their behalf** — that's prohibited by design, and it stays prohibited if they offer you the password to save time. Drive right up to the browser tab and stop.

## Ask once, batch the trip, then wait

- **If both accounts are missing, put them in one message.** Two separate asks means two trips to the browser with a wait in between; one message means they do both while they're already there. Step 1 owns Neon and step 2 owns Supermemory, but the cheap Supermemory probe costs nothing to run early — so run it during step 1 rather than discovering the second gap after they've sat back down.
- **Probe Jupi before sending anyone on a signup trip.** Jupi is the blocking gate: if it never answers, setup halts regardless. Discovering that *after* they spent ten minutes creating two accounts is a bad trade for a probe that takes a second.
- **Then end your turn and wait.** Signup happens in a browser, out of this session — there is nothing to poll and nothing to do meanwhile. When they say they're done, re-probe (Supermemory) or validate the string (Neon). If nothing comes back at all, this falls under the skill's no-answer rule: they went to a browser and got pulled away. Save what's already settled, halt with the outstanding step on screen, and let a re-run resume — never re-ask, and never invent a value.

---

## Neon — where the backlog lives

**What to tell them it is:** the database that holds the task list Jupi works from — what came in, what it's scored, what's waiting on a decision. It's theirs; Jupi just writes to it.

**Check for one they already have before creating anything.** In a company of any size the engineering team may already run Neon — or any Postgres — and an existing project-scoped connection string works exactly as well as a new one. Worth a sentence before you send someone off to sign up, especially where the person you're talking to owns vendor admin and would rather not put another account in their own name.

**The click-path** (when there genuinely isn't one to reuse):
1. **Sign up at [console.neon.tech](https://console.neon.tech)** — Google/GitHub/email. The **Free plan** covers a workspace like this; no card needed to start.
2. **Create a project** for this, named something recognizable (`proactive-jupi`). Signup usually creates a first project already — using that one is fine as long as it isn't holding anything else.
3. **Project Dashboard → Connect** → turn the **Connection pooling** toggle **on** (the host gains `-pooler`), then copy the connection string.
4. **Paste it back in chat.**

**What a good string looks like** — a check you can run before probing, so an obviously truncated paste doesn't burn a round-trip:

```
postgresql://<role>:<password>@ep-<id>-pooler.<region>.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

`postgres://` is equally valid, and the database name varies. What matters: it carries a password, a `neon.tech` host, and `sslmode=require`.

**Gotchas worth catching before they cost a re-collect:**
- **A dedicated project, not their production one.** The string is scoped to exactly one project, and that scoping *is* the isolation boundary — it's the whole reason setup uses a connection string rather than the account-wide Neon MCP, whose OAuth would span every project on the account. Pointing it at a production project throws that away for no gain.
- **A Neon API key is not a substitute.** If they offer one, it's account-wide; only the per-project connection string is scoped. Ask for the string.
- **Pooling matters here.** Step 5 applies the schema over the HTTPS serverless driver — the serverless case Neon recommends the pooled endpoint for.
- **It's a password.** The moment it arrives it goes into `.proactive-jupi/config.local.json` and is referred to by path thereafter: never echoed back in chat, never inline on a command line, never routed through a chat-visible file flow.
- **`neonProjectId` is optional** and nothing reads it. If it isn't obvious from the console, leave it blank rather than sending them hunting.

**Then:** validate it with the real `SELECT 1` (step 1) — a fresh project is exactly where a mistyped or half-copied string shows up.

---

## Supermemory — where the brain lives

**What to tell them it is:** where Jupi keeps what it learns about their people, projects and priorities, so it isn't starting from zero every morning.

**The click-path:**
1. **Sign up at [app.supermemory.ai](https://app.supermemory.ai)** — signup creates their **organization** for them; whatever it gets named is fine, because nothing in Proactive-Jupi routes on it.
2. **Add the MCP connector: `https://mcp.supermemory.ai/mcp`, with no auth header.** The server uses **OAuth by default** — their client discovers the authorization server and prompts them to sign in, so no key ever changes hands. Where they add it depends on their surface: the "Customize" connector settings on claude.ai/Cowork, or `claude mcp add` in Claude Code.
3. **API key only as a fallback**, for a client that genuinely can't do OAuth: the same URL plus header `Authorization: Bearer sm_<key>`, key from app.supermemory.ai. Reach for this second, not first — an installed connector beats a key that then has to live somewhere.

**Gotchas:**
- **Don't ask them anything about container tags, spaces, or projects.** `update-brain` owns how Facts are stored and hard-codes the container tag (`user_<jupiUserId>`); if the app invites them to name a space, it's irrelevant here. Setup asking about it is a known regression.
- **Nothing goes in config.** There is no Supermemory field in `config.local.json` by design — the connector is the whole configuration.
- **Re-probe after they add it; don't assume it took.** A connector added under "Customize" can still need enabling for this workspace — that's step 2's ambiguous state, and one toggle beats a redundant re-auth.

---

## If they'd rather not, right now

**Both accounts are required, so "not now" isn't an outcome setup can deliver** — and the honest thing is to say so rather than let someone believe they have a working setup that will quietly do nothing:

- **No Neon** → no schema and no backlog rows. Steps 5 and 7 have nowhere to write, so *nothing* past the ✋ boundary runs — there is no backlog, which means there is no Proactive-Jupi.
- **No Supermemory** → step 6 seeds no Facts, so `act-or-decide` reasons about the user's people and projects while knowing nothing about them. It would still emit drafts and decisions, which is worse than emitting none: confident output built on no context.

**What to do instead of accepting it.** Reluctance here is nearly always about time or about signing up for something unfamiliar — so treat it as an objection to answer, not a decision to record:

- **Shrink the errand.** Both signups together are about five minutes. Batch them, hand over the exact click-paths, and stay on the line rather than sending them away with homework.
- **Answer the real worry.** Free tier, no card, their account and their data, and Jupi is a writer to it rather than an owner of it.
- **Offer the reuse path** (Neon): an existing project-scoped string from their engineering team works just as well as a new signup, and it may be the faster route.
- **Then pause, don't proceed.** If they still can't do it now, that's fine and human — save everything already settled, state exactly what's outstanding, and let a re-run resume from there. What you must not do is cross the ✋ boundary, or write a report that reads like success. An unfinished setup the user understands is recoverable; a "finished" one with no database is a system that fails silently every morning.
