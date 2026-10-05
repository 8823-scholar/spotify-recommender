# spotify-recommender

Claude Code から Spotify のプレイリストを分析し、おすすめ曲を追加する MCP サーバーとスキル。

- おすすめ曲はメインとは別の「`<メイン名> のおすすめ`」(非公開) に入る。初回に自動作成される
- 聴いて気に入った曲は Claude に頼んでメインへ移す (おすすめ用からは消える)
- 推薦は Claude が行う。Spotify の Recommendations API は新規アプリでは使えないため使っていない

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
- 「〇〇のおすすめから、△△と□□をメインに移して」

## MCP ツール

| ツール                 | 内容                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| `list_playlists`       | 自分のプレイリスト一覧                                            |
| `get_playlist_tracks`  | プレイリストの全曲                                                |
| `search_tracks`        | 曲名+アーティストを Spotify の曲に解決 (確度付き)                 |
| `add_recommendations`  | おすすめ用プレイリストへ追加 (メイン・おすすめ済みとの重複は除外) |
| `list_recommendations` | おすすめ用プレイリストの曲一覧                                    |
| `move_to_main`         | おすすめ用からメインへ移動                                        |

## 制約

- 中身を読めるのは自分が所有・共同編集しているプレイリストだけ (Spotify の Development Mode の制限)
- おすすめ用とメインの対応は、おすすめ用プレイリストの説明文にある `[recommend-for:<メインのID>]` で判定している。説明文を書き換えると対応が切れる
- おすすめ用から手で消した曲は、次回以降また推薦されることがある

## 開発

```sh
npm test
npm run typecheck
npm run lint
```
