import { describe, expect, it } from 'vitest';
import { buildDelegationProtocol, classifyTask } from '../src/router/protocol.js';
import type { RouterConfig } from '../src/router/config.js';

const validConfig: RouterConfig = {
  mode: 'normal',
  tiers: {
    fast: { model: 'openai/gpt-4.1-nano', costRatio: 1, cap: 8 },
    medium: { model: 'anthropic/claude-sonnet-4-5', costRatio: 5, cap: 12 },
    heavy: { model: 'anthropic/claude-opus-4', costRatio: 20, cap: 20 },
  },
  modes: {
    normal: { description: 'Balanced', defaultTier: 'medium' },
    budget: { description: 'Cheap', defaultTier: 'fast' },
    quality: { description: 'Better', defaultTier: 'medium' },
    deep: { description: 'Deep', defaultTier: 'heavy' },
  },
  taskPatterns: {
    fast: ['find', 'grep', 'search'],
    medium: ['refactor', 'implement', 'fix'],
    heavy: ['design', 'architecture', 'debug'],
  },
  enforcement: {
    mode: 'advisory',
    trivialDirectAllowed: true,
  },
  routing: {
    strategy: 'keyword',
    selectorModel: 'github-copilot/claude-haiku-4.5',
    selectorTimeoutMs: 1200,
    selectorMaxTokens: 16,
  },
};

describe('buildDelegationProtocol', () => {
  it('retorna protocolo com cabeçalho', () => {
    const protocol = buildDelegationProtocol(validConfig);

    expect(protocol.startsWith('--- Task Delegation Reference ---')).toBe(true);
  });

  it('inclui modelos e custos dos tiers', () => {
    const protocol = buildDelegationProtocol(validConfig);

    expect(protocol).toContain('@fast=openai/gpt-4.1-nano(1x)');
    expect(protocol).toContain('@medium=anthropic/claude-sonnet-4-5(5x)');
    expect(protocol).toContain('@heavy=anthropic/claude-opus-4(20x)');
  });

  it('inclui modo ativo e padrão', () => {
    const protocol = buildDelegationProtocol(validConfig);

    expect(protocol).toContain('mode:normal');
    expect(protocol).toContain('Default: @medium');
  });

  it('inclui padrões de tarefa de cada tier', () => {
    const protocol = buildDelegationProtocol(validConfig);

    expect(protocol).toContain('@fast→find/grep/search');
    expect(protocol).toContain('@medium→refactor/implement/fix');
    expect(protocol).toContain('@heavy→design/architecture/debug');
  });

  it('inclui estratégia e modelo selector', () => {
    const protocol = buildDelegationProtocol(validConfig);

    expect(protocol).toContain('strategy=keyword');
    expect(protocol).toContain('selector=github-copilot/claude-haiku-4.5');
  });

  it('produz protocolos diferentes para modos diferentes', () => {
    const normal = buildDelegationProtocol({ ...validConfig, mode: 'normal' });
    const budget = buildDelegationProtocol({ ...validConfig, mode: 'budget' });
    const quality = buildDelegationProtocol({ ...validConfig, mode: 'quality' });
    const deep = buildDelegationProtocol({ ...validConfig, mode: 'deep' });

    expect(normal).not.toBe(budget);
    expect(budget).not.toBe(quality);
    expect(quality).not.toBe(deep);
  });

  it('usa default neutro quando o modo ativo não existe', () => {
    const protocol = buildDelegationProtocol({ ...validConfig, mode: 'unknown' });

    expect(protocol).toContain('mode:unknown');
    expect(protocol).toContain('Default: @medium');
  });

  it('inclui orientações de modo específicas', () => {
    expect(buildDelegationProtocol({ ...validConfig, mode: 'budget' })).toContain('cost-first');
    expect(buildDelegationProtocol({ ...validConfig, mode: 'quality' })).toContain('quality-first');
    expect(buildDelegationProtocol({ ...validConfig, mode: 'deep' })).toContain('depth-first');
  });
});

describe('classifyTask', () => {
  it('retorna fast para palavras-chave fast', () => {
    expect(classifyTask('find the auth function', validConfig.taskPatterns)).toBe('fast');
    expect(classifyTask('grep for TODOs', validConfig.taskPatterns)).toBe('fast');
  });

  it('retorna medium para palavras-chave medium', () => {
    expect(classifyTask('refactor this function', validConfig.taskPatterns)).toBe('medium');
    expect(classifyTask('implement login', validConfig.taskPatterns)).toBe('medium');
  });

  it('retorna heavy para palavras-chave heavy', () => {
    expect(classifyTask('design the auth module', validConfig.taskPatterns)).toBe('heavy');
    expect(classifyTask('debug the failure', validConfig.taskPatterns)).toBe('heavy');
  });

  it('é insensível a maiúsculas e minúsculas', () => {
    expect(classifyTask('FIND something', validConfig.taskPatterns)).toBe('fast');
    expect(classifyTask('DEBUG issue', validConfig.taskPatterns)).toBe('heavy');
  });

  it('combina prefixos de padrões em limites de palavra', () => {
    expect(classifyTask('finding files', validConfig.taskPatterns)).toBe('fast');
    expect(classifyTask('debugging the code', validConfig.taskPatterns)).toBe('heavy');
  });

  it('não combina ocorrência no meio de palavra', () => {
    expect(classifyTask('research paper', validConfig.taskPatterns)).toBeNull();
    expect(classifyTask('undefined behavior', validConfig.taskPatterns)).toBeNull();
  });

  it('retorna null quando nenhum padrão combina', () => {
    expect(classifyTask('hello world', validConfig.taskPatterns)).toBeNull();
    expect(classifyTask('', validConfig.taskPatterns)).toBeNull();
  });

  it('prioriza heavy sobre medium e fast', () => {
    expect(classifyTask('debug and fix the issue', validConfig.taskPatterns)).toBe('heavy');
    expect(classifyTask('find and refactor code', validConfig.taskPatterns)).toBe('medium');
  });
});
