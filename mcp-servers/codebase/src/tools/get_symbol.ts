import { findSymbolsByName } from "../db.js";
import type { SymbolRecord } from "../db.js";
import type { ToolErrorResult } from "./search_code.js";

/**
 * Returns the first matching symbol for the requested class or method name.
 */
export async function getSymbol(args: { name: string }): Promise<
  | { name: string; type: string; file: string; line: number; snippet: string }
  | ToolErrorResult
> {
  try {
    const matches = findSymbolsByName(args.name);
    const bestMatch: SymbolRecord | undefined = matches.find((symbol) => symbol.name.toLowerCase() === args.name.toLowerCase()) ?? matches[0];
    if (!bestMatch) {
      return {
        error: "Symbol not found",
        details: `No symbol named ${args.name} exists in the current index`,
      };
    }

    return {
      name: bestMatch.name,
      type: bestMatch.type,
      file: bestMatch.file_path,
      line: bestMatch.line_number,
      snippet: bestMatch.snippet,
    };
  } catch (error) {
    return {
      error: "Failed to fetch symbol",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}
