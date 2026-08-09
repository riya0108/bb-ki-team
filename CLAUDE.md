# AI Company OS

## Mission

Build an autonomous AI-powered company operating system: a set of AI departments (Executive, Research, Marketing, Sales, Content, Trend Research, SEO, Blog, Social, Design, Operations, Analytics) that collaborate through defined workflows to run real business functions, starting with content publishing.

## Technology

- TypeScript
- Node.js
- PostgreSQL / Supabase (pgvector for semantic memory)
- MCP (Model Context Protocol) — the boundary between agents and tools
- Git / GitHub
- Docker (introduced later, not at project start)

## Principles

- Human approval before irreversible actions
- Never publish without approval unless explicitly authorized
- Never fabricate facts
- Never expose API keys
- Every external action must be logged
- Agents must have clearly defined responsibilities
- Agents should not duplicate responsibilities
- All important decisions should be auditable

## Architecture (summary)

- **Orchestrator + worker agents**, not direct agent-to-agent calls. A Workflow Engine owns run state; a task queue dispatches work to department agent workers.
- **MCP is the tool boundary.** Agents call tools only through MCP clients scoped to an explicit allowlist per agent — this is the primary enforcement mechanism for "agents can't do things outside their department."
- **Human approval is a first-class workflow step**, not a special case. A workflow pauses and waits for an external decision before any irreversible step (e.g., publishing) can run.
- First production workflow: Research → SEO analysis → Blog creation → Fact checking → Human approval → WordPress publishing.
- Full architecture proposal (folder structure, DB schema, agent/MCP design, phased roadmap) lives in conversation history until formalized into `docs/architecture.md`.

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

- One agent = one department. No agent's responsibilities should overlap another's.
- Agents may only call MCP tools within their declared `tool_scope` — enforced at the MCP layer, not just by convention.
- Agents communicate through the task queue and database (structured output + enqueued next task), never through direct in-process calls to another agent.
- No agent may call a publish/send/pay-type tool except from a workflow step that runs after an approval gate has recorded an `approved` decision.
- Agent output that will be shown to humans or published externally must cite sources / be traceable back to source data — no unsourced claims presented as fact.

## Development Process

- Do not implement ahead of the current approved phase without explicit sign-off.
- Follow the phased roadmap (foundation → workflow engine → first agent → chained agents → approval gate → publishing → hardening → expansion) rather than building departments in parallel early on.
- Propose architecture/schema changes before writing code that depends on them if they diverge from what's already been agreed.

## Repository Conventions

- Monorepo: `apps/` (api, worker, scheduler, dashboard), `packages/` (core, agents, mcp-servers, db, memory, integrations, shared-types), `infra/`.
- Conventional commit messages.
- Migrations are the only way schema changes reach the database — no manual/ad-hoc schema edits.
