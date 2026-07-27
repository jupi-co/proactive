#!/usr/bin/env node
// Inspect and clean up Supermemory container tags — maintenance, not eval teardown.
//
//   node scripts/brain-tags.mjs                      # list every tag: counts, date range, sample titles
//   node scripts/brain-tags.mjs <tag>                # DRY RUN — show exactly what purging <tag> would remove
//   node scripts/brain-tags.mjs <tag> --confirm      # actually delete every document under <tag>
//
// Why this exists: the brain is keyed by one container tag, `user_<jupiUserId>`. A run that
// derived identity from somewhere else (e.g. Supermemory's whoAmI) writes a SECOND tag, and
// those orphaned documents then shadow the real brain — stale facts that recall can still
// surface. This lists the split and removes the wrong side.
//
// Reads SUPERMEMORY_API_KEY from the gitignored .proactive-jupi/.env
// (cp .proactive-jupi/.env.template .proactive-jupi/.env).
//
// SAFETY: deletion is permanent and there is no undo. Dry run is the default; --confirm is
// required to delete. If config.local.json has a jupiUserId, the matching canonical tag is
// refused outright unless --force-canonical.

import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = execSync('git rev-parse --show-toplevel').toString().trim()
const API = 'https://api.supermemory.ai/v3/documents'

function loadKey () {
  const envPath = join(ROOT, '.proactive-jupi', '.env')
  if (!existsSync(envPath)) die(`no ${envPath} — run: cp .proactive-jupi/.env.template .proactive-jupi/.env`)
  const line = readFileSync(envPath, 'utf8').split('\n').find(l => l.startsWith('SUPERMEMORY_API_KEY='))
  const key = line?.slice('SUPERMEMORY_API_KEY='.length).trim()
  if (!key) die('SUPERMEMORY_API_KEY is empty in .proactive-jupi/.env (key from app.supermemory.ai)')
  return key
}

function canonicalTag () {
  const p = join(ROOT, '.proactive-jupi', 'config.local.json')
  if (!existsSync(p)) return null
  const id = JSON.parse(readFileSync(p, 'utf8')).jupiUserId
  return id ? `user_${id}` : null
}

const die = m => { console.error(`ERROR: ${m}`); process.exit(1) }

async function listDocs (key, tag) {
  const body = { limit: 200, ...(tag ? { containerTags: [tag] } : {}) }
  const r = await fetch(`${API}/list`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!r.ok) die(`list failed: HTTP ${r.status} ${r.status === 401 ? '(key invalid or revoked)' : ''}`)
  return (await r.json()).memories ?? []
}

const groupByTag = docs => docs.reduce((m, d) => {
  for (const t of (d.containerTags?.length ? d.containerTags : ['(no tag)'])) (m[t] ??= []).push(d)
  return m
}, {})

const dateRange = ds => {
  const s = ds.map(d => (d.createdAt ?? '').slice(0, 10)).filter(Boolean).sort()
  return s.length ? (s[0] === s.at(-1) ? s[0] : `${s[0]} → ${s.at(-1)}`) : '?'
}

const [tag, ...flags] = process.argv.slice(2)
const confirm = flags.includes('--confirm')
const forceCanonical = flags.includes('--force-canonical')
const key = loadKey()
const canonical = canonicalTag()

// ── list mode ────────────────────────────────────────────────────────────────
if (!tag) {
  const groups = groupByTag(await listDocs(key))
  const entries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
  if (!entries.length) { console.log('No documents.'); process.exit(0) }
  console.log(`${Object.values(groups).flat().length} documents across ${entries.length} container tag(s):\n`)
  for (const [t, ds] of entries) {
    const mark = t === canonical ? '  ← canonical (config jupiUserId)' : ''
    console.log(`${String(ds.length).padStart(4)}  ${t}${mark}`)
    console.log(`      ${dateRange(ds)}`)
  }
  if (!canonical) console.log('\nNote: config.local.json has no jupiUserId, so no tag could be marked canonical.')
  console.log('\nDry-run a cleanup:  node scripts/brain-tags.mjs <tag>')
  process.exit(0)
}

// ── purge mode ───────────────────────────────────────────────────────────────
if (tag === canonical && !forceCanonical) {
  die(`${tag} is the CANONICAL brain tag (config jupiUserId). Refusing.\n` +
      '       This is the real brain, not an orphan. Pass --force-canonical only if you truly mean it.')
}

const docs = await listDocs(key, tag)
if (!docs.length) {
  console.log(`No documents under ${tag} — nothing to do.`)
  process.exit(0)
}

console.log(`${confirm ? 'DELETING' : 'DRY RUN — would delete'} ${docs.length} document(s) under ${tag}`)
console.log(`Created: ${dateRange(docs)}\n`)
for (const d of docs.slice(0, 15)) console.log(`  - ${(d.title ?? '(untitled)').slice(0, 78)}`)
if (docs.length > 15) console.log(`  … and ${docs.length - 15} more`)

if (!confirm) {
  console.log(`\nNothing was deleted. To go ahead (PERMANENT, no undo):`)
  console.log(`  node scripts/brain-tags.mjs ${tag} --confirm`)
  process.exit(0)
}

const r = await fetch(`${API}/bulk`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ containerTags: [tag] })
})
if (!r.ok) die(`delete failed: HTTP ${r.status}`)

const left = await listDocs(key, tag)
console.log(`\nDeleted. ${left.length === 0 ? '✓ tag is now empty' : `⚠️ ${left.length} document(s) still present — re-run to retry`}`)
