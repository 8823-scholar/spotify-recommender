import { accessToken, refreshToken } from './token.js';

const API_BASE = 'https://api.spotify.com/v1';
const MAX_RETRIES = 3;
// 追加・削除 API が1リクエストで受け付ける上限
const WRITE_CHUNK = 100;

export type Track = {
  uri: string;
  name: string;
  artists: string[];
  album: string;
  year: string;
};

export type Playlist = {
  id: string;
  name: string;
  description: string;
  owner: string;
  total: number;
};

type RawArtist = { name: string };
type RawTrack = {
  type?: string;
  uri: string;
  name: string;
  artists?: RawArtist[];
  album?: { name: string; release_date?: string };
};
type RawPlaylist = {
  id: string;
  name: string;
  description: string | null;
  owner?: { id: string; display_name?: string | null };
  items?: { total: number };
  tracks?: { total: number };
};
type Page<T> = { items: T[]; next: string | null };

export class SpotifyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toTrack(raw: RawTrack): Track {
  return {
    uri: raw.uri,
    name: raw.name,
    artists: (raw.artists ?? []).map((a) => a.name),
    album: raw.album?.name ?? '',
    year: raw.album?.release_date?.slice(0, 4) ?? '',
  };
}

function toPlaylist(raw: RawPlaylist): Playlist {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? '',
    owner: raw.owner?.display_name ?? raw.owner?.id ?? '',
    total: raw.items?.total ?? raw.tracks?.total ?? 0,
  };
}

export async function api<T>(method: string, pathOrUrl: string, body?: unknown): Promise<T> {
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
  let refreshed = false;

  for (let attempt = 0; ; attempt++) {
    const token = refreshed ? (await refreshToken()).access_token : await accessToken();
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401 && !refreshed) {
      refreshed = true;
      continue;
    }
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const wait = Number(res.headers.get('Retry-After') ?? '1');
      await sleep(Math.max(wait, 1) * 1000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      let message = text;
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
      } catch {
        // JSON でないエラー本文はそのまま使う
      }
      throw new SpotifyError(res.status, `Spotify API ${method} ${url} が失敗しました (${res.status}): ${message}`);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

async function paginate<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = path;
  while (next) {
    const page: Page<T> = await api<Page<T>>('GET', next);
    items.push(...page.items);
    next = page.next;
  }
  return items;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// プレイリストの URL・URI・ID のどれを渡されても ID を取り出す
export function parsePlaylistId(input: string): string {
  const s = input.trim();
  const fromUrl = s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?playlist\/([A-Za-z0-9]+)/);
  if (fromUrl?.[1]) return fromUrl[1];
  const fromUri = s.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
  if (fromUri?.[1]) return fromUri[1];
  return s;
}

export async function myPlaylists(): Promise<Playlist[]> {
  return (await paginate<RawPlaylist>('/me/playlists?limit=50')).map(toPlaylist);
}

export async function getPlaylist(id: string): Promise<Playlist> {
  return toPlaylist(await api<RawPlaylist>('GET', `/playlists/${encodeURIComponent(id)}`));
}

export async function playlistTracks(id: string): Promise<Track[]> {
  const items = await paginate<{ item?: RawTrack | null; track?: RawTrack | null }>(
    `/playlists/${encodeURIComponent(id)}/items?limit=50&additional_types=track`,
  );
  return items
    .map((i) => i.item ?? i.track)
    .filter((t): t is RawTrack => !!t && (t.type ?? 'track') === 'track' && t.uri.startsWith('spotify:track:'))
    .map(toTrack);
}

export async function getTrack(uri: string): Promise<Track> {
  const id = uri.replace(/^spotify:track:/, '');
  return toTrack(await api<RawTrack>('GET', `/tracks/${encodeURIComponent(id)}`));
}

// market=from_token は user-read-private スコープが無いと Search で 403 になるため付けない
export async function searchTracks(query: string, limit: number): Promise<Track[]> {
  const params = new URLSearchParams({ q: query, type: 'track', limit: String(limit) });
  const res = await api<{ tracks: { items: (RawTrack | null)[] } }>('GET', `/search?${params}`);
  return res.tracks.items.filter((t): t is RawTrack => !!t).map(toTrack);
}

export async function playOnDevice(deviceId: string, uri: string): Promise<void> {
  await api('PUT', `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { uris: [uri] });
}

export async function createPlaylist(name: string, description: string): Promise<Playlist> {
  return toPlaylist(await api<RawPlaylist>('POST', '/me/playlists', { name, description, public: false }));
}

export async function addItems(playlistId: string, uris: string[]): Promise<void> {
  for (const part of chunk(uris, WRITE_CHUNK)) {
    await api('POST', `/playlists/${encodeURIComponent(playlistId)}/items`, { uris: part });
  }
}

export async function removeItems(playlistId: string, uris: string[]): Promise<void> {
  for (const part of chunk(uris, WRITE_CHUNK)) {
    await api('DELETE', `/playlists/${encodeURIComponent(playlistId)}/items`, {
      items: part.map((uri) => ({ uri })),
    });
  }
}
