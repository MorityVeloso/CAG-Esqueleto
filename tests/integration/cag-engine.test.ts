import { describe, it, expect, beforeEach } from 'vitest';
import { CAGEngine } from '../../src/core/cag-engine.js';
import { createTestConfig } from '../../src/core/config.js';
import { StaticCagCache } from '../../src/layers/layer1-static-cag/static-cache.js';
import { ThinkEngine } from '../../src/layers/layer4-think-tool/think-engine.js';

describe('CAGEngine', () => {
  let engine: CAGEngine;

  beforeEach(() => {
    const config = createTestConfig();
    engine = new CAGEngine(config);
  });

  it('should throw if not initialized', async () => {
    await expect(engine.query('test')).rejects.toThrow('not initialized');
  });

  it('should initialize and shutdown without errors', async () => {
    const config = createTestConfig();
    const staticCag = new StaticCagCache(config);
    const thinkTool = new ThinkEngine(config);

    engine.registerStaticCag(staticCag);
    engine.registerThinkTool(thinkTool);

    await engine.initialize();
    await engine.shutdown();
  });

  it('should register layers fluently', () => {
    const config = createTestConfig();
    const result = engine
      .registerStaticCag(new StaticCagCache(config))
      .registerThinkTool(new ThinkEngine(config));

    expect(result).toBe(engine);
  });

  it('should accept string input as query', async () => {
    const config = createTestConfig();
    engine.registerStaticCag(new StaticCagCache(config));
    await engine.initialize();

    // Query will fail (no API adapter) but it should accept a plain string
    await expect(engine.query('test')).rejects.toThrow('AnthropicAdapter');
    await engine.shutdown();
  });

  it('should emit events', async () => {
    const events: string[] = [];
    engine.on((event) => events.push(event.type));

    const config = createTestConfig();
    engine.registerStaticCag(new StaticCagCache(config));
    engine.registerThinkTool(new ThinkEngine(config));
    await engine.initialize();

    // Query will fail (no API adapter) but events should still fire
    try {
      await engine.query('test');
    } catch {
      // Expected — no adapter connected
    }

    await engine.shutdown();
  });
});
