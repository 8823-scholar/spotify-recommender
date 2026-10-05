import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { SCOPES, clientId, redirectUri, tokenPath } from './config.js';
import { requestToken, saveToken } from './token.js';

const verifier = randomBytes(64).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('hex');
const redirect = new URL(redirectUri());

const authorizeUrl = new URL('https://accounts.spotify.com/authorize');
authorizeUrl.search = new URLSearchParams({
  client_id: clientId(),
  response_type: 'code',
  redirect_uri: redirect.toString(),
  code_challenge_method: 'S256',
  code_challenge: challenge,
  scope: SCOPES.join(' '),
  state,
}).toString();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirect);
  if (url.pathname !== redirect.pathname) {
    res.writeHead(404).end();
    return;
  }

  const finish = (status: number, message: string) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message);
    server.close();
  };

  if (url.searchParams.get('state') !== state) {
    finish(400, 'state が一致しません');
    process.exitCode = 1;
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    finish(400, `認可されませんでした: ${url.searchParams.get('error') ?? 'unknown'}`);
    process.exitCode = 1;
    return;
  }

  try {
    const token = await requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect.toString(),
      code_verifier: verifier,
    });
    await saveToken(token);
    finish(200, '認証が完了しました。このタブは閉じて構いません。');
    console.log(`認証情報を保存しました: ${tokenPath()}`);
  } catch (e) {
    finish(500, String(e));
    console.error(e);
    process.exitCode = 1;
  }
});

server.listen(Number(redirect.port), redirect.hostname, () => {
  console.log('ブラウザで次の URL を開いて Spotify にログインしてください:');
  console.log(authorizeUrl.toString());
  if (process.platform === 'darwin') {
    execFile('open', [authorizeUrl.toString()]);
  }
});
