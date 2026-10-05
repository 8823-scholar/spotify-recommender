import { createPlaylist, getPlaylist, myPlaylists, type Playlist } from './spotify.js';

// おすすめ用プレイリストとメインの対応は説明文のマーカーで持つ。
// 名前で引くとメイン側のリネームで対応が切れるため
export function marker(mainId: string): string {
  return `[recommend-for:${mainId}]`;
}

export function inboxName(mainName: string): string {
  return `${mainName} のおすすめ`;
}

export function inboxDescription(mainId: string): string {
  return `Claude がおすすめした曲の受け皿。気に入った曲はメインのプレイリストへ移す ${marker(mainId)}`;
}

export function findInbox(playlists: Playlist[], mainId: string): Playlist | undefined {
  return playlists.find((p) => p.description.includes(marker(mainId)));
}

export async function lookupInbox(mainId: string): Promise<Playlist | undefined> {
  return findInbox(await myPlaylists(), mainId);
}

export async function ensureInbox(mainId: string): Promise<{ inbox: Playlist; main: Playlist; created: boolean }> {
  const main = await getPlaylist(mainId);
  const existing = await lookupInbox(main.id);
  if (existing) {
    return { inbox: existing, main, created: false };
  }
  const inbox = await createPlaylist(inboxName(main.name), inboxDescription(main.id));
  return { inbox, main, created: true };
}
