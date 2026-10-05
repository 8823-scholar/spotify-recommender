import { describe, expect, it } from 'vitest';
import { mergeRejected } from './rejected.js';
import type { Track } from './spotify.js';

function track(uri: string, name = uri): Track {
  return { uri, name, artists: ['A'], album: '', year: '' };
}

describe('mergeRejected', () => {
  it('既に記録済みの URI と、同じ呼び出し内の重複は追加しない', () => {
    const now = new Date('2026-10-06T00:00:00Z');
    const current = mergeRejected([], [track('spotify:track:a')], 'main1', now);
    const next = mergeRejected(
      current,
      [track('spotify:track:a'), track('spotify:track:b'), track('spotify:track:b')],
      'main2',
      now,
    );
    expect(next.map((t) => [t.uri, t.mainId])).toEqual([
      ['spotify:track:a', 'main1'],
      ['spotify:track:b', 'main2'],
    ]);
    expect(next[1]?.rejectedAt).toBe('2026-10-06T00:00:00.000Z');
  });
});
