import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { clearRecommendations, inboxUris } from './actions.js';

const TIMEOUT_MS = 15 * 60_000;
const MAX_STEPS = 50;

// 選曲に必要なものだけを許可する。整理画面を開く・曲を移す/却下するツールは子プロセスに使わせない
const ALLOWED_TOOLS = [
  'ToolSearch',
  'Skill',
  'WebSearch',
  'WebFetch',
  'mcp__spotify-recommender__list_playlists',
  'mcp__spotify-recommender__get_playlist_tracks',
  'mcp__spotify-recommender__list_recommendations',
  'mcp__spotify-recommender__list_rejected',
  'mcp__spotify-recommender__search_tracks',
  'mcp__spotify-recommender__add_recommendations',
];

export type JobStatus = {
  state: 'idle' | 'running' | 'done' | 'failed';
  steps: string[];
  result?: string;
  error?: string;
};

const jobs = new Map<string, JobStatus>();

export function jobStatus(mainId: string): JobStatus {
  return jobs.get(mainId) ?? { state: 'idle', steps: [] };
}

type ToolUse = { type: 'tool_use'; name: string; input?: Record<string, unknown> };

// claude -p の stream-json の1行から、画面に出す進捗の説明を作る
export function describeEvent(event: unknown): string[] {
  const e = event as { type?: string; message?: { content?: unknown } };
  if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) return [];
  return (e.message.content as { type?: string }[])
    .filter((c): c is ToolUse => c.type === 'tool_use')
    .flatMap(({ name, input = {} }) => {
      switch (name.replace('mcp__spotify-recommender__', '')) {
        case 'WebSearch':
          return [`Web 検索: ${String(input.query ?? '')}`];
        case 'WebFetch':
          try {
            return [`ページを読む: ${new URL(String(input.url)).hostname}`];
          } catch {
            return ['ページを読む'];
          }
        case 'get_playlist_tracks':
          return ['プレイリストを読み込み'];
        case 'list_recommendations':
        case 'list_rejected':
          return ['おすすめ済み・却下済みの曲を確認'];
        case 'search_tracks':
          return [`Spotify で ${Array.isArray(input.queries) ? input.queries.length : ''} 曲を照合`];
        case 'add_recommendations':
          return [`おすすめ用に ${Array.isArray(input.uris) ? input.uris.length : ''} 曲を追加`];
        default:
          return [];
      }
    });
}

function prompt(main: { id: string; name: string }): string {
  return [
    `spotify-recommend スキルに従って、Spotify のプレイリスト「${main.name}」(ID: ${main.id}) に合うおすすめ曲を 10 曲探し、add_recommendations でおすすめ用プレイリストに追加してください。`,
    'ユーザーとは対話できないので、確認が必要な場面でも自分で判断して進めてください。open_review は使わないでください。',
    '最後に、追加した曲を「曲名 — アーティスト: おすすめ理由 (どこで見つけたか)」の形で 1 曲 1 行で報告してください。',
  ].join('\n');
}

export function runClaude(main: { id: string; name: string }, job: JobStatus): Promise<void> {
  const args = [
    '-p',
    prompt(main),
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    ...ALLOWED_TOOLS,
    '--no-session-persistence',
  ];
  // Claude Code 配下から起動されると入れ子のセッションとして起動を拒否されるため、その目印を外す
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    let stderr = '';
    let finished = false;

    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    createInterface({ input: child.stdout }).on('line', (line) => {
      let event: { type?: string; is_error?: boolean; result?: string };
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      job.steps.push(...describeEvent(event));
      job.steps.splice(0, Math.max(0, job.steps.length - MAX_STEPS));
      if (event.type === 'result') {
        finished = !event.is_error;
        job.result = event.result;
      }
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (finished) resolve();
      else reject(new Error(job.result || stderr.trim() || `claude が終了コード ${code} で終了しました`));
    });
  });
}

export function startRegenerate(main: { id: string; name: string }): JobStatus {
  const current = jobs.get(main.id);
  if (current?.state === 'running') return current;

  const job: JobStatus = { state: 'running', steps: ['今のおすすめを確認'] };
  jobs.set(main.id, job);

  (async () => {
    // 新しいおすすめを追加し終えてから古い曲を消す。選曲に失敗しても手元の曲は残る
    const oldUris = await inboxUris(main.id);
    job.steps.push('Claude が選曲を開始');
    await runClaude(main, job);
    if (oldUris.length > 0) {
      job.steps.push(`前のおすすめ ${oldUris.length} 曲を削除`);
      await clearRecommendations(main.id, oldUris);
    }
    job.state = 'done';
  })().catch((e) => {
    job.state = 'failed';
    job.error = e instanceof Error ? e.message : String(e);
  });

  return job;
}
