# Supermemory — connector usage (for update-context)

## Tools (installed MCP connector; names may be namespaced by connection)
- **`memory`** — save/forget a fact. Params: `content` (≤200k chars), `containerTag`, `action` (`save` | `forget`). **The only write path.** No metadata / customId / isStatic.
- **`recall`** — search memories. Params: `query`, `containerTag`, `includeProfile` (default true → also returns a profile summary). **The read path** for act-and-decide.
- **`memory-graph`** — inspect the relationship graph for a container tag.
- **`listMemories`**, **`listProjects`** — enumerate.
- **`whoAmI`** — current user (`userId`, `email`). Use to derive the container tag.

## Container-tag scheme
- **One company = one Supermemory org** (the connected account).
- **v1:** a single **user-level tag** = `user_<whoAmI.userId>`. Hard-coded scheme, derived at runtime — never asked, never configured elsewhere.
- **Later (privacy — Nick's public-vs-private split):** hierarchical `org_<id>` / `org_<id>_team_<id>` / `org_<id>_team_<id>_user_<id>`. Shared facts get the higher-level tag, private facts the user tag; Supermemory isolates by tag (a user can't read another's).

## What the connector does NOT give us — and how we compensate
| Missing (HTTP-only) | What it would buy | Our compensation |
|---|---|---|
| `customId` | idempotent dedup / precise update | **`crawl_state` cursor** → never re-ingest the same window; `forget`+`save` to correct core facts |
| `metadata` | structured filter/enumerate at recall | **encode type + provenance in the content text**; recall is semantic |
| `isStatic` | flag permanent traits for the profile | **phrase durable facts durably** |
| `/v3/documents` | raw file/URL ingestion + chunking | feed **text we already read** via the tool MCPs |

## Content conventions
```
[<Type>] <entity> — <fact>. (src: <tool> <ref> <date>; <confirmed|inferred>)
```
- One fact per `save`, entity-centric. Terse and standalone — `recall` returns it verbatim.
- Types: `Person · Org · Project · Process · Tool · Goal`.
- Provenance always; `confirmed` vs `inferred`; never a deduction as certainty.

## Upgrade trigger
Noisy recall (duplicate/contradictory facts) or a need for structured filtering/enumeration → add the **HTTP API**: `POST /v3/documents` (raw content, `customId`, `metadata`) and `POST /v4/memories` (entity-centric, `isStatic`), authenticated with the Supermemory API key. Re-introduce the key in `setup.local.json` only when this trigger fires.
