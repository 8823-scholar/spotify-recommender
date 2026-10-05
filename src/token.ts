import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { clientId, tokenPath } from './config.js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
// 期限ぎりぎりのトークンでリクエストが失効しないよう早めに更新する
const EXPIRY_MARGIN_MS = 60_000;

export type StoredToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export async function requestToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), ...params }),
  });
  if (!res.ok) {
    throw new Error(`トークン取得に失敗しました (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function saveToken(res: TokenResponse, previousRefreshToken?: string): Promise<StoredToken> {
  const refreshToken = res.refresh_token ?? previousRefreshToken;
  if (!refreshToken) {
    throw new Error('refresh_token が返されませんでした');
  }
  const token: StoredToken = {
    access_token: res.access_token,
    refresh_token: refreshToken,
    expires_at: Date.now() + res.expires_in * 1000,
  };
  const path = tokenPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(token, null, 2), { mode: 0o600 });
  return token;
}

async function loadToken(): Promise<StoredToken> {
  try {
    return JSON.parse(await readFile(tokenPath(), 'utf8')) as StoredToken;
  } catch {
    throw new Error(`認証情報がありません。\`npm run auth\` を実行してください (${tokenPath()})`);
  }
}

export async function refreshToken(): Promise<StoredToken> {
  const current = await loadToken();
  const res = await requestToken({
    grant_type: 'refresh_token',
    refresh_token: current.refresh_token,
  });
  return saveToken(res, current.refresh_token);
}

export async function accessToken(): Promise<string> {
  const token = await loadToken();
  if (token.expires_at - EXPIRY_MARGIN_MS > Date.now()) {
    return token.access_token;
  }
  return (await refreshToken()).access_token;
}
