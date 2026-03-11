# CAG-Esqueleto

### 5-Layer Context Engineering Module

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Claude API](https://img.shields.io/badge/Claude-Sonnet%204-purple.svg)](https://docs.anthropic.com/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)

> Modulo reutilizavel que substitui RAG tradicional por uma arquitetura de 5 camadas baseada em **Cache-Augmented Generation (CAG)**.

Inspirado no [RAG-Esqueleto](https://github.com/MorityVeloso/RAG-Esqueleto), mas com um paradigma fundamentalmente diferente: em vez de buscar documentos a cada query, o CAG pre-carrega contexto no cache do modelo, resultando em respostas **40x mais rapidas** e **90% mais baratas**.

---

## Por que CAG ao inves de RAG?

| Aspecto | RAG Tradicional | CAG (Este Modulo) |
|---------|----------------|-------------------|
| **Latencia** | 500-2000ms (embedding + busca + LLM) | **10-50ms** (cache hit) |
| **Custo por query** | $0.01-0.05 (embedding + LLM) | **$0.001-0.005** (cache read) |
| **Acuracia** | Depende da qualidade do retrieval | **Superior** (contexto completo no prompt) |
| **Complexidade** | Vector DB + embedding pipeline | **Simples** (cache nativo da API) |
| **Atualizacao** | Re-indexar documentos | **Snapshots comprimidos** com TTL |
| **Cold start** | Lento (precisa indexar) | **Rapido** (cache criado na 1a chamada) |

### Quando usar CAG vs RAG?

- **CAG**: Conhecimento < 200K tokens, dados semi-estaticos, chatbots, FAQ, atendimento
- **RAG**: Corpus > 1M docs, busca em tempo real, dados altamente dinamicos

---

## Arquitetura de 5 Camadas

```
┌─────────────────────────────────────────────────────────────────┐
│                        CAG Engine                               │
│                   (Orchestrates all layers)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  L1: Static   │  │  L2: Dynamic  │  │  L3: Semantic Cache   │ │
│  │  CAG Cache    │  │  Snapshots    │  │  (Query-Response)     │ │
│  │              │  │              │  │                       │ │
│  │  Prompt      │  │  Compressed   │  │  Embedding-based      │ │
│  │  Caching     │  │  + TTL        │  │  similarity matching  │ │
│  │  (Anthropic) │  │  + Scheduler  │  │  Biggest cost saver!  │ │
│  └──────────────┘  └──────────────┘  └───────────────────────┘ │
│                                                                 │
│  ┌──────────────────┐  ┌────────────────────────────────────┐  │
│  │  L4: Think Tool   │  │  L5: Curated Knowledge (ACE)       │  │
│  │                   │  │                                    │  │
│  │  Extended         │  │  Auto-prioritization               │  │
│  │  thinking for     │  │  Self-managing knowledge base      │  │
│  │  complex queries  │  │  Usage tracking + decay + eviction │  │
│  └──────────────────┘  └────────────────────────────────────┘  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Adapters: Anthropic | Supabase | Redis                         │
│  Analytics: Daily stats | Savings report | Cost projection      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Install

```bash
npm install cag-esqueleto
```

### 2. Use

```typescript
import { createCAG } from 'cag-esqueleto';

const cag = await createCAG({
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
  layers: {
    staticCAG: {
      sources: [
        {
          id: 'rules',
          name: 'Business Rules',
          type: 'text',
          content: 'Return policy: 30 days full refund.',
          category: 'rules',
          priority: 10,
        },
      ],
    },
    dynamicCAG: {
      snapshotFn: async () => 'Current inventory: 500 units in stock.',
    },
  },
});

// Query — uses all 5 layers automatically
const response = await cag.query({ message: 'What is your return policy?' });
console.log(response.answer);
console.log(`Cost: $${response.usage.estimatedCost.toFixed(4)}`);
console.log(`Cache hit: ${response.cacheHit}`);

// Teach new knowledge (Layer 5 — ACE)
await cag.teach(
  'Customer John always requests 5% discount',
  'client_preferences',
  ['john', 'discount'],
);

// Similar query → Semantic Cache hit (zero API cost)
const response2 = await cag.query({ message: 'Tell me about the return policy' });
console.log(`Cache hit: ${response2.cacheHit}`); // true!

await cag.shutdown();
```

Only `anthropic.apiKey` is required — all other settings have sensible defaults via Zod validation.

---

## Configuration

All configuration is optional except `anthropic.apiKey`. Defaults are shown below:

| Setting | Default | Description |
|---------|---------|-------------|
| `anthropic.model` | `'claude-sonnet-4-20250514'` | Claude model to use |
| `anthropic.maxTokens` | `4096` | Max output tokens per query |
| `anthropic.maxRetries` | `2` | API retry attempts |
| `layers.staticCAG.enabled` | `true` | Enable static context layer |
| `layers.staticCAG.sources` | `[]` | Knowledge sources (text, file, url) |
| `layers.dynamicCAG.enabled` | `true` | Enable dynamic snapshots |
| `layers.dynamicCAG.ttl` | `300` | Snapshot TTL in seconds |
| `layers.dynamicCAG.updateInterval` | `5` | Auto-refresh interval (minutes) |
| `layers.dynamicCAG.maxTokens` | `50000` | Max tokens for dynamic context |
| `layers.dynamicCAG.snapshotFn` | `undefined` | Async function returning fresh data |
| `layers.semanticCache.enabled` | `true` | Enable semantic cache |
| `layers.semanticCache.similarityThreshold` | `0.85` | Cosine similarity threshold (0-1) |
| `layers.semanticCache.maxEntries` | `1000` | Max cached query-response pairs |
| `layers.semanticCache.ttl` | `3600` | Cache entry TTL in seconds |
| `layers.thinkTool.enabled` | `true` | Enable extended thinking |
| `layers.thinkTool.triggerPatterns` | `['calcul', 'compar', ...]` | Patterns that activate thinking |
| `layers.thinkTool.budgetTokens` | `8000` | Token budget for thinking |
| `layers.curatedKnowledge.enabled` | `true` | Enable curated knowledge (ACE) |
| `layers.curatedKnowledge.maxEntries` | `500` | Max curated entries |
| `layers.curatedKnowledge.decayFactor` | `0.95` | Priority decay per cycle |
| `storage.type` | `'memory'` | `'memory'`, `'supabase'`, or `'redis'` |

---

## Layer Details

### Layer 1 — Static CAG Cache

Pre-loads knowledge into Anthropic's Prompt Caching. Static content (docs, FAQs, rules) is sent once and cached API-side for up to 5 minutes. Subsequent queries reuse the cached prefix — **90% cheaper** input tokens.

```typescript
sources: [
  { id: 'faq', name: 'FAQ', type: 'text', content: '...', category: 'faq', priority: 10 },
  { id: 'rules', name: 'Rules', type: 'file', filePath: './knowledge/rules.md', category: 'rules', priority: 9 },
]
```

### Layer 2 — Dynamic Snapshots

For data that changes frequently (prices, inventory, financial positions). Compresses data using extractive/structural strategies to fit token budgets. Supports scheduled auto-refresh with configurable TTL.

```typescript
dynamicCAG: {
  updateInterval: 5, // minutes
  snapshotFn: async () => {
    const data = await db.query('SELECT * FROM active_operations');
    return JSON.stringify(data);
  },
}
```

### Layer 3 — Semantic Cache

The biggest cost saver. Caches query-response pairs and matches new queries by embedding similarity. If someone asked something similar before, returns the cached response — **zero API cost**.

### Layer 4 — Think Tool

Wraps Claude's extended thinking for complex queries. Auto-detects when step-by-step reasoning is needed based on trigger patterns (calculations, comparisons, simulations, analysis).

### Layer 5 — Curated Knowledge (ACE)

Agentic Context Engineering. A self-managing knowledge base that:

- **teach()** — Add knowledge manually (priority: 0.7)
- **autoExtract()** — Detect knowledge from conversations (priority: 0.5)
- **feedback()** — Boost (+0.10) or penalize (-0.15) entries
- **decayPriorities()** — Multiplicative decay (x0.95 per cycle)
- Auto-prunes entries below priority 0.05

---

## Storage Backends

### In-Memory (Default)

No setup required. Data is lost on restart.

### Supabase (Persistent)

```typescript
const cag = await createCAG({
  anthropic: { apiKey: '...' },
  storage: {
    type: 'supabase',
    supabase: {
      url: process.env.SUPABASE_URL!,
      serviceKey: process.env.SUPABASE_SERVICE_KEY!,
    },
  },
});
```

### Redis

```typescript
const cag = await createCAG({
  anthropic: { apiKey: '...' },
  storage: {
    type: 'redis',
    redis: {
      host: 'localhost',
      port: 6379,
    },
  },
});
```

---

## Database Setup (Supabase)

For persistent storage, run the SQL migrations on your Supabase project:

```bash
# In order:
psql -f sql/001_semantic_cache.sql
psql -f sql/002_curated_knowledge.sql
psql -f sql/003_dynamic_snapshots.sql
psql -f sql/004_usage_analytics.sql
```

Requires the `pgvector` extension (available on Supabase by default).

The analytics migrations create views for:
- **`cag_daily_stats`** — Daily cache hit rates, token usage, costs
- **`cag_savings_report`** — Cost savings from prompt caching (Sonnet pricing)

---

## API Reference

### `createCAG(config)`

Factory function that creates and initializes a `CAGEngine` in one call.

```typescript
const cag = await createCAG({ anthropic: { apiKey: '...' } });
```

### `cag.query({ message, context? })`

Send a query through all 5 layers. Returns:

```typescript
{
  answer: string;
  cacheHit: boolean;
  thinkingProcess?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    estimatedCost: number;
  };
  processingTime: {
    total: number;
    contextAssembly: number;
    llmCall: number;
  };
  layersUsed: string[];
}
```

### `cag.teach(content, category, tags?)`

Add curated knowledge to Layer 5 (ACE). Returns the created entry.

### `cag.getStats()`

Returns engine statistics including uptime, total queries, cache hit rate, token usage, and per-layer stats.

### `cag.refreshDynamicContext()`

Force a refresh of the dynamic snapshot (Layer 2).

### `cag.clearSemanticCache()`

Clear all cached query-response pairs (Layer 3).

### `cag.shutdown()`

Graceful shutdown — stops schedulers, clears timers.

### `AnthropicAdapter.calculateCost(inputTokens, outputTokens, cachedTokens, pricing)`

Static method for cost calculation with configurable pricing (Sonnet, Opus, etc).

### `AnalyticsEngine`

In-memory analytics aggregator:

```typescript
import { AnalyticsEngine } from 'cag-esqueleto';

const analytics = new AnalyticsEngine();
await analytics.logQuery({ ... });

const daily = await analytics.getDailyStats(30);
const savings = await analytics.getSavingsReport();
const layers = await analytics.getLayerPerformance();
const projection = await analytics.getCostProjection(30);
```

---

## Examples

| Example | Description |
|---------|-------------|
| [`basic-setup/`](examples/basic-setup/) | Minimal usage with `createCAG()`, no external deps |
| [`supabase-integration/`](examples/supabase-integration/) | Persistent storage with Supabase + pgvector |
| [`telegram-bot/`](examples/telegram-bot/) | Bot integration with per-user sessions |
| [`edge-function/`](examples/edge-function/) | Supabase Edge Function (Deno) deployment |

---

## Development

```bash
# Install dependencies
npm install

# Run tests (watch mode)
npm test

# Run tests once
npm run test:run

# Run tests with coverage
npm run test:coverage

# Build (ESM + CJS + DTS)
npm run build

# Type check
npm run typecheck

# Lint
npm run lint
```

### Project Structure

```
src/
├── core/              # Engine, config, types
├── layers/
│   ├── layer1-static-cag/
│   ├── layer2-dynamic-cag/
│   ├── layer3-semantic-cache/
│   ├── layer4-think-tool/
│   └── layer5-curated-knowledge/
├── adapters/          # Anthropic, Supabase, Redis
├── analytics/         # Usage tracking + cost projection
└── utils/             # Token counter, text splitter, logger
tests/
├── unit/              # 168 unit tests
└── integration/       # 23 integration tests
sql/                   # PostgreSQL migrations (Supabase)
examples/              # Usage examples
```

---

## Contributing

1. Fork the repo
2. Create your branch (`git checkout -b feat/my-feature`)
3. Write tests first (TDD)
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, etc.)
5. Push and open a Pull Request

---

## License

MIT - [MorityVeloso](https://github.com/MorityVeloso)
