import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeEvent, runClaude, type JobStatus } from './regenerate.js';

function assistant(...content: unknown[]) {
  return { type: 'assistant', message: { content } };
}

describe('describeEvent', () => {
  it('ツール呼び出しを進捗の説明に変換する', () => {
    expect(
      describeEvent(
        assistant(
          { type: 'thinking' },
          { type: 'tool_use', name: 'WebSearch', input: { query: 'the pillows 好き おすすめ' } },
          { type: 'tool_use', name: 'WebFetch', input: { url: 'https://www.last.fm/music/x/+similar' } },
          { type: 'tool_use', name: 'mcp__spotify-recommender__search_tracks', input: { queries: [{}, {}] } },
          { type: 'tool_use', name: 'mcp__spotify-recommender__add_recommendations', input: { uris: ['a'] } },
          { type: 'tool_use', name: 'ToolSearch', input: {} },
        ),
      ),
    ).toEqual([
      'Web 検索: the pillows 好き おすすめ',
      'ページを読む: www.last.fm',
      'Spotify で 2 曲を照合',
      'おすすめ用に 1 曲を追加',
    ]);
  });

  it('assistant 以外のイベントは無視する', () => {
    expect(describeEvent({ type: 'user', message: { content: [{ type: 'tool_result' }] } })).toEqual([]);
    expect(describeEvent({ type: 'system', subtype: 'init' })).toEqual([]);
  });
});

describe('runClaude', () => {
  const original = process.env.CLAUDE_BIN;
  afterEach(() => {
    process.env.CLAUDE_BIN = original;
  });

  async function fakeClaude(lines: unknown[], exitCode = 0): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'fake-claude-'));
    const path = join(dir, 'claude');
    const body = lines.map((l) => `console.log(${JSON.stringify(JSON.stringify(l))});`).join('\n');
    await writeFile(path, `#!/usr/bin/env node\n${body}\nprocess.exit(${exitCode});\n`);
    await chmod(path, 0o755);
    return path;
  }

  const main = { id: 'main1', name: '297' };

  it('成功の result を受け取ると進捗と結果を記録して完了する', async () => {
    process.env.CLAUDE_BIN = await fakeClaude([
      assistant({ type: 'tool_use', name: 'WebSearch', input: { query: 'q' } }),
      { type: 'result', subtype: 'success', is_error: false, result: '10 曲追加しました' },
    ]);
    const job: JobStatus = { state: 'running', steps: [] };
    await runClaude(main, job);
    expect(job.steps).toEqual(['Web 検索: q']);
    expect(job.result).toBe('10 曲追加しました');
  });

  it('エラーの result や result なしの終了は失敗にする', async () => {
    process.env.CLAUDE_BIN = await fakeClaude([{ type: 'result', is_error: true, result: '上限に達しました' }]);
    await expect(runClaude(main, { state: 'running', steps: [] })).rejects.toThrow('上限に達しました');

    process.env.CLAUDE_BIN = await fakeClaude([], 1);
    await expect(runClaude(main, { state: 'running', steps: [] })).rejects.toThrow('終了コード 1');
  });
});
