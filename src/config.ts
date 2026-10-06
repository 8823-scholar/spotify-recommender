import { homedir } from 'node:os';
import { join } from 'node:path';

// 整理画面で全曲を再生するための権限 (Web Playback SDK と再生開始 API)
export const PLAYBACK_SCOPES = ['streaming', 'user-read-email', 'user-read-private', 'user-modify-playback-state'];

// 整理画面から曲を Spotify の「お気に入りの曲」に登録・解除するための権限
export const LIBRARY_SCOPES = ['user-library-read', 'user-library-modify'];

export const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  ...PLAYBACK_SCOPES,
  ...LIBRARY_SCOPES,
];

// Spotify は redirect URI に localhost を受け付けないため loopback IP を使う
export const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:8888/callback';

export function clientId(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  if (!id) {
    throw new Error('SPOTIFY_CLIENT_ID が設定されていません');
  }
  return id;
}

export function redirectUri(): string {
  return process.env.SPOTIFY_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;
}

export const DEFAULT_REVIEW_PORT = 8889;

export function reviewPort(): number {
  return Number(process.env.SPOTIFY_REVIEW_PORT ?? DEFAULT_REVIEW_PORT);
}

function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'spotify-recommender');
}

export function tokenPath(): string {
  return join(configDir(), 'token.json');
}

export function rejectedPath(): string {
  return join(configDir(), 'rejected.json');
}
