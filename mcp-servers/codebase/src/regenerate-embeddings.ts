import Database from "better-sqlite3";
import { getDatabasePath } from "./config.js";
import { embedTexts } from "./embeddings.js";

async function regenerateEmbeddings() {
  const db = new Database(getDatabasePath());

  try {
    console.log("🔄 Fetching chunks without embeddings...");
    const chunks = db
      .prepare("SELECT id, content FROM chunks WHERE embedding = '' OR embedding IS NULL")
      .all() as Array<{ id: number; content: string }>;

    console.log(`📦 Found ${chunks.length} chunks to embed...`);

    if (chunks.length === 0) {
      console.log("✅ All chunks already have embeddings!");
      return;
    }

    // Generate embeddings for all chunks
    console.log("🤖 Generating embeddings...");
    const contents = chunks.map((c) => c.content);
    const embeddings = await embedTexts(contents);

    console.log("💾 Updating database with embeddings...");
    const updateStmt = db.prepare(
      "UPDATE chunks SET embedding = ? WHERE id = ?"
    );

    // Batch update in a transaction
    const batchSize = 100;
    db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const embedding = JSON.stringify(embeddings[i]);
        updateStmt.run(embedding, chunks[i].id);

        if ((i + 1) % batchSize === 0) {
          console.log(`  ✓ Updated ${i + 1}/${chunks.length}`);
        }
      }
    })();

    console.log("✅ All embeddings updated successfully!");
  } finally {
    db.close();
  }
}

regenerateEmbeddings().catch(console.error);
