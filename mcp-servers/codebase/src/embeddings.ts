import * as OpenAIImport from "openai";
import { getEmbeddingModel, getOpenAIApiKey } from "./config.js";

/**
 * Creates a configured OpenAI client for embedding generation.
 */
export function createOpenAIClient(): any {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const Client = (OpenAIImport as any).default ?? OpenAIImport;
  return new Client({ apiKey });
}

/**
 * Generates an embedding for a single text payload.
 */
export async function embedText(text: string): Promise<number[]> {
  const client = createOpenAIClient();
  const response = await client.embeddings.create({
    model: getEmbeddingModel(),
    input: text,
  });
  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error("OpenAI returned an empty embedding response");
  }

  return embedding;
}

/**
 * Generates embeddings for a list of text payloads.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    embeddings.push(await embedText(text));
  }

  return embeddings;
}
