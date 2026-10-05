import { homedir } from 'node:os';
import { join } from 'node:path';

export const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
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
