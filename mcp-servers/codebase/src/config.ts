import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from the root workspace directory
// __dirname will be dist/ at runtime, so we need to go up 3 levels: dist -> codebase -> mcp-servers -> AMRIT-AI
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../../.env");

// Load environment variables from .env
dotenv.config({ path: envPath });

/**
 * Returns the MCP server's package directory (parent of dist/).
 */
export function getPackageDir(): string {
  return path.dirname(__dirname);
}

/**
 * Returns an absolute path rooted at the MCP server's package directory.
 */
export function resolveWorkspacePath(...segments: string[]): string {
  return path.resolve(getPackageDir(), ...segments);
}

/**
 * Reads the configured HWC API repository URL.
 */
export function getRepoUrl(): string {
  return process.env.HWC_API_REPO_URL ?? "https://github.com/PSMRI/HWC-API";
}

/**
 * Returns the repository identifier used throughout the database.
 */
export function getRepoId(): string {
  return "HWC-API";
}

/**
 * Returns the local clone directory for the HWC API repository.
 */
export function getRepoCacheDir(): string {
  return resolveWorkspacePath(process.env.CACHE_DIR ?? "./.cache", getRepoId());
}

/**
 * Returns the absolute SQLite database path.
 */
export function getDatabasePath(): string {
  return resolveWorkspacePath(process.env.DB_PATH ?? "./data/amrit.db");
}

/**
 * Returns the OpenAI API key if it has been configured.
 */
export function getOpenAIApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY;
}

/**
 * Returns the embedding model name used by the indexer and search tools.
 */
export function getEmbeddingModel(): string {
  return "text-embedding-3-small";
}
