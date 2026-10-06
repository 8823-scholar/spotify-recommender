export const reviewPage = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>おすすめの整理</title>
<style>
  :root {
    --bg: #f6f6f4;
    --card: #ffffff;
    --text: #1d1d1b;
    --muted: #6b6b66;
    --line: #e3e3de;
    --accent: #1db954;
    --accent-text: #ffffff;
    --danger: #c2410c;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #121212;
      --card: #1c1c1c;
      --text: #f0f0ec;
      --muted: #9a9a94;
      --line: #2c2c2a;
      --accent: #1ed760;
      --accent-text: #0b0b0b;
      --danger: #fb923c;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
    line-height: 1.5;
  }
  main { max-width: 720px; margin: 0 auto; padding: 32px 16px 96px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 17px; margin: 0; }
  button { font: inherit; cursor: pointer; border-radius: 999px; border: 1px solid var(--line); padding: 6px 16px; background: transparent; color: var(--text); }
  button:disabled { opacity: .5; cursor: default; }
  .reload { font-size: 13px; color: var(--muted); }
  section { margin-bottom: 40px; }
  .group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .group-sub { font-size: 13px; color: var(--muted); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px; margin-bottom: 12px; transition: opacity .2s; }
  .card.leaving { opacity: 0; }
  iframe { width: 100%; height: 80px; border: 0; border-radius: 8px; display: block; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; flex-wrap: wrap; }
  .meta { min-width: 0; }
  .title { font-weight: 600; overflow-wrap: anywhere; }
  .sub { font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
  .actions { display: flex; gap: 8px; flex-shrink: 0; }
  .move { background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-weight: 600; }
  .reject { color: var(--danger); }
  .error { color: var(--danger); font-size: 13px; margin-top: 8px; }
  .empty, .status { color: var(--muted); }
  .regen { font-size: 13px; }
  .regen.confirm { border-color: var(--danger); color: var(--danger); }
  .panel { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; font-size: 14px; }
  .panel ol { margin: 8px 0 0; padding-left: 20px; color: var(--muted); }
  .panel .result { white-space: pre-wrap; margin-top: 8px; }
  .panel .head { font-weight: 600; }
  #toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--text); color: var(--bg); padding: 8px 16px; border-radius: 999px; font-size: 14px; opacity: 0; transition: opacity .2s; pointer-events: none; max-width: calc(100% - 32px); }
  #toast.show { opacity: .92; }
</style>
</head>
<body>
<main>
  <header>
    <h1>おすすめの整理</h1>
    <button class="reload" id="reload">再読み込み</button>
  </header>
  <div id="root"><p class="status">読み込み中…</p></div>
</main>
<div id="toast" role="status"></div>
<script>
  const token = new URLSearchParams(location.search).get('t');
  const root = document.getElementById('root');
  const toast = document.getElementById('toast');
  let toastTimer;

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) node.append(c);
    return node;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  }

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { 'X-Review-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function updateCount(section) {
    const left = section.querySelectorAll('.card').length;
    section.querySelector('.count').textContent = left ? '残り ' + left + ' 曲' : 'すべて整理しました';
  }

  function trackCard(group, track, section) {
    const id = track.uri.split(':').pop();
    const album = track.year ? track.album + ' (' + track.year + ')' : track.album;
    const move = el('button', { class: 'move', text: 'メインへ移す' });
    const reject = el('button', { class: 'reject', text: '却下' });
    const error = el('div', { class: 'error', hidden: '' });
    const card = el('div', { class: 'card' }, [
      el('iframe', {
        src: 'https://open.spotify.com/embed/track/' + id + '?utm_source=generator',
        loading: 'lazy',
        allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
        title: track.name,
      }),
      el('div', { class: 'row' }, [
        el('div', { class: 'meta' }, [
          el('div', { class: 'title', text: track.name + ' — ' + track.artists.join(', ') }),
          el('div', { class: 'sub', text: album }),
        ]),
        el('div', { class: 'actions' }, [move, reject]),
      ]),
      error,
    ]);

    async function act(kind) {
      move.disabled = reject.disabled = true;
      error.hidden = true;
      try {
        await api('POST', '/api/' + kind, { main: group.main.id, uri: track.uri });
        showToast((kind === 'move' ? group.main.name + ' へ移しました: ' : '却下しました: ') + track.name);
        card.classList.add('leaving');
        setTimeout(() => { card.remove(); updateCount(section); }, 200);
      } catch (e) {
        error.textContent = '失敗しました: ' + e.message;
        error.hidden = false;
        move.disabled = reject.disabled = false;
      }
    }
    move.addEventListener('click', () => act('move'));
    reject.addEventListener('click', () => act('reject'));
    return card;
  }

  // 作り直しの結果は再読み込み後も表示し続ける
  const finished = {};
  const polling = new Set();

  function renderPanel(panel, job) {
    panel.replaceChildren();
    panel.hidden = job.state === 'idle';
    if (job.state === 'running') {
      panel.append(
        el('div', { class: 'head', text: 'Claude が選び直しています… (数分かかります)' }),
        el('ol', {}, job.steps.slice(-6).map((s) => el('li', { text: s }))),
      );
    } else if (job.state === 'done') {
      panel.append(el('div', { class: 'head', text: '新しいおすすめを追加しました' }));
      if (job.result) panel.append(el('div', { class: 'result', text: job.result }));
    } else if (job.state === 'failed') {
      panel.append(
        el('div', { class: 'head error', text: '作り直しに失敗しました。前のおすすめは残っています' }),
        el('div', { class: 'result', text: job.error || '' }),
      );
    }
  }

  // 再読み込みで要素が作り直されても追従できるよう、毎回 ID で引き直す
  function panelOf(mainId) {
    return document.querySelector('[data-panel="' + mainId + '"]');
  }

  async function watch(group) {
    if (polling.has(group.main.id)) return;
    polling.add(group.main.id);
    for (const b of document.querySelectorAll('[data-regen="' + group.main.id + '"]')) b.disabled = true;
    try {
      for (;;) {
        const job = await api('GET', '/api/regenerate?main=' + group.main.id);
        const panel = panelOf(group.main.id);
        if (panel) renderPanel(panel, job);
        if (job.state !== 'running') {
          finished[group.main.id] = job;
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (e) {
      finished[group.main.id] = { state: 'failed', steps: [], error: e.message };
    }
    polling.delete(group.main.id);
    await load();
  }

  function regenButton(group, section, panel) {
    const button = el('button', { class: 'regen', text: 'おすすめを作り直す', 'data-regen': group.main.id });
    let armed = false;
    button.addEventListener('click', async () => {
      const left = section.querySelectorAll('.card').length;
      if (left > 0 && !armed) {
        armed = true;
        button.classList.add('confirm');
        button.textContent = '残り ' + left + ' 曲を入れ替えて作り直す';
        return;
      }
      button.classList.remove('confirm');
      button.textContent = 'おすすめを作り直す';
      armed = false;
      try {
        await api('POST', '/api/regenerate', { main: group.main.id });
        delete finished[group.main.id];
        watch(group);
      } catch (e) {
        renderPanel(panel, { state: 'failed', steps: [], error: e.message });
      }
    });
    return button;
  }

  function render(groups) {
    root.replaceChildren();
    if (groups.length === 0) {
      root.append(el('p', { class: 'empty', text: 'おすすめ用プレイリストはまだありません' }));
      return;
    }
    for (const group of groups) {
      const section = el('section');
      const panel = el('div', { class: 'panel', hidden: '', 'data-panel': group.main.id });
      const button = regenButton(group, section, panel);
      section.append(
        el('div', { class: 'group-head' }, [
          el('h2', { text: group.inbox.name }),
          el('span', { class: 'group-sub count' }),
        ]),
        el('div', { class: 'row' }, [
          el('p', { class: 'group-sub', text: '「メインへ移す」で ' + group.main.name + ' に追加。「却下」した曲は今後おすすめしません' }),
          button,
        ]),
        panel,
      );
      for (const track of group.tracks) section.append(trackCard(group, track, section));
      root.append(section);
      updateCount(section);

      if (finished[group.main.id]) renderPanel(panel, finished[group.main.id]);
      if (polling.has(group.main.id)) {
        button.disabled = true;
      } else {
        api('GET', '/api/regenerate?main=' + group.main.id)
          .then((job) => { if (job.state === 'running') watch(group); })
          .catch(() => {});
      }
    }
  }

  async function load() {
    root.replaceChildren(el('p', { class: 'status', text: '読み込み中…' }));
    try {
      render(await api('GET', '/api/inboxes'));
    } catch (e) {
      root.replaceChildren(el('p', { class: 'error', text: '読み込みに失敗しました: ' + e.message }));
    }
  }

  document.getElementById('reload').addEventListener('click', load);
  load();
</script>
</body>
</html>
`;
