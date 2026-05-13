import dotenv from "dotenv";
import Database from "better-sqlite3";
import { getDatabasePath, getOpenAIApiKey, getEmbeddingModel } from "./config.js";
import * as OpenAIImport from "openai";
// Load environment variables at the very top
dotenv.config();
async function embedChunks() {
    const db = new Database(getDatabasePath());
    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
        console.error("❌ Error: OPENAI_API_KEY is not configured");
        process.exit(1);
    }
    try {
        // Query all chunks with empty embeddings
        const chunks = db
            .prepare("SELECT id, content FROM chunks WHERE LENGTH(embedding) = 0 OR embedding IS NULL ORDER BY id")
            .all();
        console.error(`📦 Found ${chunks.length} chunks to embed`);
        if (chunks.length === 0) {
            console.error("✅ All chunks already have embeddings");
            return;
        }
        // Create OpenAI client
        const Client = OpenAIImport.default ?? OpenAIImport;
        const client = new Client({ apiKey });
        const updateStmt = db.prepare("UPDATE chunks SET embedding = ? WHERE id = ?");
        let successCount = 0;
        const batchSize = 20;
        // Process in batches
        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const batchContents = batch.map((c) => c.content);
            try {
                console.error(`🤖 Embedding batch ${Math.floor(i / batchSize) + 1} (${batch.length} chunks)...`);
                // Call OpenAI API
                const response = await client.embeddings.create({
                    model: getEmbeddingModel(),
                    input: batchContents,
                });
                // Store embeddings in database
                db.transaction(() => {
                    for (let j = 0; j < batch.length; j++) {
                        const chunk = batch[j];
                        const embedding = response.data[j]?.embedding;
                        if (!embedding) {
                            console.error(`⚠️  Chunk ${chunk.id}: No embedding returned from API`);
                            continue;
                        }
                        try {
                            const embeddingJson = JSON.stringify(embedding);
                            updateStmt.run(embeddingJson, chunk.id);
                            successCount++;
                            console.error(`✓ Embedding chunk ${successCount + i - batch.length + j + 1} / ${chunks.length}`);
                        }
                        catch (error) {
                            console.error(`⚠️  Chunk ${chunk.id}: Failed to store embedding - ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }
                })();
            }
            catch (error) {
                console.error(`⚠️  Batch ${Math.floor(i / batchSize) + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
            // Add delay between batches to avoid rate limiting
            if (i + batchSize < chunks.length) {
                console.error("⏳ Waiting 500ms before next batch...");
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        }
        console.error(`✅ Done. Embedded ${successCount} chunks successfully.`);
    }
    catch (error) {
        console.error(`❌ Fatal error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
    finally {
        db.close();
    }
}
embedChunks().catch((error) => {
    console.error(`❌ Uncaught error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
