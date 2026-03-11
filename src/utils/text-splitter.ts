/**
 * Text Splitter
 *
 * Intelligently splits text into chunks that respect:
 *  - Token budget limits
 *  - Sentence/paragraph boundaries
 *  - Semantic coherence
 */

import { countTokens } from './token-counter.js';

export interface TextChunk {
  content: string;
  tokens: number;
  index: number;
}

/**
 * Split text into chunks that fit within a token limit.
 * Tries to split at paragraph boundaries first, then sentences.
 */
export function splitText(text: string, maxTokensPerChunk: number, overlap = 0): TextChunk[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: TextChunk[] = [];
  let currentChunk = '';
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    const combined = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;
    const tokens = countTokens(combined);

    if (tokens <= maxTokensPerChunk) {
      currentChunk = combined;
    } else {
      // Current chunk is full — save it
      if (currentChunk) {
        chunks.push({
          content: currentChunk,
          tokens: countTokens(currentChunk),
          index: chunkIndex++,
        });
      }

      // If single paragraph exceeds limit, split by sentences
      if (countTokens(paragraph) > maxTokensPerChunk) {
        const sentenceChunks = splitBySentences(paragraph, maxTokensPerChunk);
        for (const sc of sentenceChunks) {
          chunks.push({ ...sc, index: chunkIndex++ });
        }
        currentChunk = '';
      } else {
        // Add overlap from previous chunk
        if (overlap > 0 && chunks.length > 0) {
          const lastChunk = chunks[chunks.length - 1]!;
          const overlapText = getOverlapText(lastChunk.content, overlap);
          currentChunk = overlapText ? `${overlapText}\n\n${paragraph}` : paragraph;
        } else {
          currentChunk = paragraph;
        }
      }
    }
  }

  // Don't forget the last chunk
  if (currentChunk) {
    chunks.push({
      content: currentChunk,
      tokens: countTokens(currentChunk),
      index: chunkIndex,
    });
  }

  return chunks;
}

function splitBySentences(text: string, maxTokens: number): Omit<TextChunk, 'index'>[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: Omit<TextChunk, 'index'>[] = [];
  let current = '';

  for (const sentence of sentences) {
    const combined = current ? `${current} ${sentence}` : sentence;
    if (countTokens(combined) <= maxTokens) {
      current = combined;
    } else {
      if (current) {
        chunks.push({ content: current, tokens: countTokens(current) });
      }
      current = sentence;
    }
  }

  if (current) {
    chunks.push({ content: current, tokens: countTokens(current) });
  }

  return chunks;
}

function getOverlapText(text: string, overlapTokens: number): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  let overlap = '';

  for (let i = sentences.length - 1; i >= 0; i--) {
    const candidate = sentences[i] + (overlap ? ` ${overlap}` : '');
    if (countTokens(candidate) > overlapTokens) break;
    overlap = candidate;
  }

  return overlap;
}
