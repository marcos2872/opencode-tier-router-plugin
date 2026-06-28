import { describe, expect, it } from 'vitest';
import { classifyTask } from '../src/router/classifier.js';
import type { TaskPatterns } from '../src/router/config.js';

const patterns: TaskPatterns = {
  fast: ['find', 'grep', 'search'],
  medium: ['refactor', 'implement', 'fix'],
  heavy: ['design', 'architecture', 'debug'],
};

describe('classifyTask', () => {
  it('mapeia cada palavra-chave ao seu tier', () => {
    expect(classifyTask('find x', patterns)).toBe('fast');
    expect(classifyTask('grep x', patterns)).toBe('fast');
    expect(classifyTask('search x', patterns)).toBe('fast');
    expect(classifyTask('refactor x', patterns)).toBe('medium');
    expect(classifyTask('implement x', patterns)).toBe('medium');
    expect(classifyTask('fix x', patterns)).toBe('medium');
    expect(classifyTask('design x', patterns)).toBe('heavy');
    expect(classifyTask('architecture x', patterns)).toBe('heavy');
    expect(classifyTask('debug x', patterns)).toBe('heavy');
  });

  it('ignora padrões vazios', () => {
    const emptyPatterns: TaskPatterns = {
      fast: [],
      medium: [],
      heavy: [],
    };

    expect(classifyTask('find x', emptyPatterns)).toBeNull();
  });

  it('ignora tiers ausentes', () => {
    const missingPatterns: TaskPatterns = {
      fast: ['find'],
      medium: ['refactor'],
      heavy: [],
    };

    expect(classifyTask('search x', missingPatterns)).toBeNull();
    expect(classifyTask('debug x', missingPatterns)).toBeNull();
  });

  it('é insensível a maiúsculas e minúsculas', () => {
    expect(classifyTask('FIND x', patterns)).toBe('fast');
    expect(classifyTask('Refactor X', patterns)).toBe('medium');
    expect(classifyTask('DEBUG x', patterns)).toBe('heavy');
  });

  it('combina prefixos de padrões em limites de palavra', () => {
    expect(classifyTask('debugging the code', patterns)).toBe('heavy');
    expect(classifyTask('finding files', patterns)).toBe('fast');
  });

  it('não combina ocorrência no meio de palavra', () => {
    expect(classifyTask('research paper', patterns)).toBeNull();
    expect(classifyTask('undefined behavior', patterns)).toBeNull();
  });

  it('retorna null quando nenhum padrão combina', () => {
    expect(classifyTask('hello world', patterns)).toBeNull();
    expect(classifyTask('', patterns)).toBeNull();
  });

  it('prioriza heavy acima de medium e fast', () => {
    expect(classifyTask('debug and fix the issue', patterns)).toBe('heavy');
    expect(classifyTask('find and refactor code', patterns)).toBe('medium');
    expect(classifyTask('design and implement feature', patterns)).toBe('heavy');
    expect(classifyTask('find grep and search', patterns)).toBe('fast');
  });
});
