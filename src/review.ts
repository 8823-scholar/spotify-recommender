import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { listInboxes, moveToMain, rejectRecommendations } from './actions.js';
import { LIBRARY_SCOPES, PLAYBACK_SCOPES } from './config.js';
import { jobStatus, startRegenerate } from './regenerate.js';
import { reviewPage } from './review-page.js';
import { getPlaylist, libraryContains, playPlaylist, setLiked } from './spotify.js';
import { accessToken, missingScopes } from './token.js';

const TRACK_URI = /^spotify:track:[A-Za-z0-9]+$/;
const PLAYLIST_ID = /^[A-Za-z0-9]+$/;
const DEVICE_ID = /^[A-Za-z0-9_-]+$/;
const MAX_BODY = 10_000;

export type ReviewServer = { url: string; close: () => Promise<void> };

// Web Playback SDK は sdk.scdn.co のスクリプトと iframe を読み込み、Spotify のサーバーと通信する
const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://sdk.scdn.co",
  "style-src 'unsafe-inline'",
  "connect-src 'self' https://*.spotify.com wss://*.spotify.com https://*.scdn.co",
  'frame-src https://open.spotify.com https://sdk.scdn.co',
].join('; ');

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(type.startsWith('text/html') ? { 'Content-Security-Policy': PAGE_CSP } : {}),
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new Error('リクエストが大きすぎます');
  }
  return JSON.parse(raw);
}

function parseAction(body: unknown): { main: string; uri: string } {
  const { main, uri } = (body ?? {}) as Record<string, unknown>;
  if (typeof main !== 'string' || !PLAYLIST_ID.test(main) || typeof uri !== 'string' || !TRACK_URI.test(uri)) {
    throw new Error('main と uri の形式が不正です');
  }
  return { main, uri };
}

function parseMain(value: unknown): string {
  if (typeof value !== 'string' || !PLAYLIST_ID.test(value)) throw new Error('main の形式が不正です');
  return value;
}

export function startReviewServer(port: number): Promise<ReviewServer> {
  // 別サイトからこのローカルサーバーを操作されないよう、起動ごとのトークンと Host を検証する
  const token = randomBytes(24).toString('base64url');
  let host = '';

  const server: Server = createServer(async (req, res) => {
    if (req.headers.host !== host) {
      send(res, 403, { error: 'forbidden' });
      return;
    }
    const url = new URL(req.url ?? '/', `http://${host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        if (url.searchParams.get('t') !== token) {
          send(
            res,
            403,
            'URL が無効です。Claude Code か npm run review から開き直してください',
            'text/plain; charset=utf-8',
          );
          return;
        }
        send(res, 200, reviewPage, 'text/html; charset=utf-8');
        return;
      }
      if (!url.pathname.startsWith('/api/')) {
        send(res, 404, { error: 'not found' });
        return;
      }
      if (req.headers['x-review-token'] !== token) {
        send(res, 403, { error: 'forbidden' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/inboxes') {
        send(res, 200, await listInboxes());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/move') {
        const { main, uri } = parseAction(await readJson(req));
        send(res, 200, await moveToMain(main, [uri]));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/reject') {
        const { main, uri } = parseAction(await readJson(req));
        send(res, 200, await rejectRecommendations(main, [uri]));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/player-token') {
        const missing = await missingScopes(PLAYBACK_SCOPES);
        if (missing.length > 0) {
          send(res, 409, {
            error: '全曲再生には再認証が必要です。ターミナルで npm run auth を実行してから再読み込みしてください',
            missing,
          });
          return;
        }
        send(res, 200, { token: await accessToken() });
        return;
      }
      if (url.pathname === '/api/liked' || url.pathname === '/api/like') {
        if ((await missingScopes(LIBRARY_SCOPES)).length > 0) {
          send(res, 409, {
            error: 'お気に入り登録には再認証が必要です。ターミナルで npm run auth を実行してから再読み込みしてください',
          });
          return;
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/liked') {
        const uris = (url.searchParams.get('uris') ?? '').split(',').filter(Boolean);
        if (uris.length > 200 || !uris.every((u) => TRACK_URI.test(u))) throw new Error('uris の形式が不正です');
        const flags = uris.length ? await libraryContains(uris) : [];
        send(res, 200, Object.fromEntries(uris.map((u, i) => [u, flags[i] === true])));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/like') {
        const { uri, liked } = (await readJson(req)) as Record<string, unknown>;
        if (typeof uri !== 'string' || !TRACK_URI.test(uri) || typeof liked !== 'boolean') {
          throw new Error('uri と liked の形式が不正です');
        }
        await setLiked(uri, liked);
        send(res, 200, { uri, liked });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/play') {
        const { playlist, uri, device } = (await readJson(req)) as Record<string, unknown>;
        if (
          typeof playlist !== 'string' ||
          !PLAYLIST_ID.test(playlist) ||
          (uri !== undefined && (typeof uri !== 'string' || !TRACK_URI.test(uri))) ||
          typeof device !== 'string' ||
          !DEVICE_ID.test(device)
        ) {
          throw new Error('playlist・uri・device の形式が不正です');
        }
        await playPlaylist(device, playlist, uri);
        send(res, 200, {});
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/regenerate') {
        send(res, 200, jobStatus(parseMain(url.searchParams.get('main'))));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/regenerate') {
        const main = await getPlaylist(parseMain(((await readJson(req)) as { main?: unknown })?.main));
        send(res, 200, startRegenerate({ id: main.id, name: main.name }));
        return;
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  const listen = (p: number) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(p, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

  return (async () => {
    try {
      await listen(port);
    } catch (e) {
      // 既定ポートが使用中なら空きポートで起動する
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
      await listen(0);
    }
    const actual = (server.address() as AddressInfo).port;
    host = `127.0.0.1:${actual}`;
    return {
      url: `http://${host}/?t=${token}`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  })();
}

export function openInBrowser(url: string): void {
  if (process.platform === 'darwin') {
    execFile('open', [url]);
  }
}
