import { embedText } from "../embeddings.js";
import { listChunks, listRepos } from "../db.js";

/**
 * Represents the successful search response payload.
 */
export interface SearchCodeResult {
  results: Array<{
    repo: string;
    file: string;
    lines: string;
    snippet: string;
    score: number;
  }>;
}

/**
 * Represents a structured error payload returned by the tool.
 */
export interface ToolErrorResult {
  error: string;
  details?: string;
}

/**
 * Computes cosine similarity between two numeric vectors.
 * Handles embeddings that may be JSON strings or already-parsed arrays.
 */
export function cosineSimilarity(left: number[] | string, right: number[] | string): number {
  // Parse embeddings if they are JSON strings
  let leftVec: number[];
  let rightVec: number[];

  try {
    leftVec = typeof left === "string" ? JSON.parse(left) : left;
    rightVec = typeof right === "string" ? JSON.parse(right) : right;
  } catch {
    return 0;
  }

  if (leftVec.length === 0 || rightVec.length === 0 || leftVec.length !== rightVec.length) {
    return 0;
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < leftVec.length; index += 1) {
    dotProduct += leftVec[index] * rightVec[index];
    leftMagnitude += leftVec[index] * leftVec[index];
    rightMagnitude += rightVec[index] * rightVec[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

/**
 * Trims chunk content into a concise snippet for search results.
 */
export function buildSnippet(content: string, maxLines = 12): string {
  return content.split(/\r?\n/).slice(0, maxLines).join("\n");
}

/**
 * Performs semantic search over stored embeddings and returns the best matches.
 */
export async function searchCode(args: { query: string; top_k?: number }): Promise<SearchCodeResult | ToolErrorResult> {
  try {
    const topK = Math.max(1, Math.min(args.top_k ?? 5, 25));
    const queryEmbedding = await embedText(args.query);
    const repos = listRepos();
    const scoredResults: SearchCodeResult["results"] = [];

    for (const repo of repos) {
      const chunks = listChunks(repo.id);
      for (const chunk of chunks) {
        // Skip chunks without embeddings
        if (!chunk.embedding || !chunk.embedding.trim()) {
          continue;
        }

        // cosineSimilarity now handles JSON string parsing
        const score = cosineSimilarity(queryEmbedding, chunk.embedding);
        
        // Only include results with meaningful similarity scores
        if (score > 0) {
          scoredResults.push({
            repo: repo.name,
            file: chunk.file_path,
            lines: `${chunk.start_line}-${chunk.end_line}`,
            snippet: buildSnippet(chunk.content),
            score,
          });
        }
      }
    }

    return {
      results: scoredResults.sort((left, right) => right.score - left.score).slice(0, topK),
    };
  } catch (error) {
    return {
      error: "Failed to search code",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}
