import { findEndpoints } from "../db.js";
import type { EndpointRecord } from "../db.js";
import type { ToolErrorResult } from "./search_code.js";

/**
 * Returns REST endpoints from the SQLite index with an optional path filter.
 */
export async function getEndpoints(args: { path_filter?: string }): Promise<Array<{
  method: string;
  path: string;
  controller: string;
  function_name: string;
  file: string;
  line: number;
}> | ToolErrorResult> {
  try {
    const rows = findEndpoints(args.path_filter);
    return rows.map((row: EndpointRecord) => ({
      method: row.http_method,
      path: row.path,
      controller: row.controller,
      function_name: row.function_name,
      file: row.file_path,
      line: row.line_number,
    }));
  } catch (error) {
    return {
      error: "Failed to fetch endpoints",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}
