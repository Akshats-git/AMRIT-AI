# AMRIT-AI

AMRIT-AI is an agentic AI framework for the AMRIT healthcare platform. It is designed to connect development agents to AMRIT knowledge sources, plan retrieval deterministically, and support multi-step software delivery workflows across the AMRIT ecosystem.

The project exists because AMRIT is spread across many repositories and domains. A useful agent for this platform needs more than a chat interface. It needs indexed repositories, structured retrieval, repeatable intent routing, and tool adapters that normalize context for different coding assistants.

## Architecture Overview

### MCP Server Layer

The MCP layer is the context acquisition plane.

- Codebase MCP Server: indexes one AMRIT repository and serves code, symbols, endpoints, and semantic search.
- Confluence MCP Server: planned connector for documentation and runbooks.
- JIRA MCP Server: planned connector for tickets, workflows, and release tracking.
- GitHub MCP Server: planned connector for repository metadata, pull requests, and issues.
- Standards MCP Server: planned connector for architecture standards, conventions, and guardrails.

### Orchestrator

The orchestrator is the deterministic control layer. Its job is to classify intent, identify entities, and choose which retrieval path to execute before a model starts generating a response.

Core responsibilities:

- Intent classification
- Entity extraction
- Retrieval planning
- Tool selection
- Context prioritization

### Skill Engine

The skill engine runs multi-step SDLC workflows. The initial skill set is intentionally broad so the framework can support the common development lifecycle end to end.

1. Repo Scoping
2. Codebase Search
3. Endpoint Discovery
4. Symbol Resolution
5. Impact Analysis
6. Retrieval Planning
7. Change Planning
8. Test Planning
9. Implementation Pipeline
10. Review and Release Readiness

### Tool Adapter Layer

Different agents format and consume context differently. The adapter layer normalizes AMRIT output for each coding surface.

- Claude Code adapter
- Cursor adapter
- Copilot adapter
- Gemini adapter

### Context Assembly

Context assembly combines the orchestrator's plan with indexed evidence, selected snippets, and any policy or standards guidance. The result is a compact, task-specific payload that can be handed to an agent without flooding it with unrelated information.

### CLI

The long-term developer interface is `amrit-ai`.

Planned commands:

- `amrit-ai index`
- `amrit-ai search`
- `amrit-ai explain`
- `amrit-ai plan`
- `amrit-ai sync`

## Current Scope

Phase 1 ships the first production-grade component of the framework: the Codebase MCP Server for `HWC-API`.

That server:

- clones the repository locally
- parses Java source files
- stores symbols, endpoints, and chunks in SQLite
- generates embeddings for semantic retrieval
- exposes MCP tools for agents and editors

## Getting Started

1. Copy `.env.example` to `.env` and add your OpenAI key.
2. Install dependencies for the codebase MCP server.
3. Run the indexer.
4. Start the MCP server.

```bash
cd mcp-servers/codebase
npm install
npm run index
npm start
```

## How to Contribute

### Add a new MCP server

1. Create a new directory under `mcp-servers/`.
2. Add a `src/index.ts` entry point and a `README.md`.
3. Keep database or connector logic isolated to that server.
4. Document the required environment variables and MCP tools.

### Add a new skill

1. Define the skill goal and the inputs it needs.
2. Add the skill implementation under `skills/`.
3. Describe the workflow steps, guardrails, and expected outputs.
4. Update the skill engine section of the architecture docs.

### Add a new standard

1. Capture the convention as a concise rule.
2. Store it under `mcp-servers/standards/` or the appropriate standards directory.
3. Add examples of compliant and non-compliant usage.
4. Reference it from the orchestrator and context assembly layers where relevant.

## Roadmap

### Phase 1

- Codebase MCP Server for HWC-API
- Local SQLite indexing and semantic retrieval
- Basic editor integrations
- Framework documentation and scaffolding

### Phase 2

- Confluence, JIRA, GitHub, and Standards MCP servers
- Deterministic orchestrator
- Tool adapters for Claude Code, Cursor, Copilot, and Gemini
- Shared context assembly pipeline

### Phase 3

- Multi-repository AMRIT retrieval
- Cross-source reasoning across code, tickets, docs, and standards
- Skill-driven delivery workflows
- CLI-first developer experience with `amrit-ai`
