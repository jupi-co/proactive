#!/usr/bin/env node
// Proactive-Jupi — schema applier (shared).
//
// Neon's HTTP endpoint accepts ONE statement per call, and schema.sql contains
// dollar-quoted DO blocks whose bodies are full of semicolons. A naive
// `sql.split(";")` therefore doesn't merely fail — it silently shreds every DO
// block into fragments that each parse as garbage, and the migrations they carry
// never run. That is the whole reason this file exists rather than a one-liner in
// a skill: splitting Postgres correctly means tracking single quotes, dollar-quote
// tags, line comments and block comments, and every setup run was re-deriving it
// by hand during an unattended phase, untested.
//
// Usage:
//   node apply-schema.mjs [path/to/schema.sql]     → { applied, failed, errors[] }
//     Defaults to ./schema.sql next to this file. Connection string comes from
//     $NEON_CONN_STRING / $DATABASE_URL, or .proactive-jupi/config.local.json
//     (same resolution db.mjs uses). Exit 1 if any statement failed.
//
// Importable:  import { splitStatements, applySchema } from "./apply-schema.mjs";
//
// Idempotent by virtue of schema.sql itself (`create table if not exists`,
// `add column if not exists`, drop-then-add constraints) — re-running is safe.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Split a Postgres script into individually-executable statements.
 *
 * Semicolons only terminate a statement at the top level — inside a string
 * literal, a dollar-quoted body, or a comment they are ordinary characters.
 * We scan character by character and track which of those we're inside.
 *
 * @param {string} sql
 * @returns {string[]} statements, comments and blank runs stripped
 */
export function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- line comment: skip to end of line. Kept out of the statement text so a
    // trailing comment can't turn an otherwise-empty tail into a "statement".
    if (ch === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl;
      continue;
    }

    // /* block comment */ — Postgres nests these, so count depth.
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      continue;
    }

    // 'string literal' — '' is an escaped quote and does NOT close it.
    if (ch === "'") {
      buf += ch;
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { buf += "''"; i += 2; continue; }
        if (sql[i] === "'") { buf += "'"; i++; break; }
        buf += sql[i++];
      }
      continue;
    }

    // "quoted identifier" — same idea, "" escapes.
    if (ch === '"') {
      buf += ch;
      i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') { buf += '""'; i += 2; continue; }
        if (sql[i] === '"') { buf += '"'; i++; break; }
        buf += sql[i++];
      }
      continue;
    }

    // $tag$ … $tag$ — the case that breaks naive splitters. The tag may be empty
    // ($$) or a bare identifier ($body$); it closes only on the identical tag.
    if (ch === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) {
          // Unterminated — emit the rest verbatim and let Postgres report it,
          // rather than silently truncating the script.
          buf += sql.slice(i);
          i = n;
          continue;
        }
        buf += sql.slice(i, end + tag.length);
        i = end + tag.length;
        continue;
      }
    }

    if (ch === ";") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }

    buf += ch;
    i++;
  }

  if (buf.trim()) out.push(buf.trim());
  return out;
}

const clean = (v) => (v && !String(v).includes("<") ? v : null);

// Same resolution order as db.mjs: env first (the sanctioned path for scheduled /
// cloud runs), then the nearest .proactive-jupi/config.local.json walking up.
function resolveConnString() {
  const fromEnv = process.env.NEON_CONN_STRING || process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const p = join(dir, ".proactive-jupi", "config.local.json");
    if (existsSync(p)) {
      const cfg = JSON.parse(readFileSync(p, "utf8"));
      const cs = clean(cfg.neonConnString);
      if (cs) return cs;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(
    "no Neon connection string: set $NEON_CONN_STRING or add neonConnString to .proactive-jupi/config.local.json",
  );
}

/**
 * Apply a schema script over the HTTPS serverless driver, one statement per call.
 *
 * Continues past a failing statement rather than aborting: schema.sql is a mix of
 * fresh-install DDL and migrations, and one already-satisfied migration failing
 * should not hide the twenty-six statements that would have succeeded after it.
 * The caller decides what a non-empty `errors` means.
 *
 * @returns {Promise<{applied:number, failed:number, total:number, errors:Array<{index:number, statement:string, error:string}>}>}
 */
export async function applySchema(sql, connString) {
  if (typeof fetch === "undefined")
    throw new Error(
      `Neon's serverless driver needs a global fetch, absent on Node ${process.version}. Use Node ≥18 (e.g. \`nvm use 20\`).`,
    );
  let neon;
  try {
    ({ neon } = await import("@neondatabase/serverless"));
  } catch {
    throw new Error(
      "@neondatabase/serverless not installed — run `npm install --prefix \"${CLAUDE_PLUGIN_ROOT}/shared\" --no-save`",
    );
  }
  const run = neon(connString);
  const statements = splitStatements(sql);
  const errors = [];
  let applied = 0;

  for (let i = 0; i < statements.length; i++) {
    try {
      await run.query(statements[i]);
      applied++;
    } catch (e) {
      errors.push({
        index: i,
        statement: statements[i].slice(0, 200),
        error: String(e?.message || e),
      });
    }
  }
  return { applied, failed: errors.length, total: statements.length, errors };
}

async function main() {
  const path = resolve(process.argv[2] || join(HERE, "schema.sql"));
  if (!existsSync(path)) throw new Error(`schema file not found: ${path}`);
  const result = await applySchema(readFileSync(path, "utf8"), resolveConnString());
  process.stdout.write(JSON.stringify(result) + "\n");
  if (result.failed > 0) process.exit(1);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((e) => {
    process.stderr.write(JSON.stringify({ error: String(e?.message || e) }) + "\n");
    process.exit(1);
  });
}
