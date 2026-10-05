import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { ensureInbox, lookupInbox } from './inbox.js';
import { dedupe, pickBest } from './match.js';
import {
  addItems,
  getPlaylist,
  getTrack,
  myPlaylists,
  parsePlaylistId,
  playlistTracks,
  removeItems,
  searchTracks,
  type Track,
} from './spotify.js';

// Search の limit 上限は Development Mode で 10
const SEARCH_LIMIT = 5;
// 並列に投げすぎると 429 になるため同時実行数を絞る
const CONCURRENCY = 4;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function line(t: Track): string {
  const album = t.year ? `${t.album} (${t.year})` : t.album;
  return `${t.uri} | ${t.name} — ${t.artists.join(', ')} | ${album}`;
}

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

function handle<A>(fn: (args: A) => Promise<string>) {
  return async (args: A) => {
    try {
      return text(await fn(args));
    } catch (e) {
      return { ...text(e instanceof Error ? e.message : String(e)), isError: true };
    }
  };
}

const playlistArg = z
  .string()
  .describe('メインのプレイリスト。ID・spotify:playlist:... URI・open.spotify.com の URL のいずれか');

function createServer(): McpServer {
  const server = new McpServer({ name: 'spotify-recommender', version: '0.1.0' });

  server.registerTool(
    'list_playlists',
    {
      description:
        'ログインユーザーのプレイリスト一覧 (ID・名前・曲数・所有者) を返す。おすすめ用プレイリストには説明文に [recommend-for:<メインのID>] が付いている',
      inputSchema: z.object({}),
    },
    handle(async () => {
      const playlists = await myPlaylists();
      return playlists
        .map((p) => {
          const tag = p.description.match(/\[recommend-for:[A-Za-z0-9]+\]/)?.[0];
          return `${p.id} | ${p.name} | ${p.total}曲 | owner: ${p.owner}${tag ? ` | ${tag}` : ''}`;
        })
        .join('\n');
    }),
  );

  server.registerTool(
    'get_playlist_tracks',
    {
      description:
        'プレイリストの全曲を「URI | 曲名 — アーティスト | アルバム (年)」形式で返す。自分が所有または共同編集しているプレイリストのみ取得できる',
      inputSchema: z.object({ playlist: playlistArg }),
    },
    handle(async ({ playlist }) => {
      const id = parsePlaylistId(playlist);
      const [info, tracks] = await Promise.all([getPlaylist(id), playlistTracks(id)]);
      return [`# ${info.name} (${tracks.length}曲)`, ...tracks.map(line)].join('\n');
    }),
  );

  server.registerTool(
    'search_tracks',
    {
      description:
        '曲名+アーティストの組を Spotify 上の曲に解決する。confidence は exact (曲名・アーティスト一致) / partial (表記揺れ等で部分一致) / uncertain (検索ヒットはあるが名前が一致しない。別名義の可能性) / none (見つからない)。exact 以外は alternatives も確認して採否を判断すること',
      inputSchema: z.object({
        queries: z
          .array(z.object({ title: z.string(), artist: z.string() }))
          .min(1)
          .max(50),
      }),
    },
    handle(async ({ queries }) => {
      const results = await mapLimit(queries, CONCURRENCY, async (q) => {
        const title = q.title.replaceAll('"', '');
        const artist = q.artist.replaceAll('"', '');
        const fielded = await searchTracks(`track:"${title}" artist:"${artist}"`, SEARCH_LIMIT);
        const best = pickBest(q, fielded, []);
        if (best.confidence === 'exact') return { q, ...best };
        const plain = await searchTracks(`${q.title} ${q.artist}`, SEARCH_LIMIT);
        return { q, ...pickBest(q, fielded, plain) };
      });
      return results
        .map(({ q, confidence, match, alternatives }) => {
          const head = `## ${q.title} / ${q.artist} → ${confidence}`;
          const body = match ? [`match: ${line(match)}`] : [];
          const alts = alternatives.map((t) => `alt: ${line(t)}`);
          return [head, ...body, ...alts].join('\n');
        })
        .join('\n\n');
    }),
  );

  server.registerTool(
    'add_recommendations',
    {
      description:
        'おすすめ曲をメインのプレイリストに対応するおすすめ用プレイリストへ追加する。おすすめ用プレイリストが無ければ「<メイン名> のおすすめ」(非公開) を作成する。メインまたはおすすめ用に既にある曲 (同じ曲の別音源を含む) は追加しない',
      inputSchema: z.object({
        playlist: playlistArg,
        uris: z
          .array(z.string().regex(/^spotify:track:[A-Za-z0-9]+$/))
          .min(1)
          .max(100)
          .describe('search_tracks で得た spotify:track:... URI'),
      }),
    },
    handle(async ({ playlist, uris }) => {
      const { inbox, main, created } = await ensureInbox(parsePlaylistId(playlist));
      const [candidates, mainTracks, inboxTracks] = await Promise.all([
        mapLimit([...new Set(uris)], CONCURRENCY, getTrack),
        playlistTracks(main.id),
        created ? Promise.resolve([]) : playlistTracks(inbox.id),
      ]);

      const vsMain = dedupe(candidates, mainTracks);
      const vsInbox = dedupe(vsMain.fresh, inboxTracks);
      if (vsInbox.fresh.length > 0) {
        await addItems(
          inbox.id,
          vsInbox.fresh.map((t) => t.uri),
        );
      }

      return [
        `おすすめ用プレイリスト: ${inbox.name} (${inbox.id})${created ? ' ※新規作成' : ''}`,
        `https://open.spotify.com/playlist/${inbox.id}`,
        '',
        `追加 ${vsInbox.fresh.length}曲:`,
        ...vsInbox.fresh.map(line),
        ...(vsMain.duplicates.length ? ['', 'メインに既にあるため除外:', ...vsMain.duplicates.map(line)] : []),
        ...(vsInbox.duplicates.length ? ['', 'おすすめ済みのため除外:', ...vsInbox.duplicates.map(line)] : []),
      ].join('\n');
    }),
  );

  server.registerTool(
    'list_recommendations',
    {
      description: 'メインのプレイリストに対応するおすすめ用プレイリストの曲一覧を返す',
      inputSchema: z.object({ playlist: playlistArg }),
    },
    handle(async ({ playlist }) => {
      const inbox = await lookupInbox(parsePlaylistId(playlist));
      if (!inbox) return 'おすすめ用プレイリストはまだありません';
      const tracks = await playlistTracks(inbox.id);
      return [`# ${inbox.name} (${tracks.length}曲)`, ...tracks.map(line)].join('\n');
    }),
  );

  server.registerTool(
    'move_to_main',
    {
      description:
        'おすすめ用プレイリストの曲をメインのプレイリストへ移す (メインの末尾に追加し、おすすめ用から削除する)。おすすめ用に無い URI は無視する',
      inputSchema: z.object({
        playlist: playlistArg,
        uris: z
          .array(z.string().regex(/^spotify:track:[A-Za-z0-9]+$/))
          .min(1)
          .max(100),
      }),
    },
    handle(async ({ playlist, uris }) => {
      const mainId = parsePlaylistId(playlist);
      const inbox = await lookupInbox(mainId);
      if (!inbox) throw new Error('おすすめ用プレイリストが見つかりません');

      const [inboxTracks, mainTracks] = await Promise.all([playlistTracks(inbox.id), playlistTracks(mainId)]);
      const requested = new Set(uris);
      const targets = inboxTracks.filter((t) => requested.has(t.uri));
      const missing = [...requested].filter((u) => !targets.some((t) => t.uri === u));
      const { fresh } = dedupe(targets, mainTracks);

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

      return [
        `メインへ移動 ${fresh.length}曲:`,
        ...fresh.map(line),
        ...(targets.length > fresh.length
          ? ['', `メインに既にあったため削除のみ ${targets.length - fresh.length}曲`]
          : []),
        ...(missing.length ? ['', 'おすすめ用に無いため無視:', ...missing] : []),
      ].join('\n');
    }),
  );

  return server;
}

serveStdio(createServer);
