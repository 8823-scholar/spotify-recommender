# spotify-recommender

Claude Code から Spotify のプレイリストを分析し、まだ知らない曲を探しておすすめする MCP サーバーとスキル。

- 推薦は Claude が行う。プレイリストの傾向をもとに Web で記事や類似アーティストを調べ、有名曲を避けて選ぶ。Spotify の Recommendations API は新規アプリでは使えないため使っていない
- おすすめ曲はメインとは別の「`<メイン名> のおすすめ`」(非公開) に入る。初回に自動作成される
- 聴いたら整理画面で曲ごとに「メインへ移す」か「却下」を選ぶ。却下した曲は記録され、以後おすすめされない

## セットアップ

### 1. Spotify アプリを作る

[Spotify for Developers Dashboard](https://developer.spotify.com/dashboard) でアプリを作成する。

- Redirect URI: `http://127.0.0.1:8888/callback`
- API: Web API
- アプリ所有者のアカウントに Spotify Premium が必要 (Development Mode の条件)

作成後の Client ID を控える。Client Secret は使わない (PKCE)。

### 2. ビルドと認証

```sh
npm install
npm run build
SPOTIFY_CLIENT_ID=<Client ID> npm run auth
```

ブラウザでログインすると `~/.config/spotify-recommender/token.json` にトークンが保存される。

### 3. Claude Code に登録

```sh
claude mcp add spotify-recommender -s user \
  -e SPOTIFY_CLIENT_ID=<Client ID> \
  -- node "$PWD/dist/server.js"

ln -s "$PWD/skills/spotify-recommend" ~/.claude/skills/spotify-recommend
```

## 使い方

Claude Code で:

- 「Spotify の〇〇におすすめ曲を足して」
- 「〇〇に合う曲を、もっと最近の曲寄りで 15 曲」
- 「おすすめを整理したい」(整理画面がブラウザで開く)
- 「〇〇のおすすめから、△△をメインに移して。□□は知ってるから却下」

整理画面は Claude Code を通さず `npm run review` でも開ける。

- 曲は画面内で全曲再生できる (Web Playback SDK)。使えないブラウザや権限不足のときは、理由を表示して埋め込みプレーヤー (プレビュー再生) に切り替わる
- 「おすすめを作り直す」を押すと、裏で `claude -p` がスキルに従って選び直す (数分)。新しい曲を追加できたら、振り分け前の曲は却下扱いにせず入れ替える

## MCP ツール

| ツール                   | 内容                                                                        |
| ------------------------ | --------------------------------------------------------------------------- |
| `list_playlists`         | 自分のプレイリスト一覧                                                      |
| `get_playlist_tracks`    | プレイリストの全曲                                                          |
| `search_tracks`          | 曲名+アーティストを Spotify の曲に解決 (確度付き)                           |
| `add_recommendations`    | おすすめ用プレイリストへ追加 (メイン・おすすめ済み・却下済みとの重複は除外) |
| `list_recommendations`   | おすすめ用プレイリストの曲一覧                                              |
| `move_to_main`           | おすすめ用からメインへ移動                                                  |
| `reject_recommendations` | おすすめ用から削除し、却下済みとして記録                                    |
| `list_rejected`          | 却下済みの曲一覧                                                            |
| `open_review`            | 整理画面をブラウザで開く                                                    |

## 制約

- 中身を読めるのは自分が所有・共同編集しているプレイリストだけ (Spotify の Development Mode の制限)
- おすすめ用とメインの対応は、おすすめ用プレイリストの説明文にある `[recommend-for:<メインのID>]` で判定している。説明文を書き換えると対応が切れる
- 却下済みの曲は `~/.config/spotify-recommender/rejected.json` に記録される。Spotify アプリでおすすめ用から手で消した曲は記録されないので、また推薦されることがある
- 整理画面は `127.0.0.1:8889` (使用中なら空きポート) で動く。URL には起動ごとのトークンが付き、それ以外からの操作は受け付けない
- 作り直しで起動する `claude -p` には、選曲に必要なツール (Web 検索・Spotify の読み取りと追加) だけを確認なしで許可している。それ以外のツールは自動で拒否される
- 全曲再生には `streaming` などの権限が要る。権限を追加する前に認証した場合は `npm run auth` をやり直す

## 開発

```sh
npm test
npm run typecheck
npm run lint
```
