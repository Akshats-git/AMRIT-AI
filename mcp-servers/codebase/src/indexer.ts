import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import Parser from "tree-sitter";
import Java from "tree-sitter-java";
import { simpleGit } from "simple-git";
import { getRepoCacheDir, getRepoId, getRepoUrl } from "./config.js";
import {
  ChunkInsert,
  deleteFileIndex,
  getDatabase,
  getRepoById,
  getRepoIndexCounts,
  insertChunks,
  insertEndpoints,
  insertSymbols,
  normalizeFilePath,
  SymbolInsert,
  updateRepoIndexState,
  upsertRepo,
  EndpointInsert,
} from "./db.js";
import { embedTexts } from "./embeddings.js";

interface ParsedFileData {
  symbols: SymbolInsert[];
  endpoints: EndpointInsert[];
  chunks: ChunkInsert[];
}

const CHUNK_SIZE = 50;
const CHUNK_OVERLAP = 10;

/**
 * Returns true when a file path points to a Java source file.
 */
export function isJavaFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".java");
}

/**
 * Normalizes a path separator to forward slashes for glob processing.
 */
export function normalizeGlobPath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

/**
 * Returns the repository-relative Java file glob pattern.
 */
export function getJavaGlobPattern(repoDir: string): string {
  const relativeRepoDir = normalizeGlobPath(path.relative(process.cwd(), repoDir) || repoDir);
  return `${relativeRepoDir}/src/main/java/**/*.java`;
}

/**
 * Finds all Java files in the HWC-API source tree.
 */
export async function findJavaFiles(repoDir: string): Promise<string[]> {
  const pattern = getJavaGlobPattern(repoDir);
  const files = await fg(pattern, {
    cwd: process.cwd(),
    onlyFiles: true,
    absolute: true,
    dot: false,
  });

  const normalizedFiles = files.map((filePath) => normalizeGlobPath(path.relative(repoDir, filePath)));
  console.error(`Found ${normalizedFiles.length} Java files to index`);
  return normalizedFiles;
}

/**
 * Ensures that the HWC API repository exists locally and returns its git status.
 */
export async function syncRepository(): Promise<{ repoDir: string; currentSha: string; changedFiles: string[] }> {
  const repoDir = getRepoCacheDir();
  await fs.mkdir(path.dirname(repoDir), { recursive: true });

  const git = simpleGit();
  const exists = await fs
    .access(path.join(repoDir, ".git"))
    .then(() => true)
    .catch((error) => {
      console.error("Repository cache access failed, treating as missing clone:", error);
      return false;
    });

  if (!exists) {
    await git.clone(getRepoUrl(), repoDir);
  } else {
    await git.cwd(repoDir).pull();
  }

  const repoGit = simpleGit(repoDir);
  const currentSha = (await repoGit.revparse(["HEAD"])).trim();
  const repo = getRepoById(getRepoId());
  if (!repo?.last_indexed_sha) {
    return {
      repoDir,
      currentSha,
      changedFiles: await findJavaFiles(repoDir),
    };
  }

  const diffOutput = await repoGit.diff(["--name-only", `${repo.last_indexed_sha}..${currentSha}`]);
  const changedFiles = diffOutput
    .split("\n")
    .map((line: string) => normalizeGlobPath(line.trim()))
    .filter(Boolean)
    .filter(isJavaFile);

  return {
    repoDir,
    currentSha,
    changedFiles,
  };
}

/**
 * Builds a line-based snippet around a given line number.
 */
export function getLineSnippet(lines: string[], lineNumber: number, radius = 2): string {
  const startIndex = Math.max(0, lineNumber - 1 - radius);
  const endIndex = Math.min(lines.length, lineNumber + radius);
  return lines.slice(startIndex, endIndex).join("\n");
}

/**
 * Returns the nearest enclosing type declaration name for a node.
 */
export function findEnclosingTypeName(node: any): string {
  let current = node.parent;
  while (current) {
    if (
      current.type === "class_declaration" ||
      current.type === "interface_declaration" ||
      current.type === "enum_declaration" ||
      current.type === "annotation_type_declaration"
    ) {
      const nameNode = current.childForFieldName("name");
      return nameNode?.text ?? "UnknownController";
    }
    current = current.parent;
  }
  return "UnknownController";
}

/**
 * Extracts an annotation name from a raw annotation node string.
 */
export function getAnnotationName(annotationText: string): string {
  const match = annotationText.match(/@([A-Za-z0-9_$.]+)/);
  return match?.[1] ?? annotationText;
}

/**
 * Normalizes a path segment so it can be safely combined with another path segment.
 */
export function normalizeEndpointPath(basePath: string, routePath: string): string {
  const normalizedBasePath = basePath.trim();
  const normalizedRoutePath = routePath.trim();

  if (!normalizedBasePath && !normalizedRoutePath) {
    return "";
  }

  if (!normalizedBasePath) {
    return normalizedRoutePath;
  }

  if (!normalizedRoutePath) {
    return normalizedBasePath;
  }

  return `${normalizedBasePath.replace(/\/+$/, "")}/${normalizedRoutePath.replace(/^\/+/, "")}`.replace(/\/+/g, "/");
}

/**
 * Extracts request mapping paths from a mapping annotation body.
 */
export function extractMappingPaths(annotationArguments: string): string[] {
  const cleanedArguments = annotationArguments.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim();
  if (!cleanedArguments) {
    return [""];
  }

  const explicitPathMatch = cleanedArguments.match(/\b(?:value|path)\s*=\s*(\{[\s\S]*\}|"[^"]+"|'[^']+')/);
  const directArgumentMatch = cleanedArguments.match(/^(\{[\s\S]*\}|"[^"]+"|'[^']+')$/);
  const target = explicitPathMatch?.[1] ?? directArgumentMatch?.[1];

  if (!target) {
    return [""];
  }

  const paths = Array.from(target.matchAll(/"([^"]+)"|'([^']+)'/g))
    .map((match) => (match[1] ?? match[2] ?? "").trim())
    .filter(Boolean);

  return paths.length > 0 ? paths : [""];
}

/**
 * Parses a mapping annotation and returns its method name and paths.
 */
export function parseMappingAnnotation(annotationText: string): { method: string; paths: string[] } | null {
  const annotationMatch = annotationText.match(/@(GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping)\s*\(([\s\S]*?)\)/);
  if (!annotationMatch) {
    return null;
  }

  return {
    method: annotationMatch[1],
    paths: extractMappingPaths(annotationMatch[2]),
  };
}

/**
 * Returns class-level request mapping base paths for a controller type.
 */
export function extractClassBasePaths(node: any, sourceText: string): string[] {
  const annotations = (node.children ?? []).filter((child: any) => child.type === "annotation");
  const paths: string[] = [];

  for (const annotation of annotations) {
    const annotationText = sourceText.slice(annotation.startIndex, annotation.endIndex);
    const parsed = parseMappingAnnotation(annotationText);
    if (parsed?.method === "RequestMapping") {
      paths.push(...parsed.paths);
    }
  }

  return paths.length > 0 ? paths : [""];
}

/**
 * Falls back to a file-level class RequestMapping lookup when AST annotation lookup is incomplete.
 */
export function extractClassBasePathsFromSource(sourceText: string): string[] {
  const classMappingRegex = /@RequestMapping\s*\(([\s\S]*?)\)\s*(?:public|protected|private|abstract|final|static|\s)*class\s+[A-Za-z0-9_]+/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = classMappingRegex.exec(sourceText)) !== null) {
    matches.push(...extractMappingPaths(match[1]));
  }

  return matches.length > 0 ? matches : [""];
}

/**
 * Parses REST endpoint metadata from a method declaration node.
 */
export function parseEndpointsFromMethod(node: any, sourceText: string, basePaths: string[], relativeFilePath: string): EndpointInsert[] {
  const annotations = (node.children ?? []).filter((child: any) => child.type === "annotation");
  const methodName = node.childForFieldName("name")?.text ?? "unknownMethod";
  const controller = findEnclosingTypeName(node);
  const lineNumber = node.startPosition.row + 1;
  const endpoints: EndpointInsert[] = [];

  for (const annotation of annotations) {
    const annotationText = sourceText.slice(annotation.startIndex, annotation.endIndex);
    const parsed = parseMappingAnnotation(annotationText);
    if (!parsed || parsed.method === "RequestMapping" && parsed.paths.length === 0) {
      continue;
    }

    const httpMethod = parsed.method === "RequestMapping" ? "ANY" : parsed.method.replace("Mapping", "").toUpperCase();
    const resolvedPaths = parsed.paths.length > 0 ? parsed.paths : [""];

    for (const basePath of basePaths) {
      for (const routePath of resolvedPaths) {
        endpoints.push({
          repoId: getRepoId(),
          httpMethod,
          path: normalizeEndpointPath(basePath, routePath),
          controller,
          functionName: methodName,
          filePath: relativeFilePath,
          lineNumber,
        });
      }
    }
  }

  return endpoints;
}

/**
 * Extracts REST endpoints from the text around a method declaration when AST annotation lookup is unreliable.
 */
export function extractEndpointsFromSourceWindow(
  lines: string[],
  methodLineNumber: number,
  controller: string,
  methodName: string,
  relativeFilePath: string,
  basePaths: string[] = [""],
): EndpointInsert[] {
  const windowStart = Math.max(0, methodLineNumber - 30);
  const windowText = lines.slice(windowStart, methodLineNumber).join("\n");
  const endpoints: EndpointInsert[] = [];
  const endpointRegex = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping)\s*\(([\s\S]*?)\)/g;
  let match: RegExpExecArray | null;

  while ((match = endpointRegex.exec(windowText)) !== null) {
    const annotation = match[1];
    const parsedPaths = extractMappingPaths(match[2]);
    const httpMethod = annotation === "RequestMapping" ? "ANY" : annotation.replace("Mapping", "").toUpperCase();

    for (const basePath of basePaths) {
      for (const routePath of parsedPaths) {
        endpoints.push({
          repoId: getRepoId(),
          httpMethod,
          path: normalizeEndpointPath(basePath, routePath),
          controller,
          functionName: methodName,
          filePath: relativeFilePath,
          lineNumber: methodLineNumber,
        });
      }
    }
  }

  return endpoints;
}

/**
 * Extracts symbols and endpoints from a parsed Java syntax tree.
 */
export function extractSymbolsAndEndpoints(sourceText: string, lines: string[], relativeFilePath: string, tree: any): {
  symbols: SymbolInsert[];
  endpoints: EndpointInsert[];
} {
  const symbols: SymbolInsert[] = [];
  const endpoints: EndpointInsert[] = [];

  const visit = (node: any, inheritedBasePaths: string[] = [""]): void => {
    let currentBasePaths = inheritedBasePaths;

    if (
      node.type === "class_declaration" ||
      node.type === "interface_declaration" ||
      node.type === "enum_declaration" ||
      node.type === "annotation_type_declaration"
    ) {
      const typeName = node.childForFieldName("name")?.text ?? "UnknownType";
      const lineNumber = node.startPosition.row + 1;
      symbols.push({
        repoId: getRepoId(),
        name: typeName,
        type: node.type === "class_declaration" ? "class" : node.type === "interface_declaration" ? "interface" : node.type === "enum_declaration" ? "enum" : "class",
        filePath: relativeFilePath,
        lineNumber,
        snippet: getLineSnippet(lines, lineNumber),
      });

      currentBasePaths = extractClassBasePaths(node, sourceText);
      if (currentBasePaths.length === 0 || (currentBasePaths.length === 1 && currentBasePaths[0] === "")) {
        currentBasePaths = extractClassBasePathsFromSource(sourceText);
      }
    }

    if (node.type === "method_declaration" || node.type === "constructor_declaration") {
      const nameNode = node.childForFieldName("name");
      const methodName = nameNode?.text ?? "unknownMethod";
      const lineNumber = node.startPosition.row + 1;
      symbols.push({
        repoId: getRepoId(),
        name: methodName,
        type: "method",
        filePath: relativeFilePath,
        lineNumber,
        snippet: getLineSnippet(lines, lineNumber),
      });

      const methodEndpoints = parseEndpointsFromMethod(node, sourceText, currentBasePaths, relativeFilePath);
      const windowEndpoints = extractEndpointsFromSourceWindow(lines, lineNumber, findEnclosingTypeName(node), methodName, relativeFilePath, currentBasePaths);
      const dedupedEndpoints = new Map<string, EndpointInsert>();

      for (const endpoint of [...methodEndpoints, ...windowEndpoints]) {
        const key = `${endpoint.httpMethod}|${endpoint.path}|${endpoint.controller}|${endpoint.functionName}|${endpoint.filePath}|${endpoint.lineNumber}`;
        dedupedEndpoints.set(key, endpoint);
      }

      endpoints.push(...dedupedEndpoints.values());
    }

    for (const child of node.namedChildren ?? []) {
      visit(child, currentBasePaths);
    }
  };

  visit(tree.rootNode);
  return { symbols, endpoints };
}

/**
 * Builds fixed-size overlapping chunks for semantic search.
 */
export function buildChunks(lines: string[], relativeFilePath: string): ChunkInsert[] {
  const chunks: ChunkInsert[] = [];
  const step = Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP);

  for (let startIndex = 0; startIndex < lines.length; startIndex += step) {
    const endIndex = Math.min(lines.length, startIndex + CHUNK_SIZE);
    const content = lines.slice(startIndex, endIndex).join("\n");
    if (!content.trim()) {
      continue;
    }

    chunks.push({
      repoId: getRepoId(),
      filePath: relativeFilePath,
      startLine: startIndex + 1,
      endLine: endIndex,
      content,
      embedding: "",
    });

    if (endIndex >= lines.length) {
      break;
    }
  }

  return chunks;
}

/**
 * Parses symbols, endpoints, and chunks from a Java source file.
 */
export async function parseJavaFile(repoDir: string, relativeFilePath: string): Promise<ParsedFileData> {
  const absolutePath = path.join(repoDir, relativeFilePath);
  const sourceText = await fs.readFile(absolutePath, "utf8");
  const lines = sourceText.split(/\r?\n/);
  console.error(`Parsed: ${relativeFilePath}`);

  const parser = new Parser();
  parser.setLanguage(Java);
  console.error("Tree-sitter parser initialized successfully");
  const tree = parser.parse(sourceText);

  const { symbols, endpoints } = extractSymbolsAndEndpoints(sourceText, lines, relativeFilePath, tree);
  console.error(`Found ${symbols.length} symbols in ${relativeFilePath}`);
  console.error(`Found ${endpoints.length} endpoints in ${relativeFilePath}`);

  const chunks = buildChunks(lines, relativeFilePath);
  console.error(`Created ${chunks.length} chunks for ${relativeFilePath}`);

  try {
    const embeddings = chunks.length > 0 ? await embedTexts(chunks.map((chunk) => chunk.content)) : [];
    return {
      symbols,
      endpoints,
      chunks: chunks.map((chunk, index) => ({
        ...chunk,
        embedding: embeddings[index] ?? "",
      })),
    };
  } catch (error) {
    console.error(`Embedding generation failed for ${relativeFilePath}:`, error);
    return {
      symbols,
      endpoints,
      chunks,
    };
  }
}

/**
 * Reindexes a single Java file by replacing any previous rows for that file.
 */
export async function reindexFile(repoDir: string, filePath: string): Promise<ParsedFileData> {
  const normalizedFilePath = normalizeFilePath(filePath);
  deleteFileIndex(getRepoId(), normalizedFilePath);
  const parsed = await parseJavaFile(repoDir, normalizedFilePath);
  insertSymbols(parsed.symbols);
  insertEndpoints(parsed.endpoints);
  insertChunks(parsed.chunks);
  return parsed;
}

/**
 * Runs the full indexing flow for the HWC API repository.
 */
export async function runIndexer(): Promise<void> {
  getDatabase();
  const repoId = getRepoId();
  upsertRepo({
    id: repoId,
    name: repoId,
    url: getRepoUrl(),
    last_indexed_sha: null,
    indexed_at: null,
  });

  const syncResult = await syncRepository();
  const repo = getRepoById(repoId);
  const currentSha = syncResult.currentSha;
  const indexCounts = getRepoIndexCounts(repoId);
  const needsFullReindex = indexCounts.symbols === 0 || indexCounts.endpoints === 0 || indexCounts.chunks === 0;
  const changedFiles = new Set(syncResult.changedFiles.map((filePath) => normalizeGlobPath(filePath)));

  if (repo?.last_indexed_sha && changedFiles.size === 0 && !needsFullReindex) {
    updateRepoIndexState(repoId, currentSha, new Date().toISOString());
    console.error("Indexing complete: 0 symbols, 0 endpoints, 0 chunks");
    return;
  }

  if (repo?.last_indexed_sha && !needsFullReindex) {
    const git = simpleGit(syncResult.repoDir);
    const diffOutput = await git.diff(["--name-only", `${repo.last_indexed_sha}..${currentSha}`]);
    for (const line of diffOutput.split("\n")) {
      const normalized = normalizeGlobPath(line.trim());
      if (normalized) {
        changedFiles.add(normalized);
      }
    }
  }

  const filesToIndex = Array.from(needsFullReindex ? new Set(await findJavaFiles(syncResult.repoDir)) : changedFiles).filter(isJavaFile);
  console.error(`Found ${filesToIndex.length} Java files to index`);

  let totalSymbols = 0;
  let totalEndpoints = 0;
  let totalChunks = 0;

  for (const filePath of filesToIndex) {
    const absolutePath = path.join(syncResult.repoDir, filePath);
    try {
      await fs.access(absolutePath);
      const parsed = await reindexFile(syncResult.repoDir, filePath);
      totalSymbols += parsed.symbols.length;
      totalEndpoints += parsed.endpoints.length;
      totalChunks += parsed.chunks.length;
    } catch (error) {
      console.error(`Failed to index ${filePath}:`, error);
      deleteFileIndex(repoId, filePath);
    }
  }

  updateRepoIndexState(repoId, currentSha, new Date().toISOString());
  console.error(`Indexing complete: ${totalSymbols} symbols, ${totalEndpoints} endpoints, ${totalChunks} chunks`);
}

/**
 * Executes the indexer when the file is run directly.
 */
export async function main(): Promise<void> {
  await runIndexer();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Indexing failed:", error);
    process.exitCode = 1;
  });
}
