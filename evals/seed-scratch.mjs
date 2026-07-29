#!/usr/bin/env node
// Eval fixture seeder — builds an isolated scratch workspace per case and seeds Neon.
//
// Per evals/README.md, the `eval:` signal_ref prefix makes rows DELETABLE; only a
// synthetic `jupiUserId` makes them ISOLATED. So every case gets its own tenant
// (`eval-<skill>-<id>`), which is what lets the cases run in parallel without
// sharing a backlog window — and lets teardown be a single delete-by-tenant.
//
//   node evals/seed-scratch.mjs <skill> <case-id>     seed one case
//   node evals/seed-scratch.mjs --purge <skill> <id>  delete that tenant's rows
//   node evals/seed-scratch.mjs --purge-all           delete every eval-* tenant
//
// The real connection string comes from the repo's own config and is written into
// each scratch config (gitignored under evals/*/workspace/). It is never printed.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const REAL_CONFIG = "/Users/anne-clairelehenaff/jupi/proactive/.proactive-jupi/config.local.json";
const EVAL_WORKSPACE = "test"; // the Jupi test workspace (evals/README.md)

const { neon } = await import(join(ROOT, "plugins/proactive-jupi/shared/node_modules/@neondatabase/serverless/index.mjs"));
const real = JSON.parse(readFileSync(REAL_CONFIG, "utf8"));
const sql = neon(real.neonConnString);

const tenant = (skill, id) => `eval-${skill}-${id}`;
const wsDir = (skill, id) => join(ROOT, "evals", skill, "workspace/iteration-1/scratch", `case-${id}`);

// ── the scratch workspace: config + asset map + a file-backed rule store ──────
function writeWorkspace(skill, id, { rules = [], ruleIndex = [] } = {}) {
  const dir = wsDir(skill, id);
  const pj = join(dir, ".proactive-jupi");
  mkdirSync(pj, { recursive: true });

  writeFileSync(
    join(pj, "config.local.json"),
    JSON.stringify(
      {
        _note: "EVAL SCRATCH — synthetic tenant, Jupi test workspace. Regenerable; gitignored.",
        jupiWorkspace: EVAL_WORKSPACE,
        jupiUserId: tenant(skill, id),
        neonConnString: real.neonConnString,
        crawlWindowDays: 14,
        backlogWindowSize: 20,
        ruleThreshold: 2,
        rulesStoreRef: "./.proactive-jupi/rules.md",
        guardrails: {
          mode: "draft",
          clusterBudget: 10,
          decisionBudget: 5,
          policy: { high: { low: "act", high: "decide" }, low: { low: "decide", high: "decide" } },
        },
      },
      null,
      2,
    ) + "\n",
  );

  // A file-backed rule store keeps the rule fixtures deterministic: the index and
  // the rules live in the same store, which is the shape the skills expect.
  writeFileSync(
    join(pj, "rules.md"),
    `# Business rules\n\n## Index\n\n| Rule id | When X → always Y | Owner | Unblocks |\n|---|---|---|---|\n${
      ruleIndex.length ? ruleIndex.join("\n") + "\n" : "| _(none yet)_ | | | |\n"
    }\n## Rules\n\n${rules.join("\n\n")}\n`,
  );

  writeFileSync(
    join(pj, "assets.md"),
    `# Asset Map

## Who this is — role & accountabilities
- **Role / function:** CEO & co-founder, Jupi (decision platform, seed stage)
- **Accountable for:** product direction, pilots and early revenue, the team
- **Works with:** the founding team, pilot prospects, investors

## Tools — roles

> **No tool carries the \`work\` role, and every \`Draft call\` is \`none\`. This is deliberate and is the
> eval harness's fourth isolation boundary.** Neon, Supermemory and Jupi each have an isolation story
> (synthetic tenant / scratch container / test workspace); the user's *tools* had none, because the
> connectors reachable in a session are the real ones. On 2026-07-29 that gap produced a real Gmail draft
> addressed to a counterparty invented by a fixture — the skill behaved correctly throughout, and
> \`execute-action\` wrote it to the live mailbox because \`assets.md\` said Gmail was \`work\` with
> \`create_draft\`. Withholding the role removes the write surface without touching the skill under test:
> reads still work, so research, clustering and the gate are all still exercised.
>
> **A case that must exercise a real tool write cannot be isolated this way and must not run here.** Give it
> a throwaway account, or assert on the queued \`ready\` row rather than on the side-effect.

| Tool | Connected | Roles | Draft call |
|---|---|---|---|
| Gmail | yes | inbox, context | none |
| Calendar | yes | inbox, context | none |
| Linear | yes | inbox, context | none |
| Jupi | yes | decision | n/a |
| Supermemory | yes | brain | n/a |
| Rulebook (\`./.proactive-jupi/rules.md\`) | yes | rules | n/a |

## Agents / skills

| Skill | When to reach for it | Reachable |
|---|---|---|
| _(none registered)_ | | |

## Business rules index
Lives in the \`rules\` store itself — see \`./.proactive-jupi/rules.md\`.
`,
  );
  return dir;
}

// ── fixtures ─────────────────────────────────────────────────────────────────
async function upsertTask(uid, t) {
  const rows = await sql.query(
    `insert into tasks (user_id, short_label, summary, signal_type, signal_ref, signal_url,
                        signal_at, external, deadline, relevant_facts, open_questions, status,
                        impact, relevance, bottleneck, urgency, score, closed_at)
     values ($1,$2,$3,$4,$5,$6,$7,coalesce($8,false),$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18)
     on conflict (user_id, signal_type, signal_ref) do update
       set status=excluded.status, score=excluded.score, closed_at=excluded.closed_at,
           summary=excluded.summary, open_questions=excluded.open_questions
     returning id, status`,
    [
      uid, t.short_label, t.summary, t.signal_type, t.signal_ref, t.signal_url ?? null,
      t.signal_at ?? null, t.external ?? false, t.deadline ?? null,
      JSON.stringify(t.relevant_facts ?? []), JSON.stringify(t.open_questions ?? []),
      t.status ?? "open", t.impact ?? "medium", t.relevance ?? "high", t.bottleneck ?? "medium",
      t.urgency ?? 2, t.score ?? 12, t.closed_at ?? null,
    ],
  );
  return rows[0];
}

async function pushFrontier(uid, f) {
  const rows = await sql.query(
    `insert into crawl_frontier (user_id, kind, entity, note, source_ref, pushed_by, is_eval)
     values ($1,$2,$3,$4,$5,$6,false) returning id, kind, entity`,
    [uid, f.kind, f.entity ?? null, f.note, f.source_ref ?? null, f.pushed_by ?? "act-or-decide"],
  );
  return rows[0];
}

const DAY = 24 * 3600 * 1000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();

const FIXTURES = {
  "act-or-decide": {
    // 21 · a do-nothing rule already exists; its class must be dropped un-researched.
    21: async (uid) => {
      writeWorkspace("act-or-decide", 21, {
        ruleIndex: [
          "| BR-DN-001 | When a Product Hunt daily digest lands in the inbox → do nothing | Anne-Claire | inbox digests |",
        ],
        rules: [
          `### BR-DN-001 — When a Product Hunt daily digest lands in the inbox, do nothing\n\n` +
            `**Type:** do-nothing rule. **Approved by:** Anne-Claire, 2026-07-20.\n` +
            `**Scope:** email from \`hello@producthunt.com\` whose subject begins "Product Hunt Daily".\n` +
            `**Effect:** the task is dropped without research. No reply, no draft, no decision.\n` +
            `**Why:** eight consecutive digests were read and dropped; none ever needed an action.`,
        ],
      });
      await upsertTask(uid, {
        short_label: "Product Hunt Daily digest",
        summary:
          "Email from hello@producthunt.com, subject 'Product Hunt Daily — the 10 best products of the day'. A marketing digest listing today's launches. No question, no ask, no deadline.",
        signal_type: "gmail", signal_ref: "eval:ph-digest-1",
        signal_url: "https://mail.google.com/mail/u/0/#inbox/evalph1",
        signal_at: ago(1), external: true, score: 8,
      });
      await upsertTask(uid, {
        short_label: "Sarah at Alan asks for the pilot scope doc",
        summary:
          "Sarah Mercier (Head of Ops, Alan) replied on the pilot thread asking for the one-page scope doc before their internal review on Thursday. She needs it to put the pilot in front of her CTO.",
        signal_type: "gmail", signal_ref: "eval:alan-scope-1",
        signal_url: "https://mail.google.com/mail/u/0/#inbox/evalalan1",
        signal_at: ago(1), external: true, deadline: new Date(Date.now() + 3 * DAY).toISOString(),
        score: 24,
      });
    },

    // 22 · four prior drops of one shape + a live instance → [BR] do-nothing proposal.
    22: async (uid) => {
      writeWorkspace("act-or-decide", 22);
      for (let i = 1; i <= 4; i++) {
        await upsertTask(uid, {
          short_label: `CI failure notification #${i}`,
          summary:
            `Automated notification from linear-bot: "Nightly CI run failed on main — 1 flaky test (checkout.spec.ts)". Auto-retried and passed on the second attempt; the bot posts one of these most nights.`,
          signal_type: "linear", signal_ref: `eval:ci-noise-${i}`,
          signal_at: ago(i * 5 + 2), status: "dropped", closed_at: ago(i * 5),
          score: 4,
        });
      }
      await upsertTask(uid, {
        short_label: "CI failure notification #5",
        summary:
          `Automated notification from linear-bot: "Nightly CI run failed on main — 1 flaky test (checkout.spec.ts)". Auto-retried and passed on the second attempt.`,
        signal_type: "linear", signal_ref: "eval:ci-noise-5",
        signal_at: ago(1), status: "open", score: 4,
      });
      await upsertTask(uid, {
        short_label: "Investor update draft due",
        summary:
          "The monthly investor update is due Friday. Last month's went out on the 3rd. Needs the usual metrics block plus a line on the Alan pilot.",
        signal_type: "calendar", signal_ref: "eval:inv-update-1",
        signal_at: ago(2), deadline: new Date(Date.now() + 4 * DAY).toISOString(), score: 22,
      });
    },

    // 23 · voice: no profile exists, so run 1 must pull sent history and delegate.
    23: async (uid) => {
      writeWorkspace("act-or-decide", 23);
      await upsertTask(uid, {
        short_label: "Reply to Thomas Vidal about the integration timeline",
        summary:
          "Thomas Vidal (CTO, Payfit) emailed asking when the Jupi <-> Slack integration will be ready, because his team is planning their Q4 roadmap next week. He wants a date or a range. The answer is known: the integration ships mid-October.",
        signal_type: "gmail", signal_ref: "eval:voice-thomas-1",
        signal_url: "https://mail.google.com/mail/u/0/#inbox/evalvoice1",
        signal_at: ago(1), external: true, score: 20,
      });
    },

    // 24 · an unknown counterparty worth queueing, not worth a mid-plan lookup.
    24: async (uid) => {
      writeWorkspace("act-or-decide", 24);
      await upsertTask(uid, {
        short_label: "Intro request from Camille Roux at Serena",
        summary:
          "Camille Roux emailed from serena.vc asking for 30 minutes to talk about the seed round. She mentions she was pointed our way by 'Marc at Alven'. Nothing is known about Camille, Serena, or Marc — none of them appear anywhere in the brain. The reply itself is straightforward: accept and offer slots.",
        signal_type: "gmail", signal_ref: "eval:serena-intro-1",
        signal_url: "https://mail.google.com/mail/u/0/#inbox/evalserena1",
        signal_at: ago(2), external: true, score: 18,
      });
    },

    // 3 · REGRESSION (dry-run): the confidence x exposure gate under draft mode.
    3: async (uid) => {
      writeWorkspace("act-or-decide", 3);
      await upsertTask(uid, {
        short_label: "Book the venue for the December offsite",
        summary:
          "The December team offsite needs a venue. Quotes are in from two places; the team picked Le Hangar and asked us to confirm the booking for 12-13 December. Confirming means signing and paying the deposit — it is non-refundable after 48 hours.",
        signal_type: "gmail", signal_ref: "eval:venue-1",
        signal_url: "https://mail.google.com/mail/u/0/#inbox/evalvenue1",
        signal_at: ago(3), external: true, score: 26,
      });
      await upsertTask(uid, {
        short_label: "Send the requested case study to a client",
        summary:
          "Julie Fontaine (external client, Doctolib) asked for the Alan case study PDF. We have it, it is public, and she just needs the link plus two lines of context.",
        signal_type: "gmail", signal_ref: "eval:casestudy-1",
        signal_url: "https://mail.google.com/mail/u/0/#inbox/evalcase1",
        signal_at: ago(1), external: true, score: 21,
      });
    },
  },

  "update-brain": {
    // 6 · a seeded frontier that must be drained before the window sweep.
    6: async (uid) => {
      writeWorkspace("update-brain", 6);
      await pushFrontier(uid, {
        kind: "entity", entity: "Serena Capital",
        note: "who is Serena Capital and who is Camille Roux there — blocked deciding how to answer an inbound seed-round intro, found in gmail thread eval:serena-intro-1",
        source_ref: "eval:serena-intro-1",
      });
      await pushFrontier(uid, {
        kind: "voice", entity: "Thomas Vidal (email)",
        note: "no register on file for Thomas Vidal on email; a reply to him is queued and the draft will be guessed without it",
        source_ref: "eval:voice-thomas-1",
      });
      await pushFrontier(uid, {
        kind: "topic", entity: "SOC 2 readiness",
        note: "three separate pilot threads have now raised SOC 2; the brain has nothing on where we stand, so every one of those replies is improvised",
        source_ref: "eval:alan-scope-1",
      });
    },
    // 7 · a handed-over voice observation: record it, don't go re-read anything.
    7: async () => { writeWorkspace("update-brain", 7); },
    // 8 · push-on-discovery during a normal sweep.
    8: async () => { writeWorkspace("update-brain", 8); },
  },
};

// ── teardown ─────────────────────────────────────────────────────────────────
async function purgeTenant(uid) {
  const t = await sql.query("delete from tasks where user_id = $1 returning id", [uid]);
  const f = await sql.query("delete from crawl_frontier where user_id = $1 returning id", [uid]);
  const c = await sql.query("delete from crawl_state where user_id = $1 returning source", [uid]);
  const a = await sql.query("delete from actions where user_id = $1 returning id", [uid]);
  return { tenant: uid, tasks: t.length, frontier: f.length, cursors: c.length, actions: a.length };
}

async function purgeAll() {
  const out = [];
  for (const tbl of ["tasks", "actions", "crawl_frontier", "crawl_state", "routine_runs"]) {
    const r = await sql.query(`delete from ${tbl} where user_id like 'eval-%' returning user_id`);
    out.push(`${tbl}: ${r.length}`);
  }
  return out.join(" · ");
}

// ── main ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv[0] === "--purge-all") {
  console.log("purged →", await purgeAll());
} else if (argv[0] === "--purge") {
  console.log(JSON.stringify(await purgeTenant(tenant(argv[1], argv[2])), null, 2));
} else {
  const [skill, id] = argv;
  const fn = FIXTURES[skill]?.[id];
  if (!fn) throw new Error(`no fixture for ${skill} case ${id}`);
  const uid = tenant(skill, id);
  await purgeTenant(uid); // idempotent re-seed
  await fn(uid);
  const tasks = await sql.query(
    "select status, count(*) from tasks where user_id = $1 group by status", [uid]);
  const front = await sql.query(
    "select count(*) from crawl_frontier where user_id = $1 and status='pending'", [uid]);
  console.log(JSON.stringify({
    skill, case: Number(id), tenant: uid, workspace: wsDir(skill, id),
    tasks: Object.fromEntries(tasks.map((r) => [r.status, Number(r.count)])),
    frontier_pending: Number(front[0].count),
  }, null, 2));
}
