# Codebase MCP Server

This MCP server indexes the AMRIT HWC-API repository into SQLite and exposes retrieval tools that agentic IDEs and coding assistants can call over the Model Context Protocol.

## What this server does

- Clones `https://github.com/PSMRI/HWC-API` into a local cache directory.
- Parses Java source files with `tree-sitter-java`.
- Stores classes, methods, REST endpoints, and file chunks in SQLite.
- Generates OpenAI embeddings with `text-embedding-3-small` for semantic search.
- Tracks the last indexed commit SHA so subsequent runs only process changed files.
- Exposes four MCP tools: `search_code`, `get_endpoints`, `get_symbol`, and `get_file`.

## Prerequisites

- Node.js 18 or newer
- `OPENAI_API_KEY`
- Git access to `https://github.com/PSMRI/HWC-API`

## Setup

1. Copy the root `.env.example` file to `.env` and set `OPENAI_API_KEY`.
2. Install dependencies.
3. Run the indexer.
4. Start the MCP server.

```bash
cd mcp-servers/codebase
npm install
npm run index
npm start
```

## Configuration

The server reads these environment variables from `.env`:

- `OPENAI_API_KEY` - required for embeddings.
- `HWC_API_REPO_URL` - repository to clone and index.
- `CACHE_DIR` - local clone and cache root.
- `DB_PATH` - SQLite database path.

## Tools

### `search_code`

Searches the indexed codebase with semantic similarity.

Input:

```json
{
  "query": "where is patient registration validated?",
  "top_k": 3
}
```

Output:

```json
{
  "results": [
    {
      "repo": "HWC-API",
      "file": "src/main/java/.../PatientService.java",
      "lines": "120-279",
      "snippet": "public void validatePatient(...) { ... }",
      "score": 0.87
    }
  ]
}
```

### `get_endpoints`

Returns indexed REST endpoints and can optionally filter by path substring.

Input:

```json
{
  "path_filter": "/patient"
}
```

Output:

```json
[
  {
    "method": "GET",
    "path": "/patient/{id}",
    "controller": "PatientController",
    "function_name": "getPatientById",
    "file": "src/main/java/.../PatientController.java",
    "line": 42
  }
]
```

### `get_symbol`

Looks up a class or method name in the symbol table.

Input:

```json
{
  "name": "PatientController"
}
```

Output:

```json
{
  "name": "PatientController",
  "type": "class",
  "file": "src/main/java/.../PatientController.java",
  "line": 18,
  "snippet": "public class PatientController { ... }"
}
```

### `get_file`

Returns file content from the local clone, optionally restricted to a line range.

Input:

```json
{
  "file_path": "src/main/java/.../PatientController.java",
  "start_line": 1,
  "end_line": 120
}
```

Output:

```json
{
  "content": "package ...",
  "total_lines": 312,
  "repo": "HWC-API"
}
```

## Running the indexer

The indexer clones or refreshes the local HWC-API checkout, computes diffs against the last indexed SHA, and reprocesses only changed files.

```bash
cd mcp-servers/codebase
npm run index
```

## Connecting to Claude Code

Add this MCP server to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "amrit-codebase": {
      "command": "node",
      "args": ["--loader", "ts-node/esm", "src/index.ts"],
      "cwd": "/absolute/path/to/AMRIT-AI/mcp-servers/codebase",
      "env": {
        "OPENAI_API_KEY": "your_openai_api_key_here",
        "HWC_API_REPO_URL": "https://github.com/PSMRI/HWC-API",
        "CACHE_DIR": "./.cache",
        "DB_PATH": "./data/amrit.db"
      }
    }
  }
}
```

## Connecting to Cursor

Use the same MCP command configuration in Cursor's MCP settings:

```json
{
  "mcpServers": {
    "amrit-codebase": {
      "command": "node",
      "args": ["--loader", "ts-node/esm", "src/index.ts"],
      "cwd": "/absolute/path/to/AMRIT-AI/mcp-servers/codebase",
      "env": {
        "OPENAI_API_KEY": "your_openai_api_key_here"
      }
    }
  }
}
```

If you prefer Docker, run the root `docker-compose.yml` and point Cursor or Claude Code at the container command instead of the local Node process.
