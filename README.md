# CAG-Esqueleto

### 5-Layer Context Engineering Module

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Claude API](https://img.shields.io/badge/Claude-Sonnet%204-purple.svg)](https://docs.anthropic.com/)

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
│                        CAG Engine                                │
│                   (Orchestrates all layers)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  L1: Static   │  │  L2: Dynamic  │  │  L3: Semantic Cache   │  │
│  │  CAG Cache    │  │  Snapshots    │  │  (Query-Response)     │  │
│  │              │  │              │  │                       │  │
│  │  Prompt      │  │  Compressed   │  │  Embedding-based      │  │
│  │  Caching     │  │  + TTL        │  │  similarity matching  │  │
│  │  (Anthropic) │  │  + Scheduler  │  │  Biggest cost saver!  │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌────────────────────────────────────┐   │
│  │  L4: Think Tool   │  │  L5: Curated Knowledge (ACE)       │   │
│  │                   │  │                                    │   │
│  │  Extended         │  │  Auto-prioritization               │   │
│  │  thinking for     │  │  Self-managing knowledge base      │   │
│  │  complex queries  │  │  Usage tracking + eviction         │   │
│  └──────────────────┘  └────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  Adapters: Anthropic | Supabase | Redis                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Install

```bash
npm install cag-esqueleto
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your Anthropic API key
```

### 3. Use

```typescript
import {
  CAGEngine,
  createConfigFromEnv,
  StaticCagCache,
  ThinkEngine,
} from 'cag-esqueleto';

// Setup
const config = createConfigFromEnv();
const engine = new CAGEngine(config);

// Load your knowledge
const staticCag = new StaticCagCache(config);
await staticCag.loadKnowledge([
  { id: 'faq', type: 'markdown', content: '# FAQ\n\n...' },
]);

// Wire up
engine.registerStaticCag(staticCag);
engine.registerThinkTool(new ThinkEngine(config));
await engine.initialize();

// Query
const response = await engine.query('What is your return policy?');
console.log(response.content);
// Layers used: ['static-cag', 'think-tool']
// Latency: 45ms (cache hit)
```

---

## Layer Details

### Layer 1 — Static CAG Cache

Pre-loads knowledge into Anthropic's Prompt Caching. Static content (docs, FAQs) is sent once and cached API-side for up to 5 minutes. Subsequent queries reuse the cached prefix — 90% cheaper input tokens.

### Layer 2 — Dynamic Snapshots

For data that changes frequently (prices, inventory, status). Compresses data using extractive/structural strategies to fit token budgets. Supports scheduled auto-refresh.

### Layer 3 — Semantic Cache

The biggest cost saver. Caches query-response pairs and matches new queries by embedding similarity. If someone asked something similar before, returns the cached response — zero API cost.

### Layer 4 — Think Tool

Wraps Claude's extended thinking for complex queries. Auto-detects when step-by-step reasoning is needed (calculations, comparisons, multi-criteria decisions).

### Layer 5 — Curated Knowledge (ACE)

Agentic Context Engineering. Self-managing knowledge base that auto-prioritizes entries by usage frequency and recency. Evicts stale entries automatically.

---

## Examples

- [`basic-setup/`](examples/basic-setup/) — Minimal usage, no external deps
- [`supabase-integration/`](examples/supabase-integration/) — Persistent cache with Supabase + pgvector
- [`telegram-bot/`](examples/telegram-bot/) — Bot integration pattern
- [`edge-function/`](examples/edge-function/) — Supabase Edge Function deployment

---

## Database Setup (Optional)

For persistent storage, run the SQL migrations on your Supabase project:

```bash
# In order:
psql -f sql/001_semantic_cache.sql
psql -f sql/002_curated_knowledge.sql
psql -f sql/003_dynamic_snapshots.sql
psql -f sql/004_usage_analytics.sql
```

Requires the `pgvector` extension (available on Supabase by default).

---

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Build
npm run build

# Type check
npm run typecheck
```

---

## License

MIT - [MorityVeloso](https://github.com/MorityVeloso)
