import fs from "node:fs/promises";
import path from "node:path";
import { getRepoCacheDir } from "../config.js";
/**
 * Normalizes a repository-relative path and rejects unsafe traversal.
 */
export function resolveRepoFilePath(filePath) {
    const repoRoot = getRepoCacheDir();
    const normalizedFilePath = filePath.replaceAll("\\", "/").replace(/^\/+/, "");
    const absolutePath = path.resolve(repoRoot, normalizedFilePath);
    if (!absolutePath.startsWith(repoRoot)) {
        throw new Error("The requested file path escapes the repository root");
    }
    return { absolutePath, repoRoot };
}
/**
 * Returns repository file content with optional line range slicing.
 */
export async function getFile(args) {
    try {
        const { absolutePath } = resolveRepoFilePath(args.file_path);
        const rawContent = await fs.readFile(absolutePath, "utf8");
        const lines = rawContent.split(/\r?\n/);
        const totalLines = lines.length;
        const startLine = Math.max(1, args.start_line ?? 1);
        const endLine = Math.min(totalLines, args.end_line ?? totalLines);
        const content = lines.slice(startLine - 1, endLine).join("\n");
        return {
            content,
            total_lines: totalLines,
            repo: "HWC-API",
        };
    }
    catch (error) {
        return {
            error: "Failed to fetch file",
            details: error instanceof Error ? error.message : String(error),
        };
    }
}
