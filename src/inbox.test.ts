import { describe, expect, it } from 'vitest';
import { findInbox, inboxDescription } from './inbox.js';
import { parsePlaylistId, type Playlist } from './spotify.js';

function playlist(id: string, description: string): Playlist {
  return { id, name: id, description, owner: 'me', total: 0 };
}

describe('findInbox', () => {
  it('説明文のマーカーでメインに対応するおすすめ用プレイリストを見つける', () => {
    const playlists = [
      playlist('main1', ''),
      playlist('inbox2', inboxDescription('main2')),
      playlist('inbox1', inboxDescription('main1')),
    ];
    expect(findInbox(playlists, 'main1')?.id).toBe('inbox1');
    expect(findInbox(playlists, 'main3')).toBeUndefined();
  });
});

describe('parsePlaylistId', () => {
  it('URL・URI・ID から ID を取り出す', () => {
    expect(parsePlaylistId('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc')).toBe(
      '37i9dQZF1DXcBWIGoYBM5M',
    );
    expect(parsePlaylistId('https://open.spotify.com/intl-ja/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBe(
      '37i9dQZF1DXcBWIGoYBM5M',
    );
    expect(parsePlaylistId('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')).toBe('37i9dQZF1DXcBWIGoYBM5M');
    expect(parsePlaylistId(' 37i9dQZF1DXcBWIGoYBM5M ')).toBe('37i9dQZF1DXcBWIGoYBM5M');
  });
});
