import { describe, expect, it } from 'vitest';
import { dedupe, normalize, pickBest, rate } from './match.js';
import type { Track } from './spotify.js';

function track(name: string, artists: string[], uri = `spotify:track:${name.replace(/\W/g, '') || 'x'}`): Track {
  return { uri, name, artists, album: '', year: '' };
}

describe('normalize', () => {
  it('表記揺れを吸収する', () => {
    expect(normalize('Ｈｅｌｌｏ， World!')).toBe('helloworld');
    expect(normalize('Hey Jude - Remastered 2015')).toBe('heyjude');
    expect(normalize('Song (feat. Someone)')).toBe('song');
    expect(normalize('夜に駆ける【MV】')).toBe('夜に駆ける');
  });
});

describe('rate', () => {
  const q = { title: 'Hey Jude', artist: 'The Beatles' };

  it('曲名とアーティストが一致すれば exact', () => {
    expect(rate(q, track('Hey Jude - Remastered 2015', ['The Beatles']))).toBe('exact');
  });

  it('アーティストが一致して曲名が部分一致なら partial', () => {
    expect(rate(q, track('Hey Jude Medley', ['The Beatles']))).toBe('partial');
  });

  it('曲名だけ一致なら partial', () => {
    expect(rate(q, track('Hey Jude', ['Wilson Pickett']))).toBe('partial');
  });

  it('どちらも一致しなければ none', () => {
    expect(rate(q, track('Let It Be', ['Aretha Franklin']))).toBe('none');
  });

  it('括弧だけの曲名を空文字同士で一致扱いしない', () => {
    expect(rate({ title: '(intro)', artist: 'X' }, track('[skit]', ['Y']))).toBe('none');
  });
});

describe('pickBest', () => {
  const q = { title: '夜に駆ける', artist: 'YOASOBI' };

  it('最も確度の高い候補を選ぶ', () => {
    const exact = track('夜に駆ける', ['YOASOBI'], 'spotify:track:a');
    const partial = track('夜に駆ける', ['Cover Artist'], 'spotify:track:b');
    const result = pickBest(q, [partial], [exact]);
    expect(result.confidence).toBe('exact');
    expect(result.match?.uri).toBe('spotify:track:a');
    expect(result.alternatives).toEqual([]);
  });

  it('名前が一致しなくてもフィールド指定検索のヒットは uncertain で返す', () => {
    const romanized = track('Yoru ni Kakeru', ['YOASOBI-romaji'], 'spotify:track:c');
    const result = pickBest(q, [romanized], []);
    expect(result.confidence).toBe('uncertain');
    expect(result.match?.uri).toBe('spotify:track:c');
  });

  it('何もヒットしなければ none', () => {
    const result = pickBest(q, [], [track('Other', ['Someone'])]);
    expect(result.confidence).toBe('none');
    expect(result.match).toBeNull();
  });
});

describe('dedupe', () => {
  it('同じ URI と同じ曲の別音源を除外する', () => {
    const existing = [track('Hey Jude', ['The Beatles'], 'spotify:track:album')];
    const candidates = [
      track('Hey Jude - Remastered 2015', ['The Beatles'], 'spotify:track:single'),
      track('Let It Be', ['The Beatles'], 'spotify:track:album'),
      track('Something', ['The Beatles'], 'spotify:track:s1'),
      track('Something', ['The Beatles'], 'spotify:track:s2'),
    ];
    const { fresh, duplicates } = dedupe(candidates, existing);
    expect(fresh.map((t) => t.uri)).toEqual(['spotify:track:s1']);
    expect(duplicates.map((t) => t.uri)).toEqual(['spotify:track:single', 'spotify:track:album', 'spotify:track:s2']);
  });
});
