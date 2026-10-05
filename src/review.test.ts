import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startReviewServer, type ReviewServer } from './review.js';

let server: ReviewServer;
let base: URL;

beforeAll(async () => {
  server = await startReviewServer(0);
  base = new URL(server.url);
});

afterAll(() => server.close());

function get(path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: base.port, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('startReviewServer', () => {
  it('正しいトークン付きの URL でだけページを返す', async () => {
    expect(await get(`/${base.search}`)).toBe(200);
    expect(await get('/')).toBe(403);
    expect(await get('/?t=wrong')).toBe(403);
  });

  it('Host が一致しないリクエストを拒否する', async () => {
    expect(await get(`/${base.search}`, { Host: `evil.example:${base.port}` })).toBe(403);
  });

  it('API はトークンヘッダーが無いと拒否する', async () => {
    expect(await get('/api/inboxes')).toBe(403);
    expect(await get('/api/inboxes', { 'X-Review-Token': 'wrong' })).toBe(403);
  });
});
