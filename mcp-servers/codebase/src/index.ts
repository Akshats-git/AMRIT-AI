import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDatabase } from "./db.js";
import { getEndpoints } from "./tools/get_endpoints.js";
import { getFile } from "./tools/get_file.js";
import { getSymbol } from "./tools/get_symbol.js";
import { searchCode } from "./tools/search_code.js";

/**
 * Wraps a payload in the text content structure expected by MCP.
 */
export function toTextResult(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

/**
 * Starts the AMRIT codebase MCP server and registers all tools.
 */
export async function startServer(): Promise<void> {
  getDatabase();
  const server = new McpServer({
    name: "amrit-codebase",
    version: "1.0.0",
  });

  server.tool(
    "search_code",
    {
      query: z.string(),
      top_k: z.number().int().positive().optional(),
    },
    async (args) => toTextResult(await searchCode({ query: args.query, top_k: args.top_k })),
  );

  server.tool(
    "get_endpoints",
    {
      path_filter: z.string().optional(),
    },
    async (args) => toTextResult(await getEndpoints({ path_filter: args.path_filter })),
  );

  server.tool(
    "get_symbol",
    {
      name: z.string(),
    },
    async (args) => toTextResult(await getSymbol({ name: args.name })),
  );

  server.tool(
    "get_file",
    {
      file_path: z.string(),
      start_line: z.number().int().positive().optional(),
      end_line: z.number().int().positive().optional(),
    },
    async (args) => toTextResult(await getFile({ file_path: args.file_path, start_line: args.start_line, end_line: args.end_line })),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Runs the MCP server when the module is executed directly.
 */
export async function main(): Promise<void> {
  await startServer();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Server failed to start:", error);
    process.exitCode = 1;
  });
}
