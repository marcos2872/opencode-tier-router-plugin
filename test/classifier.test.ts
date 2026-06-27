import { describe, it, expect } from 'vitest';
import { classifyTask } from '../src/router/classifier.js';
import type { TaskPatterns } from '../src/router/config.js';

const patterns: TaskPatterns = {
  fast: ['find', 'grep', 'search'],
  medium: ['refactor', 'implement', 'fix'],
  heavy: ['design', 'architecture', 'debug'],
};

describe('classifyTask', () => {
  it('maps every keyword to its tier', () => {
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

  it('is case-insensitive', () => {
    expect(classifyTask('FIND x', patterns)).toBe('fast');
    expect(classifyTask('Refactor X', patterns)).toBe('medium');
    expect(classifyTask('DEBUG x', patterns)).toBe('heavy');
  });

  it('matches word stems at boundaries', () => {
    expect(classifyTask('debugging the code', patterns)).toBe('heavy');
    expect(classifyTask('finding files', patterns)).toBe('fast');
  });

  it('does not match mid-word occurrences', () => {
    expect(classifyTask('research paper', patterns)).toBeNull();
    expect(classifyTask('undefined behavior', patterns)).toBeNull();
  });

  it('returns null when no pattern matches', () => {
    expect(classifyTask('hello world', patterns)).toBeNull();
    expect(classifyTask('', patterns)).toBeNull();
  });

  it('uses heavy > medium > fast priority when multiple tiers match', () => {
    expect(classifyTask('debug and fix the issue', patterns)).toBe('heavy');
    expect(classifyTask('find and refactor code', patterns)).toBe('medium');
    expect(classifyTask('design and implement feature', patterns)).toBe('heavy');
    expect(classifyTask('find grep and search', patterns)).toBe('fast');
  });
});
