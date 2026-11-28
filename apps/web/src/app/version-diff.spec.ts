import { describe, expect, it } from 'vitest';
import { compareBoardVersions } from './version-diff';

const node = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'mind',
  data: { topic: { children: [{ text }] } },
  children: [],
  ...extra,
});

describe('compareBoardVersions', () => {
  it('reports nested added, removed and changed nodes', () => {
    const older = [
      node('root', 'Root', {
        children: [node('keep', 'Keep'), node('edit', 'Before'), node('remove', 'Remove')],
      }),
    ];
    const newer = [
      node('root', 'Root', {
        children: [
          node('keep', 'Keep'),
          node('edit', 'After'),
          node('add', 'Added', { children: [node('nested', 'Nested')] }),
        ],
      }),
    ];

    const diff = compareBoardVersions(older, newer);

    expect(diff.added.map((item) => item.id)).toEqual(['add', 'nested']);
    expect(diff.removed.map((item) => item.id)).toEqual(['remove']);
    expect(diff.changed.map((item) => item.id)).toEqual(['edit']);
    expect(diff.changed[0].text).toBe('After');
  });

  it('ignores position changes and parent child-list changes', () => {
    const older = [node('root', 'Root', { x: 10, y: 20, children: [node('child', 'Before')] })];
    const newer = [node('root', 'Root', { x: 99, y: 88, children: [node('child', 'After')] })];

    const diff = compareBoardVersions(older, newer);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed.map((item) => item.id)).toEqual(['child']);
  });
});
