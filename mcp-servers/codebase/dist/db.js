import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getDatabasePath } from "./config.js";
let database = null;
/**
 * Opens the SQLite database and creates the schema if necessary.
 */
export function getDatabase() {
    if (database) {
        return database;
    }
    const dbPath = getDatabasePath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    database = new Database(dbPath);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    initializeSchema(database);
    return database;
}
/**
 * Creates all database tables required by the codebase server.
 */
export function initializeSchema(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      last_indexed_sha TEXT,
      indexed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line_number INTEGER NOT NULL,
      snippet TEXT NOT NULL,
      FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id TEXT NOT NULL,
      http_method TEXT NOT NULL,
      path TEXT NOT NULL,
      controller TEXT NOT NULL,
      function_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line_number INTEGER NOT NULL,
      FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_symbols_repo_name ON symbols(repo_id, name);
    CREATE INDEX IF NOT EXISTS idx_symbols_repo_file ON symbols(repo_id, file_path);
    CREATE INDEX IF NOT EXISTS idx_endpoints_repo_path ON endpoints(repo_id, path);
    CREATE INDEX IF NOT EXISTS idx_chunks_repo_file ON chunks(repo_id, file_path);
  `);
}
/**
 * Ensures that the repository row exists before indexing starts.
 */
export function upsertRepo(repo) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO repos (id, name, url, last_indexed_sha, indexed_at)
      VALUES (@id, @name, @url, @last_indexed_sha, @indexed_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        url = excluded.url,
        last_indexed_sha = COALESCE(excluded.last_indexed_sha, repos.last_indexed_sha),
        indexed_at = COALESCE(excluded.indexed_at, repos.indexed_at)
    `).run(repo);
}
/**
 * Returns the repository row for the requested repository identifier.
 */
export function getRepoById(repoId) {
    const db = getDatabase();
    return db.prepare("SELECT * FROM repos WHERE id = ?").get(repoId);
}
/**
 * Returns all repository rows stored in SQLite.
 */
export function listRepos() {
    const db = getDatabase();
    return db.prepare("SELECT * FROM repos ORDER BY indexed_at DESC").all();
}
/**
 * Updates the last indexed SHA and timestamp for a repository.
 */
export function updateRepoIndexState(repoId, sha, indexedAt) {
    const db = getDatabase();
    db.prepare(`
      UPDATE repos
      SET last_indexed_sha = ?, indexed_at = ?
      WHERE id = ?
    `).run(sha, indexedAt, repoId);
}
/**
 * Removes all indexed rows for a specific file within a repository.
 */
export function deleteFileIndex(repoId, filePath) {
    const db = getDatabase();
    const normalizedFilePath = normalizeFilePath(filePath);
    db.prepare("DELETE FROM symbols WHERE repo_id = ? AND file_path = ?").run(repoId, normalizedFilePath);
    db.prepare("DELETE FROM endpoints WHERE repo_id = ? AND file_path = ?").run(repoId, normalizedFilePath);
    db.prepare("DELETE FROM chunks WHERE repo_id = ? AND file_path = ?").run(repoId, normalizedFilePath);
}
/**
 * Inserts a batch of symbols into SQLite.
 */
export function insertSymbols(symbols) {
    if (symbols.length === 0) {
        return;
    }
    const db = getDatabase();
    const statement = db.prepare(`
      INSERT INTO symbols (repo_id, name, type, file_path, line_number, snippet)
      VALUES (@repoId, @name, @type, @filePath, @lineNumber, @snippet)
    `);
    const transaction = db.transaction((rows) => {
        for (const row of rows) {
            statement.run(row);
        }
    });
    transaction(symbols);
}
/**
 * Inserts a batch of REST endpoints into SQLite.
 */
export function insertEndpoints(endpoints) {
    if (endpoints.length === 0) {
        return;
    }
    const db = getDatabase();
    const statement = db.prepare(`
      INSERT INTO endpoints (repo_id, http_method, path, controller, function_name, file_path, line_number)
      VALUES (@repoId, @httpMethod, @path, @controller, @functionName, @filePath, @lineNumber)
    `);
    const transaction = db.transaction((rows) => {
        for (const row of rows) {
            statement.run(row);
        }
    });
    transaction(endpoints);
}
/**
 * Inserts a batch of content chunks and embeddings into SQLite.
 */
export function insertChunks(chunks) {
    if (chunks.length === 0) {
        return;
    }
    const db = getDatabase();
    const statement = db.prepare(`
      INSERT INTO chunks (repo_id, file_path, start_line, end_line, content, embedding)
      VALUES (@repoId, @filePath, @startLine, @endLine, @content, @embedding)
    `);
    const transaction = db.transaction((rows) => {
        for (const row of rows) {
            statement.run({
                ...row,
                embedding: typeof row.embedding === "string" ? row.embedding : JSON.stringify(row.embedding),
            });
        }
    });
    transaction(chunks);
}
/**
 * Returns all stored chunks for a repository.
 */
export function listChunks(repoId) {
    const db = getDatabase();
    return db.prepare("SELECT * FROM chunks WHERE repo_id = ? ORDER BY file_path, start_line").all(repoId);
}
/** * Returns the number of indexed symbols, endpoints, and chunks for a repository.
 */
export function getRepoIndexCounts(repoId) {
    const db = getDatabase();
    const symbols = db.prepare("SELECT COUNT(*) AS count FROM symbols WHERE repo_id = ?").get(repoId);
    const endpoints = db.prepare("SELECT COUNT(*) AS count FROM endpoints WHERE repo_id = ?").get(repoId);
    const chunks = db.prepare("SELECT COUNT(*) AS count FROM chunks WHERE repo_id = ?").get(repoId);
    return {
        symbols: symbols.count,
        endpoints: endpoints.count,
        chunks: chunks.count,
    };
}
/** * Returns all symbols that match the requested name.
 */
export function findSymbolsByName(name) {
    const db = getDatabase();
    return db.prepare("SELECT * FROM symbols WHERE name = ? COLLATE NOCASE ORDER BY line_number ASC").all(name);
}
/**
 * Returns all endpoints that optionally match a path pattern.
 */
export function findEndpoints(pathFilter) {
    const db = getDatabase();
    if (!pathFilter) {
        return db.prepare("SELECT * FROM endpoints ORDER BY file_path, line_number").all();
    }
    const pattern = `%${pathFilter}%`;
    return db.prepare("SELECT * FROM endpoints WHERE path LIKE ? ORDER BY file_path, line_number").all(pattern);
}
/**
 * Returns all chunks for a file path within a repository.
 */
export function listChunksByFile(repoId, filePath) {
    const db = getDatabase();
    const normalizedFilePath = normalizeFilePath(filePath);
    return db.prepare("SELECT * FROM chunks WHERE repo_id = ? AND file_path = ? ORDER BY start_line").all(repoId, normalizedFilePath);
}
/**
 * Converts a file path into a normalized repository-relative path.
 */
export function normalizeFilePath(filePath) {
    return filePath.replaceAll("\\", "/").replace(/^\/+/, "");
}
