import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { missingScopes } from './token.js';

describe('missingScopes', () => {
  const original = process.env.XDG_CONFIG_HOME;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'token-test-'));
    process.env.XDG_CONFIG_HOME = dir;
    await mkdir(join(dir, 'spotify-recommender'));
  });
  afterEach(() => {
    process.env.XDG_CONFIG_HOME = original;
  });

  async function writeToken(scope?: string) {
    const token = { access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3_600_000, scope };
    await writeFile(join(dir, 'spotify-recommender', 'token.json'), JSON.stringify(token));
  }

  it('付与済みの権限に無いものを返す', async () => {
    await writeToken('playlist-read-private streaming');
    expect(await missingScopes(['streaming', 'user-modify-playback-state'])).toEqual(['user-modify-playback-state']);
  });

  it('scope が保存されていない古いトークンは全て不足とみなす', async () => {
    await writeToken(undefined);
    expect(await missingScopes(['streaming'])).toEqual(['streaming']);
  });
});
