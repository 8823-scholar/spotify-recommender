import { lookupInbox, parseMarker } from './inbox.js';
import { dedupe } from './match.js';
import { recordRejected } from './rejected.js';
import {
  addItems,
  getPlaylist,
  myPlaylists,
  playlistTracks,
  removeItems,
  type Playlist,
  type Track,
} from './spotify.js';

async function inboxTargets(mainId: string, uris: string[]) {
  const inbox = await lookupInbox(mainId);
  if (!inbox) throw new Error('おすすめ用プレイリストが見つかりません');
  const inboxTracks = await playlistTracks(inbox.id);
  const requested = new Set(uris);
  const targets = inboxTracks.filter((t) => requested.has(t.uri));
  const missing = [...requested].filter((u) => !targets.some((t) => t.uri === u));
  return { inbox, targets, missing };
}

export async function moveToMain(
  mainId: string,
  uris: string[],
): Promise<{ moved: Track[]; removedOnly: Track[]; missing: string[] }> {
  const { inbox, targets, missing } = await inboxTargets(mainId, uris);
  const { fresh, duplicates } = dedupe(targets, await playlistTracks(mainId));

  // 先にメインへ追加してから削除し、途中で失敗しても曲が消えないようにする
  if (fresh.length > 0) {
    await addItems(
      mainId,
      fresh.map((t) => t.uri),
    );
  }
  if (targets.length > 0) {
    await removeItems(
      inbox.id,
      targets.map((t) => t.uri),
    );
  }
  return { moved: fresh, removedOnly: duplicates, missing };
}

export async function rejectRecommendations(
  mainId: string,
  uris: string[],
): Promise<{ rejected: Track[]; missing: string[] }> {
  const { inbox, targets, missing } = await inboxTargets(mainId, uris);
  // 記録を先に済ませ、削除に失敗しても却下の意思は残るようにする
  if (targets.length > 0) {
    await recordRejected(targets, mainId);
    await removeItems(
      inbox.id,
      targets.map((t) => t.uri),
    );
  }
  return { rejected: targets, missing };
}

export async function inboxUris(mainId: string): Promise<string[]> {
  const inbox = await lookupInbox(mainId);
  return inbox ? (await playlistTracks(inbox.id)).map((t) => t.uri) : [];
}

// 却下としては記録せず、おすすめ用から消すだけ
export async function clearRecommendations(mainId: string, uris: string[]): Promise<void> {
  const inbox = await lookupInbox(mainId);
  if (inbox && uris.length > 0) await removeItems(inbox.id, uris);
}

export type InboxView = { main: Pick<Playlist, 'id' | 'name'>; inbox: Pick<Playlist, 'id' | 'name'>; tracks: Track[] };

export async function listInboxes(): Promise<InboxView[]> {
  const playlists = await myPlaylists();
  const inboxes = playlists.flatMap((p) => {
    const mainId = parseMarker(p.description);
    return mainId ? [{ inbox: p, mainId }] : [];
  });
  return Promise.all(
    inboxes.map(async ({ inbox, mainId }) => {
      const main = playlists.find((p) => p.id === mainId) ?? (await getPlaylist(mainId));
      return {
        main: { id: main.id, name: main.name },
        inbox: { id: inbox.id, name: inbox.name },
        tracks: await playlistTracks(inbox.id),
      };
    }),
  );
}
