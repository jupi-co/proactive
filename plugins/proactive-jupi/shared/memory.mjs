#!/usr/bin/env node
// Proactive-Jupi — Supermemory HTTP-API helper (shared).
//
// The connector (`memory` / `recall`) stays the default path for Facts: it is
// simpler and semantic recall is what the brain is mostly for. This file exists
// for the cases the connector provably cannot serve, which `references/
// supermemory.md` already anticipated as the **upgrade trigger**: "noisy recall
// (duplicate/contradictory facts) or a need for structured filtering/enumeration
// → add the HTTP API: POST /v3/documents (raw content, customId, metadata)".
//
// That trigger fired on 2026-07-29. A voice profile needs two things the
// connector cannot give:
//
//   1. AN EXACT KEYED READ WITH LAST-WRITE-WINS. `recall` is ranked and
//      approximate, and a re-saved correction was measured ranking BELOW the
//      flattened original (0.81 vs 0.80) — so "save the new statement and let
//      recency reconcile" does not reliably return the current register.
//      `customId` makes the write an UPSERT (verified: three writes to
//      customId `voice:nick:email` returned one document id and the third
//      write's content+metadata), and the read an exact GET.
//   2. FIELDS THAT SURVIVE. Supermemory rewrites saved CONTENT, stripping dates
//      and attributions from the top-ranked memory a caller reads — wherever in
//      the sentence they sit. `metadata` is NOT rewritten: it comes back
//      verbatim (verified), which is the only reason a dated, `verified`-flagged
//      profile can be trusted at all.
//
// Usage:  node memory.mjs <verb> [args...]
//   put-voice  '<json>'              → { customId, id, status }
//       json: person, channel, register, observed_at (required);
//             sample_size?, verified?, source_note?
//   get-voice  <person> <channel>    → { register, observed_at, age_days, verified, … } | null
//   list-voice                       → [ {person, channel, observed_at, age_days, verified}, … ]
//
// Credential: $SUPERMEMORY_API_KEY, else `supermemoryApiKey` from
// .proactive-jupi/config.local.json (same walk-up as db.mjs). A scheduled routine
// carries config in its prompt, so this key travels there too — see
// setup's reference/routine-prompt.md §Rotation, which now has TWO secrets to
// rotate rather than one. That cost is real and is the reason this helper is
// scoped to what genuinely needs it, rather than becoming the default write path.
//
// Output: JSON on stdout. Errors: JSON {error} on stderr, exit 1.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API = "https://api.supermemory.ai";
const clean = (v) => (v && !String(v).includes("<") ? v : null);

let _cfg;
function workspaceConfig() {
  if (_cfg !== undefined) return _cfg;
  _cfg = null;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const p = join(dir, ".proactive-jupi", "config.local.json");
    if (existsSync(p)) {
      try {
        _cfg = JSON.parse(readFileSync(p, "utf8"));
      } catch {}
      break;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return _cfg;
}

// Sentinel for "this path isn't configured". Distinct from an error on purpose: the
// HTTP path is OPTIONAL (voice profiles), so a missing key must not fail a run that
// would otherwise work — act-or-decide falls back to pulling the sent history, which
// is correct and merely costs more. A hard error here would take out the whole run
// over a feature nobody enabled.
const NOT_CONFIGURED = {
  disabled: true,
  reason:
    "no Supermemory API key (supermemoryApiKey in config, or $SUPERMEMORY_API_KEY) — voice profiles are off. " +
    "Callers should fall back to reading the source each run and say so once.",
};

function auth() {
  const cfg = workspaceConfig() || {};
  const key = process.env.SUPERMEMORY_API_KEY || clean(cfg.supermemoryApiKey);
  const userId = process.env.JUPI_USER_ID || clean(cfg.jupiUserId);
  if (!key) return null;
  if (!userId)
    throw new Error("no tenant id: set $JUPI_USER_ID or add jupiUserId to .proactive-jupi/config.local.json");
  // Same tenancy rule as Neon: the container tag IS the boundary, and it is derived
  // from the canonical Jupi id — never from Supermemory's own whoAmI.
  return { key, containerTag: `user_${userId}` };
}

async function call(path, body, method = "POST") {
  const a = auth();
  if (!a) throw new Error(NOT_CONFIGURED.reason);
  const { key } = a;
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `supermemory ${method} ${path} → HTTP ${res.status}${res.status === 401 ? " (key invalid or revoked)" : ""}: ${text.slice(0, 300)}`,
    );
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// A voice profile is keyed by the PAIR: the same person is often formal on email
// and terse in Linear, so a merged profile is worse than none. Lowercased so a
// lookup can't miss on capitalization.
const voiceKey = (person, channel) =>
  `voice:${String(person).trim().toLowerCase()}:${String(channel).trim().toLowerCase()}`;

const ageDays = (iso) =>
  iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null;

// Drop nullish entries — the metadata API 400s on a null value, which would fail
// the entire write over an optional field nobody supplied.
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

const VERBS = {
  async "put-voice"([jsonArg]) {
    if (!auth()) return NOT_CONFIGURED;
    const v = JSON.parse(jsonArg);
    for (const k of ["person", "channel", "register", "observed_at"])
      if (!v[k]) throw new Error(`put-voice: \`${k}\` is required`);
    const { containerTag } = auth();
    const customId = voiceKey(v.person, v.channel);

    // Does a profile for this pair already exist? The answer picks the verb AND
    // carries the one field that must not regress.
    //
    // POST with an existing customId APPENDS to the content (measured: a second
    // write produced "<old>\n\n---\n\n<new>", so re-observing a pair five times
    // would leave five contradictory registers in one document — the same
    // "correction doesn't win" failure the connector had, just relocated).
    // PATCH on the customId REPLACES the content and merges the metadata, which is
    // what re-observation actually means. So: POST to create, PATCH to update.
    let prior = null;
    try {
      prior = await call(`/v3/documents/${encodeURIComponent(customId)}`, null, "GET");
    } catch {
      /* first write for this pair */
    }
    // `verified` must never silently downgrade: a later unverified hand-over must
    // not erase the fact that someone once checked this against the source.
    const wasVerified = Boolean(prior?.metadata?.verified);

    const res = await call(prior ? `/v3/documents/${encodeURIComponent(customId)}` : "/v3/documents", {
      // The register in the CONTENT is what semantic recall finds ("how do we talk
      // to Nick?"). Keep its claims timeless — the date will not survive here.
      content: `[Process] the user → ${v.person} on ${v.channel} — ${v.register}`,
      containerTags: [containerTag],
      customId,
      // The qualifiers live in METADATA, which is returned verbatim. This is the
      // whole point of using the HTTP API for this one thing.
      // NOTE: the API rejects a null metadata value with HTTP 400 (measured — a
      // `source_note: null` on an otherwise-valid upsert failed the whole write),
      // so absent fields must be OMITTED, not sent as null. `defined()` below is
      // what stops an optional field from failing the write that carries it.
      metadata: defined({
        kind: "voice",
        person: String(v.person).toLowerCase(),
        channel: String(v.channel).toLowerCase(),
        observed_at: v.observed_at,
        sample_size: v.sample_size,
        verified: Boolean(v.verified) || wasVerified,
        source_note: v.source_note,
      }),
    }, prior ? "PATCH" : "POST");
    return {
      customId,
      id: res.id,
      status: res.status,
      mode: prior ? "updated" : "created",
      verified: Boolean(v.verified) || wasVerified,
    };
  },

  // The exact keyed read act-or-decide does before pulling any sent history.
  // `age_days` is computed here so staleness is one judgement in one place rather
  // than re-derived, differently, by every caller.
  async "get-voice"([person, channel]) {
    if (!auth()) return NOT_CONFIGURED;
    if (!person || !channel) throw new Error("get-voice: usage `get-voice <person> <channel>`");
    const customId = voiceKey(person, channel);
    let doc;
    try {
      doc = await call(`/v3/documents/${encodeURIComponent(customId)}`, null, "GET");
    } catch (e) {
      if (/HTTP 404/.test(String(e.message))) return null;
      throw e;
    }
    if (!doc || !doc.metadata) return null;
    const m = doc.metadata;
    return {
      customId,
      register: (doc.content || "").replace(/^\[Process\][^—]*—\s*/, "") || null,
      observed_at: m.observed_at ?? null,
      age_days: ageDays(m.observed_at),
      sample_size: m.sample_size ?? null,
      verified: Boolean(m.verified),
      source_note: m.source_note ?? null,
    };
  },

  async "list-voice"() {
    if (!auth()) return NOT_CONFIGURED;
    const { containerTag } = auth();
    const res = await call("/v3/documents/list", {
      limit: 200,
      containerTags: [containerTag],
      filters: JSON.stringify({ AND: [{ key: "kind", value: "voice", negate: false }] }),
    });
    return (res.memories ?? []).map((d) => ({
      customId: d.customId,
      person: d.metadata?.person ?? null,
      channel: d.metadata?.channel ?? null,
      observed_at: d.metadata?.observed_at ?? null,
      age_days: ageDays(d.metadata?.observed_at),
      verified: Boolean(d.metadata?.verified),
    }));
  },
};

async function main() {
  const [verb, ...args] = process.argv.slice(2);
  const fn = VERBS[verb];
  if (!fn) {
    process.stderr.write(JSON.stringify({ error: `unknown verb '${verb}'`, verbs: Object.keys(VERBS) }) + "\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(await fn(args)) + "\n");
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((e) => {
    process.stderr.write(JSON.stringify({ error: String(e?.message || e) }) + "\n");
    process.exit(1);
  });
}

export { VERBS, voiceKey };
