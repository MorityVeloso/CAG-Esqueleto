/**
 * Layer 3 — Cosine Similarity Calculator
 *
 * Pure math — no external dependencies.
 * Used to compare query embeddings against cached embeddings.
 */

/**
 * Calculate cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical, 0 = orthogonal).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  if (a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Find the top-K most similar vectors to a query.
 */
export function findTopK(
  query: number[],
  candidates: { id: string; embedding: number[] }[],
  k: number,
): { id: string; similarity: number }[] {
  const scored = candidates.map((c) => ({
    id: c.id,
    similarity: cosineSimilarity(query, c.embedding),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k);
}
