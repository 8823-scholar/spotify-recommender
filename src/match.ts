import type { Track } from './spotify.js';

export type Confidence = 'exact' | 'partial' | 'uncertain' | 'none';

export type TrackQuery = { title: string; artist: string };

// 表記揺れ (全角半角・大文字小文字・(feat. ...)・" - 2011 Remaster" 等) を吸収した比較用文字列
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+-\s+.*$/, '')
    .replace(/[(\[【（][^)\]】）]*[)\]】）]/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function looselyEqual(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function rate(query: TrackQuery, track: Track): Confidence {
  const artistOk = track.artists.some((a) => looselyEqual(a, query.artist));
  const title = normalize(query.title);
  const titleExact = title !== '' && normalize(track.name) === title;
  if (artistOk && titleExact) return 'exact';
  if (artistOk && looselyEqual(track.name, query.title)) return 'partial';
  if (titleExact) return 'partial';
  return 'none';
}

const RANK: Record<Confidence, number> = { exact: 3, partial: 2, uncertain: 1, none: 0 };

export function pickBest(
  query: TrackQuery,
  fielded: Track[],
  plain: Track[],
): { confidence: Confidence; match: Track | null; alternatives: Track[] } {
  const seen = new Set<string>();
  const candidates = [...fielded, ...plain].filter((t) => !seen.has(t.uri) && seen.add(t.uri));

  let best: Track | null = null;
  let confidence: Confidence = 'none';
  for (const t of candidates) {
    const c = rate(query, t);
    if (RANK[c] > RANK[confidence]) {
      best = t;
      confidence = c;
    }
  }

  // フィールド指定検索のヒットは別名義 (例: 日本語名とローマ字名) で一致している可能性があるので、
  // 名前が一致しなくても候補として返し、採否は呼び出し側に委ねる
  if (!best && fielded[0]) {
    best = fielded[0];
    confidence = 'uncertain';
  }

  const alternatives = confidence === 'exact' ? [] : candidates.filter((t) => t !== best).slice(0, 2);
  return { confidence, match: best, alternatives };
}

export function trackKey(t: Pick<Track, 'name' | 'artists'>): string {
  return `${normalize(t.name)}|${normalize(t.artists[0] ?? '')}`;
}

// URI が同じもの、または同じ曲の別音源 (シングル版とアルバム版など) を既存曲として除外する
export function dedupe(candidates: Track[], existing: Track[]): { fresh: Track[]; duplicates: Track[] } {
  const uris = new Set(existing.map((t) => t.uri));
  const keys = new Set(existing.map(trackKey));
  const fresh: Track[] = [];
  const duplicates: Track[] = [];
  for (const t of candidates) {
    const key = trackKey(t);
    if (uris.has(t.uri) || keys.has(key)) {
      duplicates.push(t);
      continue;
    }
    uris.add(t.uri);
    keys.add(key);
    fresh.push(t);
  }
  return { fresh, duplicates };
}
