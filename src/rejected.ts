import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { rejectedPath } from './config.js';
import type { Track } from './spotify.js';

export type RejectedTrack = Track & { mainId: string; rejectedAt: string };

export async function loadRejected(): Promise<RejectedTrack[]> {
  try {
    return JSON.parse(await readFile(rejectedPath(), 'utf8')) as RejectedTrack[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

export function mergeRejected(current: RejectedTrack[], tracks: Track[], mainId: string, now: Date): RejectedTrack[] {
  const known = new Set(current.map((t) => t.uri));
  const added = tracks
    .filter((t) => !known.has(t.uri) && known.add(t.uri))
    .map((t) => ({ ...t, mainId, rejectedAt: now.toISOString() }));
  return [...current, ...added];
}

// 却下した曲は全プレイリスト共通で、以後の推薦から除外する
export async function recordRejected(tracks: Track[], mainId: string): Promise<void> {
  const next = mergeRejected(await loadRejected(), tracks, mainId, new Date());
  const path = rejectedPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(next, null, 2));
}
