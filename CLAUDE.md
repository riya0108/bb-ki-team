# Bull or Bear AI Content Creation Team

## Mission

Build a coded, demand-driven AI content team for Bull or Bear: five platform head agents (LinkedIn, X, Instagram, YouTube Shorts, Blog) that learn Bull or Bear's voice through a persistent Content DNA model, discover topics from trusted sources, and turn source material into original, platform-native, copy-paste-ready content — never publishing without explicit human approval.

Full specification: [`docs/bull-or-bear-master-spec-v1.1.md`](docs/bull-or-bear-master-spec-v1.1.md) (source of truth for agent behavior, data schemas, output contracts, and QA rules — this file governs how we build it in this repo).

## Technology

- TypeScript
- Node.js
- PostgreSQL / Supabase (pgvector for semantic memory / Content DNA embeddings)
- MCP (Model Context Protocol) — the boundary between agents and platform connectors
- Git / GitHub
- Docker (introduced later, not at project start)

## Principles

- Human approval before irreversible actions (publishing, scheduling). Draft/ready is not approval.
- Approval attaches to an exact content version — an edit after approval invalidates it and returns the item to review.
- Never publish without approval unless an explicit, user-configured pre-authorization rule exists.
- Never fabricate facts, statistics, quotes, sources, testimonials, or personal experience.
- Every claim shown to a human or published externally must be classified: FACT / ATTRIBUTED CLAIM / INTERPRETATION / OPINION / PREDICTION / UNKNOWN — and traceable to a source where applicable.
- Never expose API keys.
- Every external action (fetch, publish, schedule) must be logged.
- Agents must have clearly defined responsibilities and must not duplicate each other.
- All important decisions (approvals, publishes, DNA changes) must be auditable.

## Architecture (summary)

- **Five head agents**, one per platform: `01-linkedin`, `02-x`, `03-instagram`, `04-youtube-shorts`, `05-blog`. Instagram additionally routes to three specialist sub-agents: Posts, Carousels, Reels.
- **Demand-driven execution.** Only the head agent (and specialists it hires) explicitly requested by the user runs. Never run all agents together; no autonomous cross-platform generation unless explicitly requested.
- **Orchestrator + worker agents**, not direct agent-to-agent calls. A head agent may hire temporary, task-scoped specialist workers (Researcher, Fact Checker, Content DNA Analyst, Script Architect, Scheduler, ...). Specialists cannot publish, cannot override the head agent's guardrails, cannot invent evidence, and cannot activate unrelated head agents.
- **MCP is the tool boundary.** Each head agent's MCP client is scoped to an explicit allowlist (its platform connector + shared read access to Brand Brain/Content DNA/sources) — enforced at the MCP layer, not just by convention.
- **Human approval is a first-class step**, modeled as an explicit state machine: `IDEA → RESEARCHED → DRAFT → IN REVIEW → CHANGES REQUESTED → APPROVED → SCHEDULED → PUBLISHED` (or `REJECTED`). No publish/schedule tool call is allowed except from a step that runs after an `approved` decision is recorded for that exact version.
- **Shared infrastructure** (Postgres-backed unless noted): Brand Brain (permanent brand identity), Content DNA (versioned, per-creator voice model), Master Source Intelligence Registry, Topic & Trend Intelligence Bank, Content Ledger, Fact Ledger, Asset Library, Learning Loop, Connector Layer (MCP), Dashboard Layer (future, out of scope until Phase 3).
- Full data schemas, output contracts (`LINKEDIN_PACKAGE`, `X_PACKAGE`, `INSTAGRAM_POST/CAROUSEL/REEL`, `YOUTUBE_SHORT`, `BLOG_PACKAGE`, `QA`, `PUBLISH_EVENT`, etc.) and the claim taxonomy live in `docs/bull-or-bear-master-spec-v1.1.md`.

## Phased Roadmap

- **Phase 1 — Foundation.** Brand Brain + Content DNA engine (schema, versioning, learning-signal rules). LinkedIn head agent: source discovery, adaptive PostCast interview, repurposing (article/PDF/video/transcript/voice note), drafting. Shared QA gate, approval state machine, and Content Ledger. No publishing/scheduling yet.
- **Phase 2 — Expansion.** X agent, Instagram head agent + its three specialists (Posts/Carousels/Reels), YouTube Shorts agent — all built on Phase 1's Content DNA, QA, and approval infrastructure. Still no publishing/scheduling.
- **Phase 3 — Publish & Surface.** Blog HTML agent, per-platform scheduling/publishing connectors (gated on recorded approval), and the dashboard/chat interface.
- Do not implement ahead of the current approved phase without explicit sign-off.
- Propose architecture/schema changes before writing code that depends on them if they diverge from what's already agreed in the spec or this file.
- This roadmap and mission are independent of any prior deleted project in this repo's history — no assumptions, code, or schema should be carried over from it.

## Code Standards

- TypeScript strict mode. No `any`; use `unknown` with narrowing or proper types.
- Validate all external input and all LLM/tool output with Zod (or equivalent) before it touches the database or another agent.
- No mocked/stubbed external services left in place after a feature is done — remove scaffolding once the real integration works.
- Structured, correlation-ID-tagged logging (`run_id` / `step_id`) — no bare `console.log` in library code.
- Config and secrets via environment variables only; never hardcoded, never committed.
- Small, composable modules over monoliths; one clear responsibility per file/module.
- Every module that touches external state (DB writes, API calls, publishing) must be testable in isolation.
- Prefer explicit, typed data contracts between workflow steps over passing loosely-shaped objects.

## Agent Rules

- One head agent = one platform. No head agent's responsibilities should overlap another's.
- Agents may only call MCP tools within their declared `tool_scope` — enforced at the MCP layer, not just by convention.
- Agents communicate through the task queue and database (structured output + enqueued next task), never through direct in-process calls to another agent.
- No agent may call a publish/schedule-type tool except from a step that runs after an approval gate has recorded an `approved` decision for that exact content version.
- Content DNA is loaded before every draft. Explicit user instruction overrides inferred Content DNA unless it violates a safety/accuracy rule. Content DNA is updated only from deliberate or repeated signals, never from a single one-off edit.
- Agent output that will be shown to humans or published externally must classify every material claim per the claim taxonomy and cite sources — no unsourced claims presented as fact, no invented statistics/quotes/sources/testimonials.

## Repository Conventions

- Monorepo: `apps/` (api, worker, scheduler, dashboard), `packages/` (core, agents, mcp-servers, db, memory, integrations, shared-types), `infra/`.
- Conventional commit messages.
- Migrations are the only way schema changes reach the database — no manual/ad-hoc schema edits.
