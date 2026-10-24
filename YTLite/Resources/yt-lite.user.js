// ==UserScript==
// @name         YT Lite (iOS Safari)
// @description  動画広告の自動スキップ・広告枠の非表示・バックグラウンド再生・アプリ誘導バナーの非表示
// @version      6.1
// @match        *://m.youtube.com/*
// @match        *://www.youtube.com/*
// @match        *://youtube.com/*
// @run-at       document-start
// @inject-into  auto
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // ============================================================
  // 0. 読み込み確認用バッジ（画面左下に3秒だけ出る）
  //    動作を確認できたら SHOW_BADGE を false にしてOK
  // ============================================================
  // アプリ版の中で動いているか（アプリが先に目印を置く）
  const YTL_VERSION = '6.1';
  const IN_APP = !!window.__YTLITE_APP__;
  // アプリ版の画面の役割：'browse' = 一覧・検索用 / 'player' = 動画再生用 / '' = Safari
  const ROLE = IN_APP ? (window.__YTLITE_ROLE__ || '') : '';
  const SHOW_BADGE = !IN_APP;
  const showBadge = () => {
    if (!SHOW_BADGE || !document.body) return;
    const b = document.createElement('div');
    // page = 全機能が効く状態 / content = YouTubeの制限で一部機能だけ動く状態
    const world = (typeof window.ytcfg !== 'undefined' || typeof window.yt !== 'undefined')
      ? 'page' : 'content';
    b.textContent = 'YT Lite ON (' + world + ')';
    b.style.cssText =
      'position:fixed;left:8px;bottom:80px;z-index:2147483647;' +
      'background:#0a0;color:#fff;font:bold 12px sans-serif;' +
      'padding:4px 8px;border-radius:6px;pointer-events:none;';
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 3000);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBadge);
  } else {
    showBadge();
  }

  // ============================================================
  // 0.5 上に出るアプリ誘導バナー(Smart App Banner)を消す
  //     Safariが読む <meta name="apple-itunes-app"> を、読まれる前に削除する
  // ============================================================
  const killAppBanner = (root) => {
    root.querySelectorAll &&
      root.querySelectorAll('meta[name="apple-itunes-app"], meta[name="apple-itunes-app" i]')
        .forEach((m) => m.remove());
  };
  if (document.documentElement) {
    killAppBanner(document);
    const bannerObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'META' && (n.getAttribute('name') || '').toLowerCase() === 'apple-itunes-app') {
            n.remove();
          } else {
            killAppBanner(n);
          }
        }
      }
    });
    bannerObserver.observe(document.documentElement, { childList: true, subtree: true });
    // ページの読み込みが終わったら監視をやめる（動作を軽くするため）
    window.addEventListener('load', () => setTimeout(() => bannerObserver.disconnect(), 3000));
  }

  // ============================================================
  // 0.6 アプリ版だけ：画面の一番下（ホームバーの裏）まで使う
  //     ページに「画面の端まで使ってよい」と伝え、下のメニューバーを
  //     ホームバーの上に持ち上げて、その下を同じ色で埋める
  // ============================================================
  if (IN_APP) {
    const fixViewport = (m) => {
      const c = m.getAttribute('content') || '';
      if (!/viewport-fit/.test(c)) {
        m.setAttribute('content', c + (c ? ', ' : '') + 'viewport-fit=cover');
      }
    };
    const scanViewport = () => {
      document.querySelectorAll('meta[name="viewport"]').forEach(fixViewport);
    };
    const watchViewport = () => {
      scanViewport();
      const vpObserver = new MutationObserver(scanViewport);
      vpObserver.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('load', () => setTimeout(() => vpObserver.disconnect(), 3000));
    };
    if (document.documentElement) watchViewport();
    else document.addEventListener('DOMContentLoaded', watchViewport);

    // Web版の下メニューは隠す（アプリ側のタブバーが代わりになる）。
    // 隠すだけで残してあるので、タブの切り替えはこれを裏で押して行う。
    const appCss = `
      ytm-pivot-bar-renderer {
        display: none !important;
      }
    `;
    const addAppStyle = () => {
      const s = document.createElement('style');
      s.textContent = appCss;
      (document.head || document.documentElement).appendChild(s);
    };
    if (document.documentElement) addAppStyle();
    else document.addEventListener('DOMContentLoaded', addAppStyle);
  }

  // ============================================================
  // 0.7 広告データを読み込み前に取り除く
  //     YouTubeが受け取る動画情報(JSON)から広告の項目を削除する。
  //     広告への差し替え自体が起きなくなるので、PiPも切れにくくなる。
  // ============================================================
  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  // シーク中のサムネイル用：動画ごとのストーリーボード（場面の一覧画像）の情報を覚えておく
  const storyboardSpecs = {};
  const pruneAds = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 3) return obj;
    if (Array.isArray(obj)) {
      for (const item of obj) pruneAds(item, depth + 1);
      return obj;
    }
    try {
      const sb = obj.storyboards && obj.storyboards.playerStoryboardSpecRenderer;
      const vid = obj.videoDetails && obj.videoDetails.videoId;
      if (sb && sb.spec && vid) storyboardSpecs[vid] = sb.spec;
    } catch (_) {}
    for (const k of AD_KEYS) {
      if (k in obj) {
        try { delete obj[k]; } catch (_) {}
      }
    }
    if (obj.playerResponse) pruneAds(obj.playerResponse, depth + 1);
    if (obj.response) pruneAds(obj.response, depth + 1);
    return obj;
  };

  // YouTube自身が読み込んだデータを見る係（再生リストの並びを覚える。5.で設定）
  let onDataSeen = null;
  let ownParsing = false;   // スクリプト自身が取ったデータを読んでいる間
  // スクリプト自身が取ったデータを読む（YouTubeの画面のデータとは区別する）
  const ownJson = async (res) => {
    const txt = await res.text();
    ownParsing = true;
    try { return JSON.parse(txt); } finally { ownParsing = false; }
  };

  // ---- 動画ごとのタイトル・投稿日時を覚えておく（関連動画の表示に使う） ----
  const videoMeta = {};
  const DATE_RE = /(\d+\s*(秒|分|時間|日|週間|か月|ヶ月|カ月|年)前|\bago\b|配信済み|公開予定|プレミア公開)/;
  const metaText = (t) => !t ? '' :
    (typeof t === 'string' ? t : (t.simpleText || (t.runs || []).map((r) => r.text).join('') || t.content || ''));
  const VIEWS_RE = /回視聴|視聴回数|回再生|\bviews?\b|watching|人が視聴中/;
  const putMeta = (id, info) => {
    if (!/^[\w-]{11}$/.test(id || '')) return;
    const m = videoMeta[id] || (videoMeta[id] = {});
    for (const k of ['title', 'published', 'channel', 'views']) {
      if (info[k] && !m[k]) m[k] = String(info[k]).trim();
    }
  };
  const looksMetaRoot = (d) => d && typeof d === 'object' && !Array.isArray(d) &&
    ('contents' in d || 'onResponseReceivedEndpoints' in d || 'continuationContents' in d ||
     'onResponseReceivedActions' in d || 'response' in d);
  const noteMeta = (data) => {
    if (Array.isArray(data)) { if (!data.some(looksMetaRoot)) return; }
    else if (!looksMetaRoot(data)) return;
    let count = 0;
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 70 || ++count > 300000) return;
      if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
      const r = o.videoWithContextRenderer || o.compactVideoRenderer || o.videoRenderer || o.gridVideoRenderer;
      if (r && r.videoId) {
        putMeta(r.videoId, {
          title: metaText(r.headline) || metaText(r.title),
          published: metaText(r.publishedTimeText),
          channel: metaText(r.shortBylineText) || metaText(r.longBylineText) || metaText(r.ownerText),
          views: metaText(r.shortViewCountText) || metaText(r.viewCountText),
        });
      }
      const l = o.lockupViewModel;
      if (l && l.contentId) {
        const info = {};
        try {
          const md = l.metadata.lockupMetadataViewModel;
          info.title = metaText(md.title);
          const rows = md.metadata.contentMetadataViewModel.metadataRows || [];
          rows.forEach((row) => {
            (row.metadataParts || []).forEach((part) => {
              const tx = metaText(part.text);
              if (!tx) return;
              if (DATE_RE.test(tx)) { if (!info.published) info.published = tx; }
              else if (VIEWS_RE.test(tx)) { if (!info.views) info.views = tx; }
              else if (!info.channel) info.channel = tx;
            });
          });
        } catch (_) {}
        putMeta(l.contentId, info);
      }
      for (const k in o) walk(o[k], depth + 1);
    };
    walk(data, 0);
  };

  // JSON.parse 経由で読まれるデータ
  try {
    const origParse = JSON.parse;
    JSON.parse = function (...args) {
      const result = origParse.apply(this, args);
      try { pruneAds(result); } catch (_) {}
      try { noteMeta(result); } catch (_) {}
      try { if (onDataSeen && !ownParsing) onDataSeen(result); } catch (_) {}
      return result;
    };
  } catch (_) {}

  // fetch のレスポンス(.json())経由で読まれるデータ
  try {
    const origJson = Response.prototype.json;
    Response.prototype.json = function () {
      return origJson.call(this).then((r) => {
        try { pruneAds(r); } catch (_) {}
        try { noteMeta(r); } catch (_) {}
        try { if (onDataSeen) onDataSeen(r); } catch (_) {}
        return r;
      });
    };
  } catch (_) {}

  // ページに最初から埋め込まれているデータ
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
    try {
      let stored;
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => stored,
        set: (v) => { stored = pruneAds(v); try { noteMeta(v); } catch (_) {} try { if (onDataSeen) onDataSeen(v); } catch (_) {} },
      });
    } catch (_) {}
  }

  // ============================================================
  // 1. バックグラウンド再生
  //    YouTubeは「ページが非表示になった」ことを検知して再生を止めるので、
  //    常に「表示中」と答えるようにする。
  // ============================================================
  const hiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  // アプリ版：アプリがホーム画面などに隠れている間はアプリから教えてもらう
  //（WebViewの「非表示」の情報は、アプリが裏にいても変わらないことがあるため）
  let appAway = false;
  const isReallyHidden = () => {
    if (appAway) return true;
    try { return hiddenDesc ? hiddenDesc.get.call(document) : false; } catch (_) { return false; }
  };

  const fake = (name, value) => {
    try {
      Object.defineProperty(document, name, { get: () => value, configurable: true });
    } catch (_) { /* 失敗しても続行 */ }
  };
  fake('hidden', false);
  fake('webkitHidden', false);
  fake('visibilityState', 'visible');
  fake('webkitVisibilityState', 'visible');

  // 非表示になった瞬間の時刻を記録しつつ、イベント自体はYouTubeに届けない
  let hiddenAt = 0;
  let onReallyVisible = null;  // 画面に戻ってきたときの処理（後で設定）
  const onVisibility = (e) => {
    if (isReallyHidden()) {
      hiddenAt = Date.now();
    } else if (onReallyVisible) {
      try { onReallyVisible(); } catch (_) {}
    }
    e.stopImmediatePropagation();
  };
  for (const type of ['visibilitychange', 'webkitvisibilitychange']) {
    window.addEventListener(type, onVisibility, true);
    document.addEventListener(type, onVisibility, true);
  }

  // それでもiOSが止めてしまった場合、画面を離れた直後(1秒以内)の停止だけ再開する。
  // ロック画面やコントロールセンターから自分で止めた場合は再開しない。
  document.addEventListener('pause', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    if (Date.now() - hiddenAt < 1000) {
      setTimeout(() => { v.play().catch(() => {}); }, 150);
    }
  }, true);

  // ============================================================
  // 2. 広告枠・アプリ誘導バナーを非表示
  //    (YouTube側の仕様変更で名前が変わったら、ここに追加する)
  // ============================================================
  const css = `
    ad-slot-renderer,
    ytm-promoted-sparkles-web-renderer,
    ytm-promoted-sparkles-text-search-renderer,
    ytm-promoted-video-renderer,
    ytm-companion-ad-renderer,
    ytm-companion-slot,
    ytd-ad-slot-renderer,
    ytd-in-feed-ad-layout-renderer,
    ytd-promoted-sparkles-web-renderer,
    ytd-banner-promo-renderer,
    ytd-statement-banner-renderer,
    #masthead-ad,
    .ytp-ad-overlay-container,
    .ytp-ad-image-overlay,
    ytm-mealbar-promo-renderer,
    ytd-mealbar-promo-renderer,
    .mealbar-promo-renderer,
    ytm-upsell-dialog-renderer,
    [class*="app-promo"],
    [class*="open-app-banner"] {
      display: none !important;
    }
    html { -webkit-tap-highlight-color: transparent; }
  `;
  const addStyle = () => {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.documentElement) addStyle();
  else document.addEventListener('DOMContentLoaded', addStyle);

  // ============================================================
  // 3. 動画広告の自動スキップ
  //    広告が流れている間はミュート＋早送りして最後まで飛ばし、
  //    スキップボタンが出たら押す。
  // ============================================================
  const SKIP_BUTTONS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-container button',
  ];
  let mutedBeforeAd = null;
  let lastAdAt = 0;          // 最後に広告を検知した時刻（PiP自動復帰の判定に使う）

  const handleAds = () => {
    const player = document.querySelector('.html5-video-player');
    const video = player && player.querySelector('video');
    if (!player || !video) return;

    const adPlaying = player.classList.contains('ad-showing') ||
                      player.classList.contains('ad-interrupting');

    if (adPlaying) {
      lastAdAt = Date.now();
      if (mutedBeforeAd === null) mutedBeforeAd = video.muted;
      video.muted = true;
      try { video.playbackRate = 16; } catch (_) {}
      if (Number.isFinite(video.duration) && video.duration > 0) {
        try { video.currentTime = Math.max(0, video.duration - 0.1); } catch (_) {}
      }
      for (const sel of SKIP_BUTTONS) {
        const btn = document.querySelector(sel);
        if (btn) btn.click();
      }
    } else if (mutedBeforeAd !== null) {
      // 広告が終わったら元に戻す
      video.muted = mutedBeforeAd;
      mutedBeforeAd = null;
      if (video.playbackRate > 2) video.playbackRate = 1;
      if (video.muted) tryUnmute(video);
      // 広告が終わった直後、PiPが切れていたら戻す
      if (wantPiP && !isInPiP(video)) scheduleRePiP();
    }
  };

  setInterval(handleAds, 250);

  // ============================================================
  // 3.5 ボタンを長押しして好きな場所へ動かす（位置は覚えておく）
  //     長押し(0.45秒)で持ち上がる → 指を動かす → 離した場所に置く
  // ============================================================
  const POS_KEY = 'ytl-btn-pos';
  const loadPositions = () => {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; } catch (_) { return {}; }
  };
  const savePosition = (name, pos) => {
    try {
      const all = loadPositions();
      all[name] = pos;
      localStorage.setItem(POS_KEY, JSON.stringify(all));
    } catch (_) {}
  };
  const draggables = [];

  // 保存された位置（画面の幅・高さに対する割合）をボタンに反映
  function applySavedPosition(btn, name) {
    const pos = loadPositions()[name];
    if (!pos) return;
    const w = btn.offsetWidth || 44;
    const h = btn.offsetHeight || 44;
    const x = Math.min(Math.max(8, pos.x * window.innerWidth), window.innerWidth - w - 8);
    const y = Math.min(Math.max(8, pos.y * window.innerHeight), window.innerHeight - h - 8);
    btn.style.left = x + 'px';
    btn.style.top = y + 'px';
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
  }

  function makeDraggable(btn, name) {
    btn.setAttribute('data-ytl-drag', name);
    draggables.push({ btn, name });
    let timer = null;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let offX = 0;
    let offY = 0;

    const lift = () => {
      dragging = true;
      btn.style.transition = 'transform 0.15s';
      btn.style.transform = 'scale(1.25)';
      btn.style.outline = '2px solid rgba(255,255,255,0.9)';
      btn.style.opacity = '0.85';
    };
    const drop = () => {
      btn.style.transform = '';
      btn.style.outline = '';
      btn.style.opacity = '';
    };

    btn.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      const r = btn.getBoundingClientRect();
      offX = t.clientX - r.left;
      offY = t.clientY - r.top;
      dragging = false;
      clearTimeout(timer);
      timer = setTimeout(lift, 450);
    }, { passive: true });

    btn.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (!dragging) {
        // 長押しになる前に指が動いたら、移動はしない
        if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) clearTimeout(timer);
        return;
      }
      e.preventDefault();  // 画面がスクロールしないように
      const w = btn.offsetWidth;
      const h = btn.offsetHeight;
      const x = Math.min(Math.max(8, t.clientX - offX), window.innerWidth - w - 8);
      const y = Math.min(Math.max(8, t.clientY - offY), window.innerHeight - h - 8);
      btn.style.left = x + 'px';
      btn.style.top = y + 'px';
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
    }, { passive: false });

    const end = () => {
      clearTimeout(timer);
      if (!dragging) return;
      dragging = false;
      drop();
      // 拡大アニメーションの影響を受けないよう、指定した位置そのものを保存する
      const left = parseFloat(btn.style.left);
      const top = parseFloat(btn.style.top);
      if (Number.isFinite(left) && Number.isFinite(top)) {
        savePosition(name, { x: left / window.innerWidth, y: top / window.innerHeight });
      }
      btn.__ytlSuppressClick = true;   // 離した直後の「タップ」扱いを無視する
      setTimeout(() => { btn.__ytlSuppressClick = false; }, 250);
    };
    btn.addEventListener('touchend', end, { passive: true });
    btn.addEventListener('touchcancel', end, { passive: true });

    // 作った直後に、保存された位置へ
    requestAnimationFrame(() => applySavedPosition(btn, name));
  }

  // 移動を終えた直後のタップは、ボタン本来の動作をさせない
  window.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('[data-ytl-drag]');
    if (btn && btn.__ytlSuppressClick) {
      btn.__ytlSuppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // 画面の大きさが変わったら、割合から位置を計算し直す
  window.addEventListener('resize', (e) => {
    if (!e.isTrusted) return;
    for (const d of draggables) applySavedPosition(d.btn, d.name);
  });

  // ============================================================
  // 4. ピクチャ・イン・ピクチャ(PiP)
  //    YouTubeが付けている「PiP禁止」の設定を外し、
  //    動画ページの右下にPiPボタンを出す。
  // ============================================================
  const getMainVideo = () => {
    const player = document.querySelector('.html5-video-player');
    return (player && player.querySelector('video')) || document.querySelector('video');
  };

  const unlockPiP = (video) => {
    if (video.hasAttribute('disablepictureinpicture')) {
      video.removeAttribute('disablepictureinpicture');
    }
    try { video.disablePictureInPicture = false; } catch (_) {}
  };

  const isInPiP = (video) =>
    document.pictureInPictureElement === video ||
    (video && video.webkitPresentationMode === 'picture-in-picture');

  const togglePiP = async () => {
    const video = getMainVideo();
    if (!video) return;
    unlockPiP(video);
    try {
      if (isInPiP(video)) {
        wantPiP = false;  // ボタンで閉じた = 自動復帰しない
        if (document.exitPictureInPicture && document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (video.webkitSetPresentationMode) {
          video.webkitSetPresentationMode('inline');
        }
        return;
      }
      // タップした操作の流れの中でPiPを要求する必要があるので、再生より先に呼ぶ。
      // iPhone(Safari/アプリ)では webkitSetPresentationMode のほうが確実なので先に使う
      if (video.webkitSetPresentationMode) {
        video.webkitSetPresentationMode('picture-in-picture');
      } else if (video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      }
      if (video.paused) video.play().catch(() => {});
    } catch (_) {
      // 標準APIが失敗したらSafari独自APIで再挑戦
      try { video.webkitSetPresentationMode('picture-in-picture'); } catch (_) {}
    }
  };

  let pipBtn = null;
  const makePiPButton = () => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'ピクチャ・イン・ピクチャ');
    // アイコン（大きい四角の中に小さい四角）
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    const outer = document.createElementNS(svgNS, 'rect');
    outer.setAttribute('x', '2'); outer.setAttribute('y', '4');
    outer.setAttribute('width', '20'); outer.setAttribute('height', '16');
    outer.setAttribute('rx', '2');
    outer.setAttribute('fill', 'none');
    outer.setAttribute('stroke', '#fff');
    outer.setAttribute('stroke-width', '2');
    const inner = document.createElementNS(svgNS, 'rect');
    inner.setAttribute('x', '12'); inner.setAttribute('y', '12');
    inner.setAttribute('width', '8'); inner.setAttribute('height', '6');
    inner.setAttribute('rx', '1');
    inner.setAttribute('fill', '#fff');
    svg.appendChild(outer);
    svg.appendChild(inner);
    b.appendChild(svg);
    b.style.cssText =
      'position:fixed;right:12px;bottom:' + (IN_APP ? 16 : 96) + 'px;z-index:2147483646;' +
      'width:44px;height:44px;border-radius:22px;border:none;' +
      'background:rgba(0,0,0,0.6);display:none;' +
      'align-items:center;justify-content:center;padding:0;' +
      '-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;' +
      '-webkit-user-select:none;user-select:none;';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePiP();
    }, true);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    makeDraggable(b, 'pip');  // 長押しで移動
    return b;
  };

  // ------------------------------------------------------------
  // 4.5 広告や次の動画への切り替えでPiPが閉じたら自動で戻す
  //     自分で閉じた場合(広告と関係ないタイミング)は戻さない
  // ------------------------------------------------------------
  let wantPiP = false;       // ユーザーがPiPを使いたい状態か
  let lastLoadStartAt = 0;   // 動画の中身が切り替わった時刻

  const tryEnterPiP = () => {
    const video = getMainVideo();
    if (!video || isInPiP(video)) return;
    unlockPiP(video);
    try {
      if (video.webkitSetPresentationMode) {
        video.webkitSetPresentationMode('picture-in-picture');
      } else if (video.requestPictureInPicture) {
        video.requestPictureInPicture().catch(() => {});
      }
    } catch (_) {}
  };

  let rePiPTimer = null;
  const scheduleRePiP = () => {
    if (rePiPTimer) return;
    let tries = 0;
    rePiPTimer = setInterval(() => {
      const video = getMainVideo();
      tries++;
      if (!wantPiP || (video && isInPiP(video)) || tries > 20) {
        clearInterval(rePiPTimer);
        rePiPTimer = null;
        return;
      }
      tryEnterPiP();
    }, 300);
  };

  const onPiPEnter = () => { wantPiP = true; };
  let lastSwitchAt = 0;      // スクリプトが次の動画へ切り替えた時刻
  let lastRePiPAskAt = 0;
  // アプリ版に「PiPを開き直して」と頼む（アプリが前面にいれば開き直せる）
  const askNativeRePiP = () => {
    if (!IN_APP || Date.now() - lastRePiPAskAt < 3000) return;
    lastRePiPAskAt = Date.now();
    postNative({ rePiP: true });
  };

  const onPiPLeave = () => {
    if (!wantPiP) { setTimeout(refreshStaleInfo, 800); return; }   // PiPを閉じた → 情報が古ければ更新
    const leftAt = Date.now();
    // 閉じた直後は「次の動画の読み込み」がまだ始まっていないことがあるので、少し待ってから判断する
    setTimeout(() => {
      const player = document.querySelector('.html5-video-player');
      const adNow = player && (player.classList.contains('ad-showing') ||
                               player.classList.contains('ad-interrupting'));
      const near = (t) => Math.abs(t - leftAt) < 3000;
      const causedBySwitch = adNow || near(lastAdAt) || near(lastLoadStartAt) || near(lastSwitchAt);
      if (causedBySwitch) {
        scheduleRePiP();
        askNativeRePiP();
      } else {
        // 動画の切り替えと関係ないタイミングで閉じた = 自分で閉じた
        wantPiP = false;
        // PiPを閉じて画面で見る状態に戻った → 情報が古ければ更新
        setTimeout(refreshStaleInfo, 500);
      }
    }, 1200);
  };

  document.addEventListener('enterpictureinpicture', onPiPEnter, true);
  document.addEventListener('leavepictureinpicture', onPiPLeave, true);
  document.addEventListener('webkitpresentationmodechanged', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    if (v.webkitPresentationMode === 'picture-in-picture') onPiPEnter();
    else setTimeout(onPiPLeave, 0);
  }, true);
  document.addEventListener('loadstart', (e) => {
    if (e.target instanceof HTMLVideoElement) lastLoadStartAt = Date.now();
  }, true);
  document.addEventListener('playing', (e) => {
    if (e.target instanceof HTMLVideoElement && wantPiP && !isInPiP(e.target)) {
      scheduleRePiP();
      askNativeRePiP();
    }
  }, true);

  const isWatchPage = () => /^\/(watch|shorts|live)\b/.test(location.pathname);

  const updatePiP = () => {
    const video = getMainVideo();
    if (video) unlockPiP(video);

    if (!document.body) return;
    if (!pipBtn) {
      pipBtn = makePiPButton();
    }
    if (!pipBtn.isConnected) document.body.appendChild(pipBtn);
    pipBtn.style.display = (video && isWatchPage() && !landOn) ? 'flex' : 'none';
    // 切り替えでPiPが閉じたままなら、ボタンを赤くして「タップで戻せる」と知らせる
    const needRestore = video && wantPiP && !isInPiP(video);
    pipBtn.style.background = needRestore ? 'rgba(230,30,30,0.9)' : 'rgba(0,0,0,0.6)';
    pipBtn.style.boxShadow = needRestore ? '0 0 0 4px rgba(230,30,30,0.35)' : 'none';
  };

  setInterval(updatePiP, 500);

  // ============================================================
  // 5. PiP・バックグラウンド中でも次の動画を自動再生
  //    動画が終わってもYouTube自身が次に進まなかったときだけ、
  //    同じプレーヤーに次の動画を読み込む（ページ移動しないのでPiPが切れにくい）。
  //    いらなければ AUTOPLAY_NEXT を false に。
  // ============================================================
  const AUTOPLAY_NEXT = true;
  const playedIds = [];
  const ID_RE = /^[\w-]{11}$/;

  const getPlayerApi = () => {
    const p = document.getElementById('movie_player') ||
              document.querySelector('.html5-video-player');
    return p && typeof p.loadVideoById === 'function' ? p : null;
  };

  const getCurrentId = () => {
    const api = getPlayerApi();
    try {
      const d = api && api.getVideoData && api.getVideoData();
      if (d && d.video_id) return d.video_id;
    } catch (_) {}
    try { return new URL(location.href).searchParams.get('v'); } catch (_) { return null; }
  };

  // YouTubeのデータから「次に再生する動画」の候補を取り出す
  const extractNextIds = (data) => {
    const priority = [];
    const others = [];
    let count = 0;
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 60 || ++count > 200000) return;
      if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
      const auto = o.autoplayVideo && o.autoplayVideo.watchEndpoint;
      if (auto && ID_RE.test(auto.videoId || '')) priority.push(auto.videoId);
      const overlay = o.playerOverlayAutoplayRenderer;
      if (overlay && ID_RE.test(overlay.videoId || '')) priority.push(overlay.videoId);
      if (o.watchEndpoint && ID_RE.test(o.watchEndpoint.videoId || '')) others.push(o.watchEndpoint.videoId);
      for (const k in o) walk(o[k], depth + 1);
    };
    walk(data, 0);
    const seen = new Set();
    return [...priority, ...others].filter((id) => !seen.has(id) && seen.add(id));
  };

  // 今の動画の「関連動画」をYouTubeから取得
  const fetchNextIds = async (videoId) => {
    const cfg = window.ytcfg;
    const get = (k) => {
      try { return cfg.get(k); } catch (_) { return cfg && cfg.data_ && cfg.data_[k]; }
    };
    const context = cfg && get('INNERTUBE_CONTEXT');
    if (!context || !videoId) return [];
    const key = get('INNERTUBE_API_KEY');
    const headers = { 'Content-Type': 'application/json' };
    const cname = get('INNERTUBE_CONTEXT_CLIENT_NAME');
    const cver = get('INNERTUBE_CLIENT_VERSION');
    if (cname) headers['X-YouTube-Client-Name'] = String(cname);
    if (cver) headers['X-YouTube-Client-Version'] = String(cver);
    const res = await fetch('/youtubei/v1/next?prettyPrint=false' + (key ? '&key=' + key : ''), {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ context, videoId }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return extractNextIds(await ownJson(res));
  };

  // 画面に出ている動画リンクから候補を拾う（最後の手段）
  const domIds = () => {
    const out = [];
    document.querySelectorAll('a[href*="/watch?v="]').forEach((a) => {
      try {
        const id = new URL(a.href, location.href).searchParams.get('v');
        if (id && ID_RE.test(id)) out.push(id);
      } catch (_) {}
    });
    return [...new Set(out)];
  };

  // ---- 再生リスト：順番どおりに次の動画を決める ----
  // 今見ている再生リストのID（URL → プレーヤーの順で調べる）
  const currentListId = () => {
    try {
      const l = new URL(location.href).searchParams.get('list');
      if (l) return l;
    } catch (_) {}
    try {
      const api = getPlayerApi();
      const l = api && api.getPlaylistId && api.getPlaylistId();
      if (l) return l;
    } catch (_) {}
    return null;
  };
  const listIndexOf = {};   // 動画ID → 再生リストの中の番号
  // 動画を開くURL（再生リストの中なら、リストと番号も付けて順番を保つ）
  const watchUrl = (id, extra) => {
    let u = '/watch?v=' + id;
    const list = currentListId();
    if (list) {
      u += '&list=' + encodeURIComponent(list);
      if (listIndexOf[id] !== undefined) u += '&index=' + (listIndexOf[id] + 1);
    }
    return u + (extra || '');
  };
  // 再生リストの中身を順番どおりに取得して、今の動画の「次」を返す
  // 再生リストの並び（[{id, index}]）を、YouTubeのデータから取り出す。
  // 部品の名前が変わっても拾えるように、「playlist」の中の contents を順に見て、各項目の最初の動画IDを使う
  const extractPlaylistItems = (data, listId) => {
    const lists = [];
    let count = 0;
    const firstVideo = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 12) return null;
      const we = o.watchEndpoint;
      if (we && ID_RE.test(we.videoId || '')) return { id: we.videoId, index: Number.isFinite(we.index) ? we.index : null };
      if (typeof o.videoId === 'string' && ID_RE.test(o.videoId)) return { id: o.videoId, index: null };
      if (typeof o.contentId === 'string' && ID_RE.test(o.contentId)) return { id: o.contentId, index: null };
      for (const k in o) {
        const r = firstVideo(o[k], depth + 1);
        if (r) return r;
      }
      return null;
    };
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 40 || ++count > 300000) return;
      if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
      const pl = o.playlist && o.playlist.playlist ? o.playlist.playlist : (o.playlistPanelRenderer || null);
      if (pl && Array.isArray(pl.contents) && (!listId || !pl.playlistId || pl.playlistId === listId)) lists.push(pl.contents);
      for (const k in o) walk(o[k], depth + 1);
    };
    walk(data, 0);
    for (const contents of lists) {
      const items = [];
      contents.forEach((c, i) => {
        const v = firstVideo(c, 0);
        if (v) items.push({ id: v.id, index: v.index === null ? i : v.index });
      });
      if (items.length) return items;
    }
    return [];
  };
  // 画面に出ている再生リストの一覧（リンクの list= と index= ）から並びを作る
  const playlistItemsFromDom = (listId) => {
    const items = [];
    const seen = new Set();
    document.querySelectorAll('a[href*="list="]').forEach((a) => {
      try {
        const u = new URL(a.href, location.href);
        const id = u.searchParams.get('v');
        const idx = parseInt(u.searchParams.get('index'), 10);
        if (u.searchParams.get('list') !== listId || !ID_RE.test(id || '') || !Number.isFinite(idx)) return;
        const k = id + '@' + idx;
        if (seen.has(k)) return;
        seen.add(k);
        items.push({ id, index: idx - 1 });
      } catch (_) {}
    });
    return items.sort((a, b) => a.index - b.index);
  };
  // 画面に出ている（YouTube自身が読み込んだ）再生リストの並びを覚えておく。
  // ミックスリストは問い合わせるたびに中身が変わるので、画面と同じ並びを使うのが大事
  const pageLists = {};
  onDataSeen = (data) => {
    if (!data || typeof data !== 'object') return;
    if (!looksMetaRoot(data) && !(Array.isArray(data) && data.some(looksMetaRoot))) return;
    const lid = currentListId();
    const items = extractPlaylistItems(data, null);
    if (!items.length) return;
    // どの再生リストのものか（データに書いてあればそれ、なければ今のリスト）
    let found = null;
    try {
      const walk = (o, d) => {
        if (found || !o || typeof o !== 'object' || d > 40) return;
        if (o.playlist && o.playlist.playlist && o.playlist.playlist.playlistId) { found = o.playlist.playlist.playlistId; return; }
        for (const k in o) walk(o[k], d + 1);
      };
      walk(data, 0);
    } catch (_) {}
    const key = found || lid;
    if (!key) return;
    pageLists[key] = items;
    items.forEach((it) => { listIndexOf[it.id] = it.index; });
  };

  // 再生リストの中身を順番どおりに取得して、今の動画の「次」を返す
  const fetchPlaylistNext = async (current, listId) => {
    if (!current || !listId) return undefined;
    const cfg = window.ytcfg;
    const get = (k) => { try { return cfg.get(k); } catch (_) { return cfg && cfg.data_ && cfg.data_[k]; } };
    const context = cfg ? get('INNERTUBE_CONTEXT') : null;
    const key = cfg ? get('INNERTUBE_API_KEY') : null;
    // 今の動画が再生リストの何番目か（URLの index= を使う）
    try {
      const u = new URL(location.href);
      const ix = parseInt(u.searchParams.get('index'), 10);
      if (u.searchParams.get('v') === current && Number.isFinite(ix) && listIndexOf[current] === undefined) listIndexOf[current] = ix - 1;
    } catch (_) {}

    const ask = async (ctx) => {
      const body = { context: ctx, videoId: current, playlistId: listId };
      if (listIndexOf[current] !== undefined) body.playlistIndex = listIndexOf[current];
      const res = await fetch('/youtubei/v1/next?prettyPrint=false' + (key ? '&key=' + key : ''), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const txt = await res.text();
      let data;
      ownParsing = true;
      try { data = JSON.parse(txt); } finally { ownParsing = false; }
      return extractPlaylistItems(data, listId);
    };
    let items = [];
    const notes = [];
    const hasCur = (arr) => arr.some((it) => it.id === current);
    // ⓪ 画面に出ている並び（YouTube自身が読み込んだもの）を最優先
    if (pageLists[listId] && hasCur(pageLists[listId])) { items = pageLists[listId]; notes.push('画面データ' + items.length); }
    if (!items.length) {
      const dom = playlistItemsFromDom(listId);
      if (hasCur(dom)) { items = dom; notes.push('画面' + items.length); }
    }
    // ① スマホ版の形で ② PC版の形で ③ ページのデータから ④ 画面の一覧から
    if (!items.length && context) {
      try { items = await ask(context); notes.push('スマホ' + items.length); } catch (e) { notes.push('スマホ×' + e.message); }
      if (!items.length) {
        try {
          const c = context.client || {};
          const ver = /^2\.\d{8}/.test(c.clientVersion || '') ? c.clientVersion : '2.20261001.00.00';
          const web = { client: { clientName: 'WEB', clientVersion: ver, hl: c.hl || 'ja', gl: c.gl || 'JP' } };
          if (c.visitorData) web.client.visitorData = c.visitorData;
          items = await ask(web); notes.push('PC' + items.length);
        } catch (e) { notes.push('PC×' + e.message); }
      }
    }
    if (!items.length) {
      try { items = extractPlaylistItems(window.ytInitialData, listId); notes.push('初期' + items.length); } catch (_) {}
    }
    if (!items.length) { items = playlistItemsFromDom(listId); notes.push('画面' + items.length); }
    dbg('再生リスト取得: ' + notes.join(' '));
    if (!items.length) return undefined;   // 再生リストの情報が取れなかった

    // 今の動画の位置（同じ動画が2回入っていることもあるので、覚えている番号を優先）
    let pos = -1;
    if (listIndexOf[current] !== undefined) pos = items.findIndex((it) => it.id === current && it.index === listIndexOf[current]);
    if (pos < 0) pos = items.findIndex((it) => it.id === current);
    items.forEach((it) => { if (listIndexOf[it.id] === undefined) listIndexOf[it.id] = it.index; });
    if (pos >= 0) listIndexOf[current] = items[pos].index;
    let nx = null;
    if (pos >= 0) nx = items[pos + 1];
    else if (listIndexOf[current] !== undefined) nx = items.find((it) => it.index === listIndexOf[current] + 1);
    else nx = items[0];
    if (!nx) return null;                  // 再生リストの最後
    listIndexOf[nx.id] = nx.index;
    return nx.id;
  };

  // ------------------------------------------------------------
  // 動作確認用ログ（画面左上）。原因がわかったら DEBUG を false に
  // ------------------------------------------------------------
  const DEBUG = !IN_APP;
  const dbgLines = [];
  let dbgBox = null;
  let dbgHideTimer = null;
  let dbgSinceAway = 0;      // アプリ版：裏にいる間に記録した行数
  const dbg = (msg) => {
    try { console.log('[YT Lite]', msg); } catch (_) {}
    const t = new Date();
    const stamp = String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
    dbgLines.push(stamp + ' ' + msg);
    while (dbgLines.length > 12) dbgLines.shift();
    if (isReallyHidden()) dbgSinceAway++;
    if (!DEBUG) return;   // アプリ版は、アプリに戻ったときにまとめて表示する
    showDbg();
  };
  const showDbg = () => {
    if (!document.body) return;
    if (!dbgBox) {
      dbgBox = document.createElement('div');
      dbgBox.style.cssText =
        'position:fixed;left:8px;top:60px;z-index:2147483647;max-width:75vw;' +
        'background:rgba(0,0,0,0.8);color:#7f7;font:11px/1.4 monospace;' +
        'padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre-wrap;';
    }
    if (!dbgBox.isConnected) document.body.appendChild(dbgBox);
    dbgBox.textContent = dbgLines.join('\n');
    dbgBox.style.display = 'block';
    clearTimeout(dbgHideTimer);
    dbgHideTimer = setTimeout(() => { if (dbgBox) dbgBox.style.display = 'none'; }, DEBUG ? 60000 : 15000);
  };

  // プレーヤーの状態をログ用の文字列にする
  // state: -1=未開始 0=終了 1=再生中 2=停止 3=読み込み中 5=準備完了
  // ready: 0〜4（4ならデータ十分） / 裏: 本当に画面外にいるか
  const vstate = (v) => {
    const api = getPlayerApi();
    let ps = '?';
    try { ps = api && api.getPlayerState ? api.getPlayerState() : '?'; } catch (_) {}
    return 'state=' + ps + ' ready=' + v.readyState + ' paused=' + v.paused +
      ' err=' + (v.error ? v.error.code : '-') + ' 裏=' + isReallyHidden();
  };

  // 画面外で再生できなかった動画は、画面に戻ったときにページごと開き直す
  let pendingNavId = null;
  // PiPや裏で「中身だけ差し替え」たので、タイトルや説明が前の動画のままになっている印
  let staleInfo = false;
  // 再生位置を保ったままページを読み込み直して、タイトル・説明・関連動画を新しい動画のものにする
  function refreshStaleInfo() {
    if (!staleInfo) return;
    const v = getMainVideo();
    if (v && isInPiP(v)) return;          // PiPで見ている間は待つ（閉じたら更新）
    if (isReallyHidden()) return;         // 画面に出ていない間も待つ
    staleInfo = false;
    const id = getCurrentId();
    if (!id) return;
    const t = v ? Math.floor(v.currentTime) : 0;
    dbg('動画の情報を更新');
    location.assign(watchUrl(id, t > 3 ? '&t=' + t + 's' : ''));
  }

  // 念のため：画面で見ている状態に戻っているのに情報が古いままなら更新する
  setInterval(() => {
    if (!staleInfo || landOn || isReallyHidden()) return;
    const v = getMainVideo();
    if (v && isInPiP(v)) return;
    refreshStaleInfo();
  }, 2000);

  onReallyVisible = () => {
    if (!pendingNavId) { setTimeout(refreshStaleInfo, 800); return; }
    const id = pendingNavId;
    pendingNavId = null;
    const v = getMainVideo();
    if (v && !v.paused) return;  // その間に再生が始まっていれば何もしない
    dbg('画面に戻ったので開き直す');
    location.assign(watchUrl(id));
  };

  // 読み込んだあと、再生が始まるまで手を変えて再生をかける
  const ensurePlaying = (targetId) => {
    let tries = 0;
    let triedMuted = false;
    const t = setInterval(() => {
      tries++;
      const v = getMainVideo();
      if (!v) { if (tries > 15) clearInterval(t); return; }

      if (!v.paused && !v.ended && v.readyState >= 3) {
        clearInterval(t);
        dbg('再生開始OK' + (triedMuted ? '（ミュート経由）' : ''));
        postNative({ bridge: false });
        if (triedMuted) {
          v.muted = false;
          setTimeout(() => {
            if (v.paused) dbg('ミュート解除で止められた');
          }, 1000);
        }
        return;
      }

      if (tries === 1 || tries === 6 || tries === 11) dbg(vstate(v));

      if (tries > 15) {
        clearInterval(t);
        if (triedMuted) v.muted = false;
        dbg('再生が始まらない');
        if (!isReallyHidden()) {
          dbg('ページ移動で再挑戦');
          location.assign(watchUrl(targetId));
        } else {
          pendingNavId = targetId;
          dbg('画面に戻ったら開き直す');
        }
        return;
      }

      const api = getPlayerApi();
      try { api && api.playVideo && api.playVideo(); } catch (_) {}

      // 普通に再生できなければ、iOSが許可しやすいミュート状態で再生を試す
      if (tries >= 5 && !triedMuted) {
        triedMuted = true;
        v.muted = true;
        dbg('ミュートで再生を試す');
      }
      v.play().catch((err) => {
        // AbortError は「読み込みが始まって指示が上書きされた」だけなので無視
        if (err.name !== 'AbortError' && (tries === 1 || tries === 5)) dbg('play拒否: ' + err.name);
      });
    }, 700);
  };

  // 関連動画から、最近見ていないものを1本選ぶ
  let lastNextFromList = false;
  const findNextId = async (current) => {
    lastNextFromList = false;
    dbg('次を探す: 今=' + current + ' リスト=' + (currentListId() || 'なし'));
    // 再生リストの中なら、リストの順番どおりに
    const listId = currentListId();
    if (listId) {
      try {
        const n = await fetchPlaylistNext(current, listId);
        if (n) { dbg('再生リストの次: ' + n + '（' + ((listIndexOf[n] || 0) + 1) + '番目）'); lastNextFromList = true; return n; }
        if (n === null) dbg('再生リストの最後まで来た');
      } catch (err) { dbg('再生リストの取得失敗: ' + err.message); }
    }
    const recent = new Set(playedIds.slice(-50));
    const pick = (ids) => ids.find((id) => id !== current && !recent.has(id));
    let next = null;
    try {
      const ids = await fetchNextIds(current);
      dbg('関連動画(取得): ' + ids.length + '件');
      next = pick(ids);
    } catch (err) { dbg('関連動画の取得失敗: ' + err.message); }
    if (!next) {
      try {
        const ids = extractNextIds(window.ytInitialData);
        dbg('関連動画(初期データ): ' + ids.length + '件');
        next = pick(ids);
      } catch (_) {}
    }
    if (!next) {
      const ids = domIds();
      dbg('関連動画(画面): ' + ids.length + '件');
      next = pick(ids);
    }
    return next || null;
  };

  // 終わる少し前に次の動画を決めておく（切り替えの瞬間に待たないため）
  let prefetched = null;     // { forId, nextId }
  let prefetching = false;

  let advancing = false;
  const playNext = async () => {
    if (advancing) return;
    advancing = true;
    try {
      let api = getPlayerApi();
      const current = getCurrentId();
      dbg('次へ進む処理開始 / API: ' + (api ? 'あり' : 'なし'));
      lastSwitchAt = Date.now();
      // 裏やPiPで切り替えるときは、アプリ版に「つなぎ」を頼む（Safariでは何もしない）
      {
        const vNow = getMainVideo();
        if (isReallyHidden() || (vNow && isInPiP(vNow))) postNative({ bridge: true });
      }
      if (current && playedIds[playedIds.length - 1] !== current) playedIds.push(current);

      // 再生リストならその次の動画へ
      let listId = null;
      try { listId = api && api.getPlaylistId && api.getPlaylistId(); } catch (_) {}
      if (!listId) { try { listId = new URL(location.href).searchParams.get('list'); } catch (_) {} }
      const vCur = getMainVideo();
      const inBackground = isReallyHidden() || (vCur && isInPiP(vCur));
      // 先読みしてあればそれを使い、なければここで探す（再生リストならリストの順番）
      let next = (prefetched && prefetched.forId === current) ? prefetched.nextId : null;
      if (next) dbg('先読み済みの次の動画を使う');
      else next = await findNextId(current);
      if (!next && listId && api && typeof api.nextVideo === 'function') {
        // 再生リストの中身が取れなかったときだけ、プレーヤーの「次へ」に任せる
        dbg('再生リストの次へ（プレーヤー任せ）');
        if (inBackground) staleInfo = true;
        api.nextVideo();
        setTimeout(() => ensurePlaying(getCurrentId()), 500);
        if (wantPiP) scheduleRePiP();
        return;
      }
      if (!next) { dbg('次の動画が見つからない'); return; }
      dbg('次: ' + next);
      playedIds.push(next);

      // 画面で見ているときは、ページごと移動（タイトルや説明もちゃんと新しくなる）
      if (!inBackground) {
        dbg('ページごと次の動画へ');
        location.assign(watchUrl(next));
        return;
      }

      let loaded = false;
      if (api) {
        try { api.loadVideoById(next); loaded = true; }
        catch (err) { dbg('loadVideoById失敗: ' + err.message); }
      }
      if (loaded) {
        staleInfo = true;   // 画面に戻ったときにページを読み込み直して情報を更新する
        // アドレスバーのURLだけ新しい動画に合わせる（タイトルやコメント欄は再読み込みで更新）
        try { history.replaceState(history.state, '', watchUrl(next)); } catch (_) {}
        ensurePlaying(next);
        if (wantPiP) scheduleRePiP();
      } else {
        // 最終手段：ページごと移動（PiPは切れる）
        dbg('ページ移動で次へ');
        location.assign(watchUrl(next));
      }
    } finally {
      setTimeout(() => { advancing = false; }, 3000);
    }
  };

  // 動画の終わりを検知（endedイベント＋1秒ごとの見張りの二重チェック）
  let endHandledFor = null;
  const onMaybeEnded = (source) => {
    if (!AUTOPLAY_NEXT) return;
    if (!isWatchPage() || location.pathname.startsWith('/shorts')) return;
    const player = document.querySelector('.html5-video-player');
    if (player && (player.classList.contains('ad-showing') ||
                   player.classList.contains('ad-interrupting'))) return;
    if (Date.now() - lastAdAt < 1500) return;  // 広告の終わりは無視

    const endedId = getCurrentId();
    if (endHandledFor === endedId) return;
    endHandledFor = endedId;
    dbg('終了を検知(' + source + ')');

    // まずYouTube自身の自動再生に任せ、進まなかったときだけ自分で次へ
    setTimeout(() => {
      const vv = getMainVideo();
      if (getCurrentId() !== endedId && vv && !vv.paused) {
        dbg('YouTube側で次へ進んだ');
        return;
      }
      playNext();
    }, 1000);
  };

  document.addEventListener('ended', (e) => {
    if (e.target instanceof HTMLVideoElement) onMaybeEnded('ended');
  }, true);

  setInterval(() => {
    const v = getMainVideo();
    if (!v || !Number.isFinite(v.duration) || v.duration < 5) return;
    // 同じ動画を見直したときのためにリセット
    if (!v.paused && v.currentTime < v.duration - 2) endHandledFor = null;
    if (v.ended || (v.paused && v.currentTime >= v.duration - 1)) onMaybeEnded('見張り');
  }, 1000);

  // ------------------------------------------------------------
  // PiP・裏で再生中は「終わる直前」に次へ切り替える
  //   動画が終わって止まるとiOSがPiPを閉じ、裏からの再生も許してくれないので、
  //   再生が止まる前に次の動画へ乗り換える。
  //   普通の画面で見ているときは、これまで通りYouTube自身の自動再生に任せる。
  // ------------------------------------------------------------
  const PREFETCH_SEC = 20;   // 残り何秒で次の動画を決めておくか
  const SWITCH_SEC = 1.0;    // 残り何秒で切り替えるか（最後のこの秒数は再生されない）
  let earlySwitchedFor = null;
  let lastNearEnd = null;

  document.addEventListener('timeupdate', (e) => {
    const v = e.target;
    if (!AUTOPLAY_NEXT || !(v instanceof HTMLVideoElement)) return;
    if (v !== getMainVideo()) return;
    if (!isWatchPage() || location.pathname.startsWith('/shorts')) return;
    if (!Number.isFinite(v.duration) || v.duration < 10 || v.paused) return;
    const player = document.querySelector('.html5-video-player');
    if (player && (player.classList.contains('ad-showing') ||
                   player.classList.contains('ad-interrupting'))) return;
    if (Date.now() - lastAdAt < 1500) return;

    const current = getCurrentId();
    if (!current) return;
    const remaining = v.duration - v.currentTime;

    // 見直したときのためにリセット
    if (remaining > PREFETCH_SEC + 5 && earlySwitchedFor === current) earlySwitchedFor = null;

    // 終わり際を覚えておく（この直後にYouTubeが別の動画に進んだら、再生リストどおりか確かめる）
    if (remaining < 3) lastNearEnd = { id: current, at: Date.now() };

    // PiPか裏で再生しているとき、または再生リストの中にいるとき
    const background = isInPiP(v) || isReallyHidden();
    const inList = !!currentListId();
    if (!background && !inList) return;

    // 1) 残り20秒で次の動画を決めておく
    if (remaining < PREFETCH_SEC && !prefetching &&
        !(prefetched && prefetched.forId === current)) {
      prefetching = true;
      findNextId(current).then((id) => {
        if (id) {
          prefetched = { forId: current, nextId: id, fromList: lastNextFromList };
          dbg('先読み: ' + id);
        }
      }).finally(() => { prefetching = false; });
    }

    if (!background) return;   // 画面で見ているときの切り替えはYouTubeに任せる（違ったら下の見張りで直す）

    // 2) 残り1秒で、止まる前に次へ
    if (remaining < SWITCH_SEC && earlySwitchedFor !== current) {
      earlySwitchedFor = current;
      endHandledFor = current;  // 終了検知の側で二重に進まないように
      dbg('終わる直前に次へ切り替え（' + (isInPiP(v) ? 'PiP' : '裏') + '）');
      playNext();
    }
  }, true);

  // 裏・PiPで、YouTube自身が再生リストと違う動画に進んでしまったら、リストの次に直す
  setInterval(() => {
    const pf = prefetched;
    if (!pf || !pf.fromList) return;
    const v = getMainVideo();
    if (!v) return;
    const away = isReallyHidden() || isInPiP(v);
    // 裏・PiPのとき、または前の動画が終わった直後（＝自動で進んだ）だけ。自分で選んだ動画は直さない
    const justEnded = lastNearEnd && lastNearEnd.id === pf.forId && Date.now() - lastNearEnd.at < 15000;
    if (!away && !justEnded) return;
    const cur = getCurrentId();
    if (!cur || cur === pf.forId || cur === pf.nextId) return;
    if (Date.now() - lastSwitchAt < 4000) return;
    const api = getPlayerApi();
    if (!api) return;
    dbg('リスト外の動画(' + cur + ')に進んだので直す → ' + pf.nextId);
    prefetched = null;
    lastSwitchAt = Date.now();
    if (!away) { location.assign(watchUrl(pf.nextId)); return; }
    postNative({ bridge: true });
    try {
      api.loadVideoById(pf.nextId);
      staleInfo = true;
      try { history.replaceState(history.state, '', watchUrl(pf.nextId)); } catch (_) {}
      ensurePlaying(pf.nextId);
      if (wantPiP) scheduleRePiP();
    } catch (err) { dbg('直せなかった: ' + err.message); }
  }, 1000);

  // PiPやロック画面の「次へ」ボタンでも次の動画へ
  const setMediaHandlers = () => {
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('nexttrack', () => { playNext(); });
      }
    } catch (_) {}
  };
  setMediaHandlers();
  setInterval(setMediaHandlers, 2000);

  // ============================================================
  // 6. 横向き全画面ボタン
  //    タップ   : プレーヤーを90度回して画面いっぱいに（回転ロック中でもOK）
  //    長押し   : iOS標準の全画面プレーヤー（ホームに戻ると自動でPiPになる）
  //    もう一度タップ or 右上の×で元に戻る
  // ============================================================
  const LAND_CLASS = 'ytl-land';
  let landTarget = null;
  let landOn = false;
  let landDir = 1;  // 1 = スマホを左に倒す向き / -1 = 右に倒す向き / 0 = 縦向きのまま全画面

  // アプリ版に状態を知らせる（Safariでは何もしない）
  const postNative = (msg) => {
    try { window.webkit.messageHandlers.ytLite.postMessage(msg); } catch (_) {}
  };

  const landCss = `
    html.${LAND_CLASS}, html.${LAND_CLASS} body {
      overflow: hidden !important;
      background: #000 !important;
    }
    html.${LAND_CLASS} [data-ytl-land] {
      position: fixed !important;
      top: 0 !important; left: 0 !important; right: auto !important; bottom: auto !important;
      width: var(--ytl-w) !important; height: var(--ytl-h) !important;
      max-width: none !important; max-height: none !important;
      margin: 0 !important; padding: 0 !important;
      transform-origin: top left !important;
      transform: var(--ytl-transform) !important;
      z-index: 2147483640 !important;
      background: #000 !important;
    }
    html.${LAND_CLASS} [data-ytl-land] {
      overflow: hidden !important;
    }
    /* プレーヤーと操作バーの入れ物を、横幅基準(16:9)ではなく画面の高さに合わせる */
    html.${LAND_CLASS} [data-ytl-land] > *:not(.ytl-own),
    html.${LAND_CLASS} [data-ytl-land] #player,
    html.${LAND_CLASS} [data-ytl-land] .player-size,
    html.${LAND_CLASS} [data-ytl-land] .player-container,
    html.${LAND_CLASS} [data-ytl-land] #player-control-container,
    html.${LAND_CLASS} [data-ytl-land] #player-control-overlay,
    html.${LAND_CLASS} [data-ytl-land] ytm-custom-control,
    html.${LAND_CLASS} [data-ytl-land] .ytm-custom-control,
    html.${LAND_CLASS} [data-ytl-land] .player-controls-background-container,
    html.${LAND_CLASS} [data-ytl-land] .player-controls-background,
    html.${LAND_CLASS} [data-ytl-land] .html5-video-player,
    html.${LAND_CLASS} [data-ytl-land] .html5-video-container {
      width: 100% !important; height: 100% !important;
      max-width: none !important; max-height: none !important;
      min-height: 0 !important;
      padding-top: 0 !important; padding-bottom: 0 !important;
      margin-top: 0 !important; margin-bottom: 0 !important;
      top: 0 !important; left: 0 !important;
      aspect-ratio: auto !important;
    }
    html.${LAND_CLASS} [data-ytl-land] video {
      width: 100% !important; height: 100% !important;
      left: 0 !important; top: 0 !important;
      object-fit: contain !important;
    }
    /* ミニプレーヤー表示中は、自前のボタン類を隠す */
    /* 横全画面のボタン類は、しばらく触らないと消える */
    .ytl-land-ui { transition: opacity 0.25s; }
    html.ytl-ui-hidden .ytl-land-ui { opacity: 0 !important; pointer-events: none !important; }
    html.ytl-mini [data-ytl-drag],
    html.ytl-mini .ytl-own {
      display: none !important;
    }
    /* 全画面中は上のヘッダーなどを隠す */
    html.${LAND_CLASS} ytm-mobile-topbar-renderer,
    html.${LAND_CLASS} #header-bar,
    html.${LAND_CLASS} ytm-pivot-bar-renderer {
      display: none !important;
    }
  `;
  const addLandStyle = () => {
    const s = document.createElement('style');
    s.textContent = landCss;
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.documentElement) addLandStyle();
  else document.addEventListener('DOMContentLoaded', addLandStyle);

  const findLandTarget = () => {
    const player = document.querySelector('.html5-video-player');
    return document.getElementById('player-container-id') ||
           document.getElementById('player') ||
           (player && player.parentElement) || player;
  };

  // 画面サイズに合わせて回転・大きさを決める
  const layoutLand = () => {
    if (!landOn) return;
    // Safariのバーを除いた「実際に見えている範囲」に合わせる
    const vv = window.visualViewport;
    const w = Math.round(vv ? vv.width : window.innerWidth);
    const h = Math.round(vv ? vv.height : window.innerHeight);
    const top = Math.round(vv ? vv.offsetTop : 0);
    const left = Math.round(vv ? vv.offsetLeft : 0);
    const root = document.documentElement.style;
    if (h > w && landDir !== 0) {
      // 縦持ち → 時計回りに90度回して横長に
      root.setProperty('--ytl-w', h + 'px');
      root.setProperty('--ytl-h', w + 'px');
      const rot = landDir === -1
        ? 'rotate(-90deg) translateX(-100%)'   // 右に倒したとき
        : 'rotate(90deg) translateY(-100%)';   // 左に倒したとき
      root.setProperty('--ytl-transform',
        'translate(' + left + 'px,' + top + 'px) ' + rot);
    } else {
      // もともと横持ち → 回さずに全画面
      root.setProperty('--ytl-w', w + 'px');
      root.setProperty('--ytl-h', h + 'px');
      root.setProperty('--ytl-transform', 'translate(' + left + 'px,' + top + 'px)');
    }
    // YouTubeにプレーヤーの大きさを計算し直させる
    try { window.dispatchEvent(new Event('resize')); } catch (_) {}
  };

  let landExitBtn = null;
  const makeLandExitBtn = () => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', '全画面を終了');
    b.className = 'ytl-land-ui';
    b.textContent = '✕';
    b.style.cssText =
      'position:fixed;top:12px;right:12px;z-index:2147483647;' +
      'width:40px;height:40px;border-radius:20px;border:none;' +
      'background:rgba(0,0,0,0.5);color:#fff;font:bold 18px sans-serif;' +
      'display:none;align-items:center;justify-content:center;padding:0;' +
      '-webkit-tap-highlight-color:transparent;';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      exitLand();
    }, true);
    return b;
  };

  const enterLand = (dir) => {
    const target = findLandTarget();
    if (!target) return;
    landDir = (dir === -1 || dir === 0) ? dir : 1;
    landTarget = target;
    landTarget.setAttribute('data-ytl-land', '');
    landOn = true;
    postNative({ land: true });
    document.documentElement.classList.add(LAND_CLASS);
    layoutLand();
    if (!landExitBtn) landExitBtn = makeLandExitBtn();
    if (!landExitBtn.isConnected) document.body.appendChild(landExitBtn);
    landExitBtn.style.display = 'flex';
    setTimeout(layoutLand, 300);
  };

  const exitLand = () => {
    landOn = false;
    postNative({ land: false });
    document.documentElement.classList.remove(LAND_CLASS);
    if (landTarget) {
      landTarget.removeAttribute('data-ytl-land');
      landTarget = null;
    }
    if (landExitBtn) landExitBtn.style.display = 'none';
    try { window.dispatchEvent(new Event('resize')); } catch (_) {}
  };

  // iOS標準の全画面プレーヤー
  const enterNativeFullscreen = () => {
    const v = getMainVideo();
    if (!v) return;
    try {
      if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
      else if (v.requestFullscreen) v.requestFullscreen();
    } catch (_) {}
  };

  // 自分で送った resize（isTrusted=false）には反応しない（無限ループ防止）
  window.addEventListener('resize', (e) => { if (landOn && e.isTrusted) layoutLand(); });
  window.addEventListener('orientationchange', () => { if (landOn) setTimeout(layoutLand, 300); });
  // Safariのバーが出たり隠れたりしたときも合わせ直す
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => { if (landOn) layoutLand(); });
  }

  // ボタン本体（PiPボタンの上に置く）
  let landBtn = null;
  const makeLandButton = () => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', '横向き全画面');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    // 横長の画面＋四隅の広がる矢印
    const paths = [
      'M3 9V6h3', 'M18 6h3v3', 'M21 15v3h-3', 'M6 18H3v-3',
    ];
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', '7'); rect.setAttribute('y', '9');
    rect.setAttribute('width', '10'); rect.setAttribute('height', '6');
    rect.setAttribute('rx', '1');
    rect.setAttribute('fill', '#fff');
    svg.appendChild(rect);
    for (const d of paths) {
      const p = document.createElementNS(svgNS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', '#fff');
      p.setAttribute('stroke-width', '2');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(p);
    }
    b.appendChild(svg);
    b.style.cssText =
      'position:fixed;right:12px;bottom:' + (IN_APP ? 68 : 148) + 'px;z-index:2147483646;' +
      'width:44px;height:44px;border-radius:22px;border:none;' +
      'background:rgba(0,0,0,0.6);display:none;' +
      'align-items:center;justify-content:center;padding:0;' +
      '-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;' +
      '-webkit-user-select:none;user-select:none;';

    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (landOn) exitLand(); else enterLand(preferredLandDir());
    }, true);
    makeDraggable(b, 'land');  // 長押しで移動
    return b;
  };

  // ------------------------------------------------------------
  // 7. スマホを横にしたら自動で横全画面、縦に戻したら解除（アプリと同じ動き）
  //    回転ロック中は向きが変わらないので何も起きない。
  //    いらなければ AUTO_LAND_ON_ROTATE を false に。
  // ------------------------------------------------------------
  const AUTO_LAND_ON_ROTATE = !IN_APP;  // アプリ版ではアプリ側が向きを検知する
  let autoLanded = false;
  const landscapeMq = window.matchMedia ? window.matchMedia('(orientation: landscape)') : null;

  const onOrientation = () => {
    if (!AUTO_LAND_ON_ROTATE) return;
    const landscape = landscapeMq ? landscapeMq.matches : window.innerWidth > window.innerHeight;
    if (landscape) {
      if (!landOn && isWatchPage() && getMainVideo()) {
        enterLand(1);
        autoLanded = true;
      }
    } else if (landOn && autoLanded) {
      exitLand();
      autoLanded = false;
    } else {
      autoLanded = false;
    }
  };

  if (landscapeMq) {
    const handler = () => setTimeout(onOrientation, 300);
    if (landscapeMq.addEventListener) landscapeMq.addEventListener('change', handler);
    else if (landscapeMq.addListener) landscapeMq.addListener(handler);
  } else {
    window.addEventListener('orientationchange', () => setTimeout(onOrientation, 300));
  }

  setInterval(() => {
    if (!document.body) return;
    if (!landBtn) landBtn = makeLandButton();
    if (!landBtn.isConnected) document.body.appendChild(landBtn);
    const show = !!getMainVideo() && isWatchPage() && !landOn;
    landBtn.style.display = show ? 'flex' : 'none';
    // 動画ページから離れたら自動で解除
    if (landOn && !isWatchPage()) exitLand();
  }, 500);

  // ============================================================
  // 8. アプリ版から呼ぶための入口
  //    autoLand(1 / -1) : スマホが横になった（向き付き） / autoLand(0) : 縦に戻った
  // ============================================================
  window.ytLite = {
    autoLand: (dir) => {
      const v = getMainVideo();
      // iOS標準の全画面プレーヤーで見ているときは触らない
      if (v && (v.webkitDisplayingFullscreen || document.fullscreenElement ||
                document.webkitFullscreenElement)) return;
      if (dir === 1 || dir === -1) {
        if (!isWatchPage() || !v) return;
        if (landOn) {
          landDir = dir;
          layoutLand();
        } else {
          enterLand(dir);
          autoLanded = true;
        }
      } else if (landOn && autoLanded) {
        exitLand();
        autoLanded = false;
      }
    },
  };

  // ============================================================
  // 9. 画質ボタン（横全画面の中に表示）＋選んだ画質を次の動画でも使う
  // ============================================================
  const QUALITY_ORDER = ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
  const QUALITY_LABEL = {
    highres: '最高画質', hd2160: '2160p (4K)', hd1440: '1440p', hd1080: '1080p', hd720: '720p',
    large: '480p', medium: '360p', small: '240p', tiny: '144p', auto: '自動',
  };
  const QUALITY_KEY = 'ytl-quality';
  const loadQualityPref = () => {
    try { return localStorage.getItem(QUALITY_KEY); } catch (_) { return null; }
  };
  const saveQualityPref = (q) => {
    try {
      if (q && q !== 'auto') localStorage.setItem(QUALITY_KEY, q);
      else localStorage.removeItem(QUALITY_KEY);
    } catch (_) {}
  };
  const getQualityLevels = () => {
    const api = getPlayerApi();
    try {
      const lv = (api && api.getAvailableQualityLevels && api.getAvailableQualityLevels()) || [];
      return lv.filter((q) => q !== 'auto');
    } catch (_) { return []; }
  };
  const getCurrentQuality = () => {
    const api = getPlayerApi();
    try { return (api && api.getPlaybackQuality && api.getPlaybackQuality()) || ''; } catch (_) { return ''; }
  };

  // 指定の画質にする（その動画に無ければ、それより下で一番近い画質）
  const applyQuality = (q) => {
    const api = getPlayerApi();
    if (!api) return false;
    try {
      if (!q || q === 'auto') {
        if (api.setPlaybackQualityRange) api.setPlaybackQualityRange('auto');
        return true;
      }
      const levels = getQualityLevels();
      let target = q;
      if (levels.length && !levels.includes(q)) {
        const idx = Math.max(0, QUALITY_ORDER.indexOf(q));
        target = QUALITY_ORDER.slice(idx).find((l) => levels.includes(l)) || levels[0];
      }
      if (api.setPlaybackQualityRange) api.setPlaybackQualityRange(target, target);
      if (api.setPlaybackQuality) api.setPlaybackQuality(target);
      return true;
    } catch (_) { return false; }
  };

  // 新しい動画が始まったら、覚えている画質にする
  let qualityAppliedFor = null;
  document.addEventListener('playing', (e) => {
    if (ROLE === 'browse') return;   // 一覧画面のプレビューは対象外
    if (!(e.target instanceof HTMLVideoElement) || e.target !== getMainVideo()) return;
    const pref = loadQualityPref();
    if (!pref) return;
    const player = document.querySelector('.html5-video-player');
    if (player && (player.classList.contains('ad-showing') ||
                   player.classList.contains('ad-interrupting'))) return;
    const id = getCurrentId();
    if (!id || qualityAppliedFor === id) return;
    qualityAppliedFor = id;
    setTimeout(() => applyQuality(pref), 500);
  }, true);

  let qBtn = null;
  let lpBtn = null;      // 横全画面のPiPボタン（16.で作る）
  let rBtn = null;       // 向き切り替えボタン（13.で作る）
  let landToast = null;  // 向きの表示（13.で作る）
  let qMenu = null;
  const closeQualityMenu = () => { if (qMenu) qMenu.style.display = 'none'; };
  const openQualityMenu = () => {
    if (!qMenu || !landTarget) return;
    const levels = getQualityLevels();
    const current = getCurrentQuality();
    const pref = loadQualityPref() || 'auto';
    qMenu.textContent = '';
    const title = document.createElement('div');
    title.textContent = '画質（いま: ' + (QUALITY_LABEL[current] || current || '不明') + '）';
    title.style.cssText = 'padding:8px 14px;font-size:12px;opacity:0.7;';
    qMenu.appendChild(title);
    const items = ['auto', ...(levels.length ? levels : QUALITY_ORDER.slice(3))];
    for (const q of items) {
      const it = document.createElement('button');
      it.type = 'button';
      it.textContent = (q === pref ? '✓ ' : '　 ') + (QUALITY_LABEL[q] || q);
      it.style.cssText =
        'display:block;width:100%;text-align:left;border:none;background:none;color:#fff;' +
        'font:15px sans-serif;padding:10px 14px;-webkit-tap-highlight-color:transparent;';
      it.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        saveQualityPref(q);
        applyQuality(q);
        dbg('画質: ' + (QUALITY_LABEL[q] || q));
        closeQualityMenu();
      }, true);
      qMenu.appendChild(it);
    }
    // iOS標準の全画面プレーヤー（以前の「全画面ボタン長押し」の機能）
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;margin:4px 0;background:rgba(255,255,255,0.15);';
    qMenu.appendChild(sep);
    const nativeFs = document.createElement('button');
    nativeFs.type = 'button';
    nativeFs.textContent = '　 iOS標準の全画面で見る';
    nativeFs.style.cssText =
      'display:block;width:100%;text-align:left;border:none;background:none;color:#fff;' +
      'font:15px sans-serif;padding:10px 14px;-webkit-tap-highlight-color:transparent;';
    nativeFs.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeQualityMenu();
      exitLand();
      enterNativeFullscreen();
    }, true);
    qMenu.appendChild(nativeFs);
    // 再生バーの表示（押すたびに 虹＋キャラ → 虹だけ → 標準）
    if (window.__ytlGetRbMode) {
      const labels = { all: '虹＋キャラ', rainbow: '虹だけ', off: '標準' };
      const next = { all: 'rainbow', rainbow: 'off', off: 'all' };
      const rb = document.createElement('button');
      rb.type = 'button';
      rb.textContent = '　 再生バー：' + labels[window.__ytlGetRbMode()];
      rb.style.cssText = nativeFs.style.cssText;
      rb.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const m = window.__ytlSetRbMode(next[window.__ytlGetRbMode()]);
        rb.textContent = '　 再生バー：' + labels[m];
      }, true);
      qMenu.appendChild(rb);
    }
    const ver = document.createElement('div');
    ver.textContent = (IN_APP ? 'yo!!tube' : 'YT Lite') + ' v' + YTL_VERSION + (IN_APP ? '（アプリ）' : '（Safari）');
    ver.style.cssText = 'padding:6px 14px 8px;font-size:11px;opacity:0.5;';
    qMenu.appendChild(ver);
    qMenu.style.display = 'block';
  };

  const makeQualityUi = () => {
    qBtn = document.createElement('button');
    qBtn.className = 'ytl-own ytl-land-ui';
    qBtn.type = 'button';
    qBtn.setAttribute('aria-label', '画質');
    qBtn.textContent = '画質';
    qBtn.style.cssText =
      'position:absolute;top:12px;right:12px;z-index:2147483645;' +
      'height:34px;padding:0 12px;border-radius:17px;border:none;' +
      'background:rgba(0,0,0,0.55);color:#fff;font:bold 13px sans-serif;' +
      '-webkit-tap-highlight-color:transparent;';
    qBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (qMenu.style.display === 'block') closeQualityMenu(); else openQualityMenu();
    }, true);
    qMenu = document.createElement('div');
    qMenu.className = 'ytl-own';
    qMenu.style.cssText =
      'position:absolute;top:52px;right:12px;z-index:2147483645;display:none;' +
      'min-width:170px;max-height:calc(100% - 64px);overflow-y:auto;' +
      'background:rgba(28,28,28,0.95);border-radius:10px;padding:4px 0;color:#fff;';
    // メニューの外をタップしたら閉じる
    document.addEventListener('click', (e) => {
      if (qMenu && qMenu.style.display === 'block' && !qMenu.contains(e.target) && e.target !== qBtn) {
        closeQualityMenu();
      }
    }, true);
  };

  setInterval(() => {
    if (landOn && landTarget) {
      if (!qBtn) makeQualityUi();
      if (qBtn.parentNode !== landTarget) landTarget.appendChild(qBtn);
      if (qMenu.parentNode !== landTarget) landTarget.appendChild(qMenu);
      if (!rBtn) rBtn = makeRotateButton();
      if (rBtn.parentNode !== landTarget) landTarget.appendChild(rBtn);
      if (!lpBtn) lpBtn = makeLandPiPButton();
      if (lpBtn.parentNode !== landTarget) landTarget.appendChild(lpBtn);
    } else if (qBtn && qBtn.parentNode) {
      closeQualityMenu();
      qBtn.remove();
      qMenu.remove();
      if (rBtn) rBtn.remove();
      if (lpBtn) lpBtn.remove();
    }
  }, 300);

  // ============================================================
  // 10. アプリ版から呼ぶ入口（自動PiP・裏での切り替えの押し直し）
  // ============================================================
  let autoPiPStarted = false;
  Object.assign(window.ytLite = window.ytLite || {}, {
    // アプリの↻ボタン：見ている位置のまま、動画の情報を読み込み直す
    refreshInfo: () => {
      const id = getCurrentId();
      if (!id || !isWatchPage() || location.pathname.startsWith('/shorts')) { location.reload(); return; }
      const v = getMainVideo();
      const t = v ? Math.floor(v.currentTime) : 0;
      staleInfo = false;
      location.assign(watchUrl(id, t > 3 ? '&t=' + t + 's' : ''));
    },
    // ホームに戻る瞬間にアプリから呼ばれる（自動PiPはやめたので、裏に回ったことを覚えるだけ）
    autoPiP: () => {
      appAway = true;
      return false;
    },
    // アプリに戻ってきたら、自動で開いたPiPは閉じて元の画面に戻す
    cancelAutoPiP: () => {
      const wasAway = appAway;
      appAway = false;
      if (wasAway) setTimeout(() => { try { onReallyVisible && onReallyVisible(); } catch (_) {} }, 300);
      if (!autoPiPStarted) return;
      autoPiPStarted = false;
      const v = getMainVideo();
      if (!v || !isInPiP(v)) return;
      try {
        if (v.webkitSetPresentationMode) v.webkitSetPresentationMode('inline');
        else if (document.exitPictureInPicture) document.exitPictureInPicture().catch(() => {});
      } catch (_) {}
    },
    // アプリのタブバーから呼ばれる：Web版の下メニューを裏で押して、読み込み直さずに移動
    goTab: (name) => {
      const keys = {
        home: ['pivot-w2w', 'pivot-home'],
        shorts: ['pivot-shorts'],
        subs: ['pivot-subs', 'pivot-subscriptions'],
        you: ['pivot-library', 'pivot-you'],
      };
      const paths = { home: '/', shorts: '/shorts', subs: '/feed/subscriptions', you: '/feed/library' };
      if (!keys[name]) return 'unknown';
      if (landOn) exitLand();
      const items = document.querySelectorAll('ytm-pivot-bar-item-renderer');
      for (const it of items) {
        const tab = it.querySelector('.pivot-bar-item-tab') || it;
        const cls = String(tab.className || '').toLowerCase();
        if (keys[name].some((k) => cls.includes(k))) {
          tab.click();
          return 'click';
        }
      }
      // 見つからなければ普通にページを開く
      location.href = paths[name];
      return 'load';
    },
    // 今いるタブをもう一度押したとき：一番上へ
    scrollTop: () => {
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
    },
    // 裏で次の動画に切り替えた直後、アプリから何度か呼ばれる：止まっていたら再生し直す
    kick: () => {
      const v = getMainVideo();
      if (!v) return;
      if (v.paused || v.ended) {
        const api = getPlayerApi();
        try { if (api && api.playVideo) api.playVideo(); } catch (_) {}
        v.play().catch(() => {});
      } else {
        postNative({ bridge: false });
      }
    },
  });

  // ============================================================
  // 11. アプリ版：一覧用と再生用の2画面の役割分担
  //     一覧(browse)で動画を押したら再生用の画面へ、
  //     再生(player)でチャンネル等を押したら一覧の画面へ回す。
  // ============================================================
  const linkTarget = (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return null;
    try { return new URL(a.getAttribute('href'), location.href); } catch (_) { return null; }
  };
  const isYouTubeUrl = (u) => /(^|\.)youtube\.com$/.test(u.hostname);
  const isVideoUrl = (u) => u.pathname === '/watch' || u.pathname.startsWith('/live/');

  if (ROLE === 'browse') {
    window.addEventListener('click', (e) => {
      const u = linkTarget(e);
      if (!u || !isYouTubeUrl(u) || !isVideoUrl(u)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      postNative({ openVideo: u.href });
    }, true);
    // ショートの画面以外で流れる動画 = ホームや検索結果のプレビュー
    const isPreviewPage = () => !location.pathname.startsWith('/shorts');

    // ショートで音の出る動画が始まったら、再生用の画面（ミニプレーヤー）を止めてもらう
    document.addEventListener('playing', (e) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement) || isPreviewPage()) return;
      if (!v.muted && v.volume > 0) postNative({ browsePlaying: true });
    }, true);

    // ---- プレビュー再生：常にミュート、画面を触らない状態が1秒続いてから再生 ----
    const PREVIEW_IDLE_MS = 1000;
    let lastTouch = 0;
    const held = new Set();   // 操作中なので止めておいたプレビュー
    const holdPlayingPreviews = () => {
      document.querySelectorAll('video').forEach((v) => {
        if (!v.paused && !v.ended) {
          v.pause();
          held.add(v);
        }
      });
    };
    const onInteract = () => {
      lastTouch = Date.now();
      if (isPreviewPage()) holdPlayingPreviews();
    };
    for (const t of ['touchstart', 'touchmove', 'scroll', 'wheel']) {
      window.addEventListener(t, onInteract, { passive: true, capture: true });
    }
    document.addEventListener('play', (e) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement) || !isPreviewPage()) return;
      v.muted = true;                                   // プレビューは常にミュート
      if (Date.now() - lastTouch < PREVIEW_IDLE_MS) {   // 操作中 → まだ再生しない
        v.pause();
        held.add(v);
      }
    }, true);
    document.addEventListener('volumechange', (e) => {
      const v = e.target;
      if (v instanceof HTMLVideoElement && isPreviewPage() && !v.muted) v.muted = true;
    }, true);
    // 無操作が1秒続いたら、止めておいたプレビューのうち画面内にあるものを再生
    setInterval(() => {
      if (!held.size || Date.now() - lastTouch < PREVIEW_IDLE_MS) return;
      for (const v of held) {
        held.delete(v);
        if (!v.isConnected || !v.paused) continue;
        const r = v.getBoundingClientRect();
        const visible = r.bottom > 0 && r.top < window.innerHeight && r.width > 0 && r.height > 0;
        if (visible) {
          v.muted = true;
          v.play().catch(() => {});
        }
      }
    }, 200);
  }

  if (ROLE === 'player') {
    window.addEventListener('click', (e) => {
      const u = linkTarget(e);
      if (!u || !isYouTubeUrl(u) || isVideoUrl(u)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      postNative({ openBrowse: u.href });
    }, true);
    // 再生用の画面ではYouTubeの上のバーは使わない（アプリ側の﹀バーが代わり）
    const playerCss = `
      ytm-mobile-topbar-renderer, #header-bar { display: none !important; }
    `;
    const addPlayerStyle = () => {
      const st = document.createElement('style');
      st.textContent = playerCss;
      (document.head || document.documentElement).appendChild(st);
    };
    if (document.documentElement) addPlayerStyle();
    else document.addEventListener('DOMContentLoaded', addPlayerStyle);

    // 上のバーを隠した分、プレーヤーを一番上に詰める。
    // YouTubeはプレーヤーを「上のバーのすぐ下」に固定しているので、そのままだと
    // バーの高さ分のすき間ができ、スクロールした中身がそこから透けて見えてしまう。
    // YouTubeは、プレーヤーや「すべて／関連動画」のバーなどを
    // 「上のバーの高さ分」下にずらして固定している。上のバーを隠した分、全部同じだけ上に詰める。
    let headerShift = 0;   // 隠した上のバーの高さ（プレーヤーの元の位置から求める）
    const fixStickyOffsets = () => {
      if (landOn || miniOn || isReallyHidden()) return;
      const pc = document.getElementById('player-container-id') ||
                 (document.querySelector('.html5-video-player') || {}).parentElement;
      if (!pc) return;

      // ① プレーヤーの入れ物（とその親）を調べて、ずらし量を決め、余白を消す
      let el = pc;
      while (el && el !== document.body && el !== document.documentElement) {
        const cs = getComputedStyle(el);
        if (!headerShift && (cs.position === 'sticky' || cs.position === 'fixed')) {
          const top = parseFloat(cs.top);
          if (top > 0 && top < 120) headerShift = top;
        }
        if (parseFloat(cs.paddingTop) >= 40) el.style.setProperty('padding-top', '0px', 'important');
        if (parseFloat(cs.marginTop) >= 40) el.style.setProperty('margin-top', '0px', 'important');
        el = el.parentElement;
      }
      if (!headerShift) return;

      // ② 上に固定されている部品を全部、ずらし量だけ上へ
      const half = window.innerHeight / 2;
      const all = document.body.getElementsByTagName('*');
      for (let i = 0; i < all.length; i++) {
        const node = all[i];
        if (node.closest('[data-ytl-drag], .ytl-own')) continue;
        const cs = getComputedStyle(node);
        if (cs.position !== 'sticky' && cs.position !== 'fixed') continue;
        if (cs.top === 'auto') continue;
        const top = parseFloat(cs.top);
        if (!Number.isFinite(top)) continue;
        // 自分が前に設定した値のままなら、もう詰めてある
        const mine = node.getAttribute('data-ytl-top');
        if (mine !== null && Math.abs(parseFloat(mine) - top) < 0.5) continue;
        if (top < headerShift - 0.5) continue;              // 上のバーより上のものは関係ない
        if (cs.position === 'fixed' && Math.abs(top - half) < 3) continue;  // 画面中央のダイアログは除く
        const newTop = top - headerShift;
        node.style.setProperty('top', newTop + 'px', 'important');
        node.setAttribute('data-ytl-top', String(newTop));
      }
    };
    setInterval(fixStickyOffsets, 1000);
    window.addEventListener('scroll', () => {
      clearTimeout(fixStickyOffsets._t);
      fixStickyOffsets._t = setTimeout(fixStickyOffsets, 150);
    }, { passive: true });
  }

  // 一覧画面のテーマ（ダーク／ライト）と背景色をアプリに知らせる
  // → アプリ側でタブバーやステータスバーの色を合わせる
  if (ROLE === 'browse') {
    let lastThemeKey = '';
    const parseRgb = (c) => {
      const m = c && c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(',').map((x) => parseFloat(x));
      return { r, g, b, a };
    };
    const reportTheme = () => {
      const html = document.documentElement;
      let col = null;
      for (const el of [document.querySelector('ytm-app'), document.body, html]) {
        if (!el) continue;
        const c = parseRgb(getComputedStyle(el).backgroundColor);
        if (c && c.a > 0.5) { col = c; break; }   // 透明な背景は飛ばす
      }
      let dark;
      if (html.hasAttribute('dark') || html.hasAttribute('darker-dark-theme')) dark = true;
      if (dark === undefined && col) {
        const lum = (0.299 * col.r + 0.587 * col.g + 0.114 * col.b) / 255;
        dark = lum < 0.5;
      }
      if (dark === undefined) return;
      const bg = col ? [col.r, col.g, col.b].map(Math.round).join(',') : '';
      const key = dark + '|' + bg;
      if (key === lastThemeKey) return;
      lastThemeKey = key;
      postNative({ theme: dark ? 'dark' : 'light', bg });
    };
    setInterval(reportTheme, 1000);
  }

  // ミニプレーヤー表示：動画だけを画面いっぱいにする（アプリ側で画面ごと小さくする）
  let miniOn = false;
  const applyMini = () => {
    if (!miniOn) return;
    if (document.documentElement.classList.contains('ytl-mini')) return;
    const t = findLandTarget();
    if (!t) return;  // まだプレーヤーが無い → 後でもう一度
    if (landOn) exitLand();
    landTarget = t;
    t.setAttribute('data-ytl-land', '');
    const root = document.documentElement.style;
    // アプリ側が画面を縮小して上の16:9部分だけを切り抜くので、動画は上端に16:9で置く
    root.setProperty('--ytl-w', '100vw');
    root.setProperty('--ytl-h', '56.25vw');
    root.setProperty('--ytl-transform', 'none');
    document.documentElement.classList.add(LAND_CLASS, 'ytl-mini');
    try { window.dispatchEvent(new Event('resize')); } catch (_) {}
  };
  const setMini = (on) => {
    miniOn = !!on;
    if (miniOn) {
      applyMini();
    } else if (document.documentElement.classList.contains('ytl-mini')) {
      document.documentElement.classList.remove(LAND_CLASS, 'ytl-mini');
      if (landTarget && !landOn) {
        landTarget.removeAttribute('data-ytl-land');
        landTarget = null;
      }
      try { window.dispatchEvent(new Event('resize')); } catch (_) {}
    }
  };
  setInterval(applyMini, 500);  // プレーヤーが後から出てきた場合のため

  Object.assign(window.ytLite = window.ytLite || {}, {
    setMini,
    // ミニプレーヤーに出す情報
    info: () => {
      const v = getMainVideo();
      const api = getPlayerApi();
      let title = '';
      try { title = (api && api.getVideoData && api.getVideoData().title) || ''; } catch (_) {}
      if (!title) title = (document.title || '').replace(/\s*-\s*YouTube\s*$/, '');
      return { title, paused: v ? v.paused : true, hasVideo: !!v, pip: !!(v && isInPiP(v)) };
    },
    togglePlay: () => {
      const v = getMainVideo();
      if (!v) return;
      const api = getPlayerApi();
      if (v.paused) {
        try { if (api && api.playVideo) api.playVideo(); } catch (_) {}
        v.play().catch(() => {});
      } else {
        try { if (api && api.pauseVideo) api.pauseVideo(); } catch (_) {}
        v.pause();
      }
    },
    // 次の動画でPiPが閉じたとき、アプリから呼ばれる：閉じていれば開き直す
    enterPiP: () => {
      const v = getMainVideo();
      if (!v || isInPiP(v)) return false;
      tryEnterPiP();
      return true;
    },
    // 再生バーの表示設定（アプリの⚙️から呼ばれる）
    setRunnerMode: (m) => (window.__ytlSetRbMode ? window.__ytlSetRbMode(m) : null),
    getRunnerMode: () => (window.__ytlGetRbMode ? window.__ytlGetRbMode() : 'all'),
    // ミニプレーヤーのPiPボタンから呼ばれる（開いていれば閉じる）
    pip: () => { togglePiP(); },
    pause: () => {
      const api = getPlayerApi();
      try { if (api && api.pauseVideo) api.pauseVideo(); } catch (_) {}
      document.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch (_) {} });
    },
  });

  // ============================================================
  // 12. 動画を開いたときにミュートになっていたら解除する
  //     （広告スキップ中のミュートをYouTubeが覚えてしまう、
  //      音ありの自動再生に失敗してミュートで始まる、などの対策）
  // ============================================================
  function tryUnmute(v) {
    // Safariでは、一度でも画面に触れた後でないと音ありで再生できないので、そのときだけ
    const canUnmute = IN_APP || (navigator.userActivation && navigator.userActivation.hasBeenActive);
    if (!canUnmute || !v) return;
    const api = getPlayerApi();
    let apiMuted = false;
    try { apiMuted = !!(api && api.isMuted && api.isMuted()); } catch (_) {}
    if (!v.muted && !apiMuted) return;
    try { if (api && api.unMute) api.unMute(); } catch (_) {}
    v.muted = false;
    dbg('ミュートを解除');
    // 音ありにした途端にiOSに止められたら、ミュートに戻して再生を続ける
    setTimeout(() => {
      if (v.paused && !v.ended) {
        v.muted = true;
        v.play().catch(() => {});
        dbg('ミュート解除で止まったので戻した');
      }
    }, 600);
  }

  let unmuteCheckedFor = null;
  document.addEventListener('playing', (e) => {
    if (ROLE === 'browse') return;   // 一覧画面のプレビューは対象外（音が出てミニプレーヤーが止まるため）
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || v !== getMainVideo()) return;
    const player = document.querySelector('.html5-video-player');
    if (player && (player.classList.contains('ad-showing') ||
                   player.classList.contains('ad-interrupting'))) return;
    const id = getCurrentId();
    if (!id || unmuteCheckedFor === id) return;   // 動画ごとに1回だけ（途中で自分でミュートした場合は触らない）
    unmuteCheckedFor = id;
    tryUnmute(v);
  }, true);

  // ============================================================
  // 13. 全画面の向きを切り替える
  //     ⟳ボタンで 左に倒す横向き → 右に倒す横向き → 縦向き の順に切り替え。
  //     選んだ向きは次の全画面でも使う。縦長の動画は最初から縦向き。
  // ============================================================
  const DIR_KEY = 'ytl-land-dir';
  const DIR_LABEL = { '1': '横向き（左に倒す）', '-1': '横向き（右に倒す）', '0': '縦向き' };

  function isVerticalVideo() {
    const v = getMainVideo();
    return !!(v && v.videoWidth && v.videoHeight && v.videoHeight > v.videoWidth);
  }

  function preferredLandDir() {
    if (isVerticalVideo()) return 0;
    try {
      const saved = parseInt(localStorage.getItem(DIR_KEY), 10);
      if (saved === 1 || saved === -1 || saved === 0) return saved;
    } catch (_) {}
    return 1;
  }

  // 画面の真ん中に、今の向きを一瞬だけ表示
  function showLandToast(text) {
    if (!landTarget) return;
    if (landToast) landToast.remove();   // 前の表示が残っていたら消す
    const t = document.createElement('div');
    landToast = t;
    t.className = 'ytl-own';
    t.textContent = text;
    t.style.cssText =
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483645;' +
      'background:rgba(0,0,0,0.7);color:#fff;font:bold 15px sans-serif;' +
      'padding:10px 16px;border-radius:10px;pointer-events:none;transition:opacity 0.3s;';
    landTarget.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; }, 900);
    setTimeout(() => t.remove(), 1300);
  }

  function makeRotateButton() {
    const b = document.createElement('button');
    b.className = 'ytl-own ytl-land-ui';
    b.type = 'button';
    b.setAttribute('aria-label', '向きを変える');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    for (const d of ['M20 12a8 8 0 1 1-2.34-5.66', 'M20 4v5h-5']) {
      const p = document.createElementNS(svgNS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', '#fff');
      p.setAttribute('stroke-width', '2.2');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(p);
    }
    b.appendChild(svg);
    b.style.cssText =
      'position:absolute;top:12px;right:72px;z-index:2147483645;' +
      'width:34px;height:34px;border-radius:17px;border:none;padding:0;' +
      'background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;' +
      '-webkit-tap-highlight-color:transparent;';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 左に倒す(1) → 右に倒す(-1) → 縦(0) → 左に倒す(1) …
      landDir = landDir === 1 ? -1 : (landDir === -1 ? 0 : 1);
      try { localStorage.setItem(DIR_KEY, String(landDir)); } catch (_) {}
      layoutLand();
      showLandToast(DIR_LABEL[String(landDir)]);
      dbg('全画面の向き: ' + DIR_LABEL[String(landDir)]);
    }, true);
    return b;
  }

  // ============================================================
  // 14. 虹色の再生バー ＋ 先端を走るドット絵の流れ星（オリジナルキャラ）
  //     いらなければ RAINBOW_BAR を false に
  // ============================================================
  const RAINBOW_BAR = true;
  if (RAINBOW_BAR && ROLE !== 'browse') {
    // ドット絵の流れ星（11×9マス）。. = 透明 / Y = 黄 / O = 縁 / K = 目 / P = ほっぺ / M = 口
    const STAR = [
      '.....O.....',
      '....OYO....',
      'OOOOOYOOOOO',
      'OYYYKYKYYYO',
      '.OYPYMYPYO.',
      '..OYYYYYO..',
      '.OYYOOOYYO.',
      '.OYO...OYO.',
      '.OO.....OO.',
    ];
    const PAL = { Y: '#ffd83d', O: '#7a4a00', K: '#2b1a00', P: '#ff8fb1', M: '#c2410c' };
    let rects = '';
    STAR.forEach((row, y) => {
      [...row].forEach((c, x) => {
        if (PAL[c]) rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + PAL[c] + '"/>';
      });
    });
    const starSvg = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11 9" shape-rendering="crispEdges">' + rects + '</svg>');
    // 自作のドット絵キャラ（30×19、背景は透過済み）。空にすると流れ星に戻る
    const CUSTOM_RUNNER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB4AAAATCAYAAACHrr18AAABJElEQVR42u1VMWrDQBCctZX32BhD2lT3gDxAZR4QSONG2kaNwQ9w6QfkAarSBkyI3mPCplHE6rQn7yWQJhkQaO/Ezu3Mag/4xy+BnN9JZk5J5B/WPcQiz69+1vtbVFUFAGBmTS56ffFjzboS7flgbvVEokm/UHjz3x2XeHn4mG6sTmiOS4TteK+uaxDRUH0cLxJ+TjzdbfZAV5qHsg5EkYtxXKQkYmbRzRG2jz4FxjInY6tiYmbtj+nrbrOftaZvrNG7Xkt5TMwsfeWmr8HRFxa5p7mol3tAez6geXuaStyVwOo0K22MImMYINy8Ixi+tpc1GuW5qVLce56JlTtAPFNxruLhp1fJrkJNJ5kjz5pcyjdSz1U/v4N4mIjjEpHMS+WP4BNzVHM7x0FKhwAAAABJRU5ErkJggg==';
    const runnerImg = CUSTOM_RUNNER || starSvg;
    // 30×19のドット絵を、iPhoneの画面でちょうど4倍になる大きさで表示（くっきり見える）
    const RUNNER_W = CUSTOM_RUNNER ? 40 : 24;
    const RUNNER_H = CUSTOM_RUNNER ? 25.333 : 20;
    // 虹のバーの位置：左右の余白と、下端からの高さ（シークの計算にも使う）
    const RBAR_INSET = 20;
    const RBAR_BOTTOM = 12;
    window.__ytlRbarGeom = () => (rbMode === 'off' ? { inset: 0, bottom: 0 } : { inset: RBAR_INSET, bottom: RBAR_BOTTOM });
    const RAINBOW = 'linear-gradient(to bottom,' +
      '#ff2d55 0 16.6%,#ff9500 16.6% 33.3%,#ffd60a 33.3% 50%,' +
      '#34c759 50% 66.6%,#0a84ff 66.6% 83.3%,#8e5bff 83.3% 100%)';

    const rbCss = `
      .ytl-rbar { position:absolute; left:${RBAR_INSET}px; right:${RBAR_INSET}px; bottom:${RBAR_BOTTOM}px;
                  height:6px; z-index:60; border-radius:3px;
                  pointer-events:none; background:rgba(255,255,255,0.22); }
      .ytl-rbar-fill { position:absolute; left:0; top:0; bottom:0; width:0; border-radius:3px;
                       background:${RAINBOW}; overflow:hidden; }
      /* 虹のバーを出している間は、YouTubeの元のバー（画面いっぱいの長さ）は見えなくする */
      html:not(.ytl-rb-off) .html5-video-player [class*="progress-bar"]:not(.ytl-own),
      html:not(.ytl-rb-off) .html5-video-player [class*="ProgressBar"]:not(.ytl-own),
      html:not(.ytl-rb-off) .html5-video-player ytm-progress-bar,
      html:not(.ytl-rb-off) #player-container-id [class*="progress-bar"]:not(.ytl-own),
      html:not(.ytl-rb-off) #player-container-id [class*="ProgressBar"]:not(.ytl-own),
      html:not(.ytl-rb-off) #player-container-id [class*="progressBar"]:not(.ytl-own),
      html:not(.ytl-rb-off) #player-container-id ytm-progress-bar {
        opacity:0 !important;
      }
      .ytl-rbar-fill::after { content:''; position:absolute; inset:0;
                       background:linear-gradient(90deg,transparent 0,rgba(255,255,255,0.55) 50%,transparent 100%);
                       background-size:60px 100%; animation:ytl-shine 1.2s linear infinite; }
      .ytl-rbar-star { position:absolute; bottom:${3 - RUNNER_H / 2}px; width:${RUNNER_W}px; height:${RUNNER_H}px;
                       margin-left:-${RUNNER_W / 2}px;
                       background:url("${runnerImg}") center/contain no-repeat;
                       image-rendering:-webkit-optimize-contrast; image-rendering:pixelated;
                       animation:ytl-bob 0.45s steps(2) infinite; }
      @keyframes ytl-shine { from { background-position:-60px 0; } to { background-position:60px 0; } }
      @keyframes ytl-bob { 0% { transform:translateY(0); } 100% { transform:translateY(-3px); } }
      html.ytl-mini .ytl-rbar { display:none !important; }
      /* YouTubeの赤い再生バーも、見つかったものは虹色に（「標準」設定のときは元のまま） */
      html:not(.ytl-rb-off) .ytp-play-progress, html:not(.ytl-rb-off) .progress-bar-played,
      html:not(.ytl-rb-off) .ytProgressBarLineProgressBarPlayed,
      html:not(.ytl-rb-off) [class*="ProgressBarPlayed"] {
        background:${RAINBOW} !important;
      }
    `;
    const addRbStyle = () => {
      const st = document.createElement('style');
      st.textContent = rbCss;
      (document.head || document.documentElement).appendChild(st);
    };
    if (document.documentElement) addRbStyle();
    else document.addEventListener('DOMContentLoaded', addRbStyle);

    // 再生バーの表示設定：'all' = 虹＋キャラ / 'rainbow' = 虹だけ / 'off' = 標準（YouTubeのまま）
    const RB_KEY = 'ytl-rbar-mode';
    const RB_LABEL = { all: '虹＋キャラ', rainbow: '虹だけ', off: '標準' };
    const loadRbMode = () => {
      try {
        const m = localStorage.getItem(RB_KEY);
        if (m === 'all' || m === 'rainbow' || m === 'off') return m;
      } catch (_) {}
      return 'all';
    };
    let rbMode = loadRbMode();
    const applyRbMode = () => {
      // 読み込み直後はページの骨組みがまだ無いことがあるので、その場合は後で反映
      if (!document.documentElement) return;
      document.documentElement.classList.toggle('ytl-rb-off', rbMode === 'off');
    };
    if (document.documentElement) applyRbMode();
    else document.addEventListener('DOMContentLoaded', applyRbMode);
    window.__ytlSetRbMode = (m) => {
      if (!RB_LABEL[m]) return rbMode;
      rbMode = m;
      try { localStorage.setItem(RB_KEY, m); } catch (_) {}
      applyRbMode();
      return rbMode;
    };
    window.__ytlGetRbMode = () => rbMode;

    let rbar = null;
    let rfill = null;
    let rstar = null;
    setInterval(() => {
      const player = document.querySelector('.html5-video-player');
      const v = getMainVideo();
      const show = player && v && isWatchPage() && Number.isFinite(v.duration) && v.duration > 0 &&
                   !player.classList.contains('ad-showing') && !player.classList.contains('ad-interrupting');
      if (!show || rbMode === 'off') {
        if (rbar) rbar.style.display = 'none';
        return;
      }
      if (!rbar) {
        rbar = document.createElement('div');
        rbar.className = 'ytl-rbar ytl-own';
        rfill = document.createElement('div');
        rfill.className = 'ytl-rbar-fill';
        rstar = document.createElement('div');
        rstar.className = 'ytl-rbar-star';
        rbar.appendChild(rfill);
        rbar.appendChild(rstar);
      }
      if (rbar.parentNode !== player) player.appendChild(rbar);
      rbar.style.display = 'block';
      // YouTubeの元のバーが見つかれば、その位置と長さにぴったり重ねる（ずれ防止）
      const tg = getTrackGeom(player);
      if (tg) {
        rbar.style.left = tg.left + 'px';
        rbar.style.width = tg.width + 'px';
        rbar.style.right = 'auto';
        rbar.style.top = (tg.cy - 3) + 'px';
        rbar.style.bottom = 'auto';
      } else {
        rbar.style.left = rbar.style.width = rbar.style.right = rbar.style.top = rbar.style.bottom = '';
      }
      // シーク中（長押しで動かしている間）は、行き先の位置を表示する
      const frac = (typeof window.__ytlSeekPreview === 'number')
        ? window.__ytlSeekPreview : v.currentTime / v.duration;
      const pct = Math.min(100, Math.max(0, frac * 100));
      rfill.style.width = pct + '%';
      rstar.style.left = pct + '%';
      rstar.style.display = rbMode === 'all' ? 'block' : 'none';
      // 一時停止中は流れ星も止める
      rstar.style.animationPlayState = v.paused ? 'paused' : 'running';
    }, 250);
  }

  // ============================================================
  // 14.9 関連動画：タイトルを確実に取る / 縦画面の一覧に投稿日時を出す
  // ============================================================
  const ITEM_SEL = 'ytm-video-with-context-renderer, ytm-compact-video-renderer, ytm-media-item, ' +
    'yt-lockup-view-model, ytm-video-card-renderer, ytm-rich-item-renderer, ' +
    '[class*="lockup-view-model"], [class*="media-item"], [class*="compact-media"]';
  const idOfLink = (a) => {
    try { return new URL(a.href, location.href).searchParams.get('v'); } catch (_) { return null; }
  };
  // その動画1本分のまとまり（サムネイル＋タイトル＋情報）
  const itemOf = (a, id) => {
    let el = a.closest(ITEM_SEL);
    // 見つからないときは、同じ動画へのリンクだけを含む範囲で一番大きいところまで広げる
    if (!el) {
      el = a;
      for (let i = 0; i < 6 && el.parentElement && el.parentElement !== document.body; i++) {
        const up = el.parentElement;
        const ids = new Set();
        up.querySelectorAll('a[href*="watch?v="]').forEach((x) => ids.add(idOfLink(x)));
        if (ids.size > 1) break;
        el = up;
      }
    }
    return el;
  };
  const cleanTitle = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const looksLikeTime = (t) => /^(\d+:)?\d+:\d\d$/.test(t) || /^\d+\s*(分|秒)/.test(t);
  const titleForId = (id, a) => {
    const m = videoMeta[id];
    if (m && m.title) return cleanTitle(m.title);
    const links = [...document.querySelectorAll('a[href*="watch?v=' + id + '"]')].filter((x) => !x.closest('.ytl-own'));
    if (a && links.indexOf(a) < 0) links.unshift(a);
    for (const x of links) {
      const item = itemOf(x, id);
      const h = item && item.querySelector('h3, h4, .media-item-headline, [class*="headline"], [class*="title"]:not([class*="subtitle"])');
      const t = h && cleanTitle(h.getAttribute('aria-label') || h.textContent);
      if (t && !looksLikeTime(t)) return t;
    }
    for (const x of links) {
      const t = cleanTitle(x.getAttribute('title') || x.getAttribute('aria-label'));
      if (t && !looksLikeTime(t)) return t;
    }
    let best = '';
    for (const x of links) {
      const t = cleanTitle(x.textContent);
      if (t.length > best.length && !looksLikeTime(t)) best = t;
    }
    return best;
  };

  // モバイル版のデータに投稿日時などが無いときは、PC版と同じ形のデータを1回だけもらってくる
  const metaFetches = {};
  let metaFetchNote = '';
  const fetchDesktopMeta = (vid) => {
    if (!vid) return Promise.resolve();
    if (metaFetches[vid]) return metaFetches[vid];
    metaFetches[vid] = (async () => {
      const cfg = window.ytcfg;
      const get = (k) => { try { return cfg.get(k); } catch (_) { return cfg && cfg.data_ && cfg.data_[k]; } };
      const base = (cfg && get('INNERTUBE_CONTEXT')) || {};
      const c = base.client || {};
      const key = cfg && get('INNERTUBE_API_KEY');
      const ver = /^2\.\d{8}/.test(c.clientVersion || '') ? c.clientVersion : '2.20261001.00.00';
      const tries = [
        { name: 'WEB', num: '1', ver },
        { name: 'WEB', num: '1', ver: '2.20250101.00.00' },
      ];
      for (const t of tries) {
        try {
          const client = { clientName: t.name, clientVersion: t.ver, hl: c.hl || 'ja', gl: c.gl || 'JP' };
          if (c.visitorData) client.visitorData = c.visitorData;
          const res = await fetch('/youtubei/v1/next?prettyPrint=false' + (key ? '&key=' + key : ''), {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-Youtube-Client-Name': t.num, 'X-Youtube-Client-Version': t.ver },
            body: JSON.stringify({ context: { client }, videoId: vid }),
          });
          if (!res.ok) { metaFetchNote = 'HTTP ' + res.status; continue; }
          const before = Object.values(videoMeta).filter((m) => m.published).length;
          noteMeta(await ownJson(res));
          const after = Object.values(videoMeta).filter((m) => m.published).length;
          metaFetchNote = '取得 ' + (after - before) + '件';
          if (after > before) return;
        } catch (e) { metaFetchNote = 'エラー ' + (e && e.message ? e.message : e); }
      }
    })();
    return metaFetches[vid];
  };
  // ---- 1本ずつ投稿日時を問い合わせる（一覧のデータに日時が無い動画用） ----
  const relTime = (date) => {
    const sec = Math.max(1, (Date.now() - date.getTime()) / 1000);
    const units = [[31536000, '年', 'year'], [2592000, 'か月', 'month'], [604800, '週間', 'week'],
                   [86400, '日', 'day'], [3600, '時間', 'hour'], [60, '分', 'minute'], [1, '秒', 'second']];
    let hl = 'ja';
    try { hl = (window.ytcfg.get('INNERTUBE_CONTEXT').client.hl || 'ja'); } catch (_) {}
    for (const [u, ja, en] of units) {
      if (sec >= u) {
        const n = Math.floor(sec / u);
        return /^ja/.test(hl) ? n + ja + '前' : n + ' ' + en + (n > 1 ? 's' : '') + ' ago';
      }
    }
    return '';
  };
  // いろいろな書き方の日付を読み取る（「2026/10/14」「2026年10月14日」「Oct 14, 2026」「2026-10-14T…」）
  const parseDateText = (t) => {
    if (!t) return null;
    let m = /(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/.exec(t);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = /([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})/.exec(t);
    if (m) { const d = new Date(m[1]); if (!isNaN(d)) return d; }
    return null;
  };
  const dateFromAny = (t) => {
    if (!t) return '';
    if (DATE_RE.test(t)) return t.trim();
    const d = parseDateText(t);
    return d ? relTime(d) : '';
  };
  const innertube = async (endpoint, body, web) => {
    const cfg = window.ytcfg;
    const get = (k) => { try { return cfg.get(k); } catch (_) { return cfg && cfg.data_ && cfg.data_[k]; } };
    const base = (cfg && get('INNERTUBE_CONTEXT')) || { client: { clientName: 'MWEB', clientVersion: '2.20261001.01.00', hl: 'ja', gl: 'JP' } };
    const c = base.client || {};
    let context = base;
    if (web) {
      const ver = /^2\.\d{8}/.test(c.clientVersion || '') ? c.clientVersion : '2.20261001.00.00';
      context = { client: { clientName: 'WEB', clientVersion: ver, hl: c.hl || 'ja', gl: c.gl || 'JP' } };
      if (c.visitorData) context.client.visitorData = c.visitorData;
    }
    const key = cfg && get('INNERTUBE_API_KEY');
    const res = await fetch('/youtubei/v1/' + endpoint + '?prettyPrint=false' + (key ? '&key=' + key : ''), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ context }, body)),
    });
    if (!res.ok) throw new Error(endpoint + ' HTTP ' + res.status);
    return ownJson(res);
  };
  const findKey = (o, key, depth) => {
    if (!o || typeof o !== 'object' || (depth || 0) > 25) return undefined;
    if (key in o) return o[key];
    for (const k in o) {
      const r = findKey(o[k], key, (depth || 0) + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  };
  const dateLookups = {};
  const dateQueue = [];
  let dateRunning = 0;
  let dateMethod = 0;   // うまくいった方法を覚えておく
  let dateNote = '';
  const lookupOne = async (id) => {
    const methods = [
      // 軽い：日時と視聴回数だけ返してくれる窓口
      async () => {
        const r = await innertube('updated_metadata', { videoId: id }, false);
        const dt = findKey(r, 'updateDateTextAction');
        return dateFromAny(dt && metaText(dt.dateText));
      },
      // 重いけど確実：動画の詳しい情報（公開日）
      async () => {
        const r = await innertube('player', { videoId: id }, true);
        const mf = findKey(r, 'playerMicroformatRenderer');
        return dateFromAny(mf && (mf.publishDate || mf.uploadDate));
      },
    ];
    for (let i = 0; i < methods.length; i++) {
      const k = (dateMethod + i) % methods.length;
      try {
        const d = await methods[k]();
        if (d) { dateMethod = k; dateNote = '方法' + (k + 1) + 'OK'; return d; }
        dateNote = '方法' + (k + 1) + '空';
      } catch (e) { dateNote = '方法' + (k + 1) + ':' + (e && e.message ? e.message : e); }
    }
    return '';
  };
  const pumpDates = () => {
    while (dateRunning < 3 && dateQueue.length) {
      const id = dateQueue.shift();
      dateRunning++;
      lookupOne(id).then((d) => {
        if (d) putMeta(id, { published: d });
      }).finally(() => { dateRunning--; pumpDates(); });
    }
  };
  const requestDate = (id) => {
    if (dateLookups[id]) return;
    dateLookups[id] = true;
    dateQueue.push(id);
    pumpDates();
  };

  // 見えている文字だけ（読み上げ用の隠れた文字は除く）
  const visibleText = (el) => { try { return el.innerText || ''; } catch (_) { return el.textContent || ''; } };

  // チャンネル名と「視聴回数 · 投稿日時」
  const subInfoFor = (id) => {
    const m = videoMeta[id] || {};
    let channel = m.channel || '';
    let views = m.views || '';
    let published = m.published || '';
    if (!channel || !views || !published) {
      // データに無い分は、画面に出ている文字から拾う
      const a = [...document.querySelectorAll('a[href*="watch?v=' + id + '"]')].find((x) => !x.closest('.ytl-own'));
      const item = a && itemOf(a, id);
      if (item) {
        const title = titleForId(id, a);
        const lines = visibleText(item).split(/\n|・|•|·/).map((t) => t.trim())
          .filter((t) => t && t !== title && !looksLikeTime(t) && t.indexOf(title) < 0);
        for (const t of lines) {
          if (DATE_RE.test(t)) { if (!published) published = t; }
          else if (VIEWS_RE.test(t)) { if (!views) views = t; }
          else if (!channel && t.length < 40) channel = t;
        }
      }
    }
    return { channel, line: [views, published].filter(Boolean).join(' · ') };
  };

  if (ROLE !== 'browse') {
    const addDates = () => {
      if (landOn || miniOn || !/^\/watch\b/.test(location.pathname)) return;
      const current = getCurrentId();
      const playerArea = document.getElementById('player-container-id');
      let missing = 0;
      let items = 0;
      let firstItem = null;
      document.querySelectorAll('a[href*="/watch?v="]').forEach((a) => {
        if (a.closest('.ytl-own') || (playerArea && playerArea.contains(a))) return;
        const id = idOfLink(a);
        if (!id || id === current) return;
        const item = itemOf(a, id);
        if (!item || item.dataset.ytlSeen === id + '1') return;
        items++;
        const ir = item.getBoundingClientRect();
        if (!ir.width || !ir.height) return;                       // 隠れている部品は除く
        if (!firstItem) firstItem = item;
        if (item.querySelector('.ytl-date')) return;
        if (DATE_RE.test(visibleText(item))) { item.dataset.ytlSeen = id + '1'; return; }   // もともと出ている
        const m = videoMeta[id];
        if (!m || !m.published) {
          missing++;
          // 画面の近くにあるものから1本ずつ問い合わせる
          if (ir.top < window.innerHeight * 2.5) requestDate(id);
          return;
        }
        const span = document.createElement('span');
        span.className = 'ytl-date';
        span.textContent = ' · ' + m.published;
        // 「〇回視聴」の後ろに付ける。無ければタイトルの下に1行足す
        let views = null;
        item.querySelectorAll('span, div, p').forEach((el) => {
          if (el.closest('a') && el.closest('a').querySelector('img')) return;   // サムネイルの上の文字は除く
          const tx = visibleText(el);
          if (VIEWS_RE.test(tx) && (!views || tx.length < visibleText(views).length)) views = el;
        });
        if (views) {
          views.appendChild(span);
        } else {
          span.textContent = m.published;
          span.style.cssText = 'display:block;font-size:12px;opacity:0.7;margin-top:2px;';
          const h = item.querySelector('h3, h4, .media-item-headline, [class*="headline"]');
          if (h && h.parentNode) h.parentNode.insertBefore(span, h.nextSibling);
          else item.appendChild(span);
        }
      });
      if (missing && current) fetchDesktopMeta(current);
    };
    setInterval(addDates, 1000);
  }

  // ============================================================
  // 15. 全画面で上にスワイプ → 関連動画の一覧（YouTubeアプリと同じ）
  //     横にスワイプで送る / タップで切り替え / 下スワイプか動画をタップで閉じる
  // ============================================================
  if (ROLE !== 'browse') {
    const relCss = `
      .ytl-rel { position:absolute; left:0; right:0; bottom:0; height:56%; z-index:2147483644;
                 display:none; flex-direction:column; justify-content:flex-end; padding:0 0 14px;
                 background:linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.9) 32%); }
      .ytl-rel.open { display:flex; animation:ytl-rel-in 0.22s ease-out; }
      @keyframes ytl-rel-in { from { transform:translateY(25%); opacity:0; } to { transform:none; opacity:1; } }
      .ytl-rel-head { color:#fff; font:bold 14px sans-serif; padding:0 16px 8px; opacity:0.9; }
      .ytl-rel-strip { display:flex; gap:12px; overflow:hidden; padding:0 16px; }
      .ytl-rel-card { flex:0 0 auto; width:200px; }
      .ytl-rel-thumb { width:200px; height:112px; border-radius:8px; background:#333 center/cover no-repeat; }
      .ytl-rel-title { color:#fff; font:12px/1.35 sans-serif; margin-top:6px; display:-webkit-box;
                       -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .ytl-rel-sub { color:#aaa; font:11px/1.35 sans-serif; margin-top:3px; white-space:nowrap;
                     overflow:hidden; text-overflow:ellipsis; }
      .ytl-rel-msg { color:#ccc; font:13px sans-serif; padding:20px 16px; }
    `;
    const addRelStyle = () => {
      const st = document.createElement('style');
      st.textContent = relCss;
      (document.head || document.documentElement).appendChild(st);
    };
    if (document.documentElement) addRelStyle();
    else document.addEventListener('DOMContentLoaded', addRelStyle);

    // 画面上の指の動きを、全画面の動画から見た向き（左右・上下）に直す
    const toLocal = (dx, dy) => {
      if (!landOn) return { x: dx, y: dy };
      const vv = window.visualViewport;
      const portrait = (vv ? vv.height : window.innerHeight) > (vv ? vv.width : window.innerWidth);
      if (portrait && landDir === 1) return { x: dy, y: -dx };   // 左に倒して見ている
      if (portrait && landDir === -1) return { x: -dy, y: dx };  // 右に倒して見ている
      return { x: dx, y: dy };                                     // 縦向き全画面・もともと横持ち
    };

    const textOf = (t) => !t ? '' :
      (t.simpleText || (t.runs || []).map((r) => r.text).join('') || t.content || '');

    // YouTubeのデータから関連動画（ID とタイトル）を取り出す
    const extractRelated = (data) => {
      const out = [];
      const seen = new Set();
      let count = 0;
      const walk = (o, depth) => {
        if (!o || typeof o !== 'object' || depth > 60 || ++count > 200000) return;
        if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
        const r = o.videoWithContextRenderer || o.compactVideoRenderer || o.videoRenderer;
        if (r && ID_RE.test(r.videoId || '') && !seen.has(r.videoId)) {
          seen.add(r.videoId);
          out.push({ id: r.videoId, title: textOf(r.headline) || textOf(r.title) });
        }
        const l = o.lockupViewModel;
        if (l && ID_RE.test(l.contentId || '') && !seen.has(l.contentId)) {
          seen.add(l.contentId);
          let title = '';
          try { title = textOf(l.metadata.lockupMetadataViewModel.title); } catch (_) {}
          out.push({ id: l.contentId, title });
        }
        for (const k in o) walk(o[k], depth + 1);
      };
      walk(data, 0);
      return out;
    };

    // 画面（ページ）に出ている関連動画から集める
    const collectRelatedFromDom = (currentId) => {
      const out = [];
      const seen = new Set([currentId]);
      document.querySelectorAll('a[href*="/watch?v="]').forEach((a) => {
        if (a.closest('.ytl-own')) return;
        let id = null;
        try { id = new URL(a.href, location.href).searchParams.get('v'); } catch (_) {}
        if (!id || !ID_RE.test(id) || seen.has(id)) return;
        seen.add(id);
        out.push({ id, title: titleForId(id, a).slice(0, 90) });
      });
      return out;
    };

    const collectRelated = async () => {
      const current = getCurrentId();
      let list = collectRelatedFromDom(current);
      if (list.length < 4) {
        try {
          const cfg = window.ytcfg;
          const get = (k) => { try { return cfg.get(k); } catch (_) { return cfg && cfg.data_ && cfg.data_[k]; } };
          const context = cfg && get('INNERTUBE_CONTEXT');
          if (context && current) {
            const key = get('INNERTUBE_API_KEY');
            const res = await fetch('/youtubei/v1/next?prettyPrint=false' + (key ? '&key=' + key : ''), {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ context, videoId: current }),
            });
            const fromApi = extractRelated(await ownJson(res)).filter((r) => r.id !== current)
              .map((r) => ({ id: r.id, title: r.title || titleForId(r.id, null) }));
            const have = new Set(list.map((r) => r.id));
            list = list.concat(fromApi.filter((r) => !have.has(r.id)));
          }
        } catch (_) {}
      }
      return list.slice(0, 24);
    };

    let rel = null;
    let relStrip = null;
    let relOpen = false;

    const ensureRelPanel = () => {
      if (!rel) {
        rel = document.createElement('div');
        rel.className = 'ytl-rel ytl-own';
        const head = document.createElement('div');
        head.className = 'ytl-rel-head';
        head.textContent = '関連動画';
        relStrip = document.createElement('div');
        relStrip.className = 'ytl-rel-strip';
        rel.appendChild(head);
        rel.appendChild(relStrip);
      }
      if (landTarget && rel.parentNode !== landTarget) landTarget.appendChild(rel);
    };

    const closeRel = () => {
      relOpen = false;
      if (rel) rel.classList.remove('open');
    };

    const openRel = async () => {
      if (!landOn) return;
      ensureRelPanel();
      relOpen = true;
      relStrip.textContent = '';
      const msg = document.createElement('div');
      msg.className = 'ytl-rel-msg';
      msg.textContent = '読み込み中…';
      relStrip.appendChild(msg);
      relStrip.scrollLeft = 0;
      rel.classList.add('open');
      let list = await collectRelated();
      if (!relOpen) return;
      // チャンネル名・視聴回数・投稿日時が足りなければ、取りに行く（最大2.5秒待つ）
      if (list.some((it) => { const m = videoMeta[it.id]; return !m || !m.published || !m.channel; })) {
        list.forEach((it) => { const m = videoMeta[it.id]; if (!m || !m.published) requestDate(it.id); });
        await Promise.race([fetchDesktopMeta(getCurrentId()), new Promise((r) => setTimeout(r, 1500))]);
        if (!relOpen) return;
      }
      relStrip.textContent = '';
      if (!list.length) {
        msg.textContent = '関連動画が見つかりませんでした';
        relStrip.appendChild(msg);
        return;
      }
      for (const item of list) {
        const card = document.createElement('div');
        card.className = 'ytl-rel-card';
        card.dataset.id = item.id;
        const thumb = document.createElement('div');
        thumb.className = 'ytl-rel-thumb';
        thumb.style.backgroundImage = 'url("https://i.ytimg.com/vi/' + item.id + '/mqdefault.jpg")';
        const title = document.createElement('div');
        title.className = 'ytl-rel-title';
        title.textContent = item.title || titleForId(item.id, null) || '';
        card.appendChild(thumb);
        card.appendChild(title);
        const ch = document.createElement('div');
        ch.className = 'ytl-rel-sub ytl-rel-ch';
        const ln = document.createElement('div');
        ln.className = 'ytl-rel-sub ytl-rel-ln';
        ln.style.marginTop = '1px';
        card.appendChild(ch);
        card.appendChild(ln);
        relStrip.appendChild(card);
      }
      // チャンネル名・視聴回数・日時を表示（あとから届いた日時も反映）
      const fill = () => {
        relStrip.querySelectorAll('.ytl-rel-card').forEach((card) => {
          const sub = subInfoFor(card.dataset.id);
          card.querySelector('.ytl-rel-ch').textContent = sub.channel;
          card.querySelector('.ytl-rel-ln').textContent = sub.line;
        });
      };
      fill();
      let n = 0;
      const timer = setInterval(() => {
        if (!relOpen || ++n > 16) { clearInterval(timer); return; }
        fill();
      }, 500);
    };

    // 全画面のまま動画を切り替える（情報は全画面を抜けたときに更新）
    const playRelated = (id) => {
      closeRel();
      const api = getPlayerApi();
      if (api && api.loadVideoById) {
        api.loadVideoById(id);
        staleInfo = true;
        try { history.replaceState(history.state, '', '/watch?v=' + id); } catch (_) {}
        ensurePlaying(id);
      } else {
        location.assign('/watch?v=' + id);
      }
    };

    // 指の動きを見張る（全画面のときだけ）
    let g = null;
    document.addEventListener('touchstart', (e) => {
      if (!landOn || e.touches.length !== 1) { g = null; return; }
      const t = e.touches[0];
      const target = e.target;
      g = {
        x: t.clientX,
        y: t.clientY,
        inStrip: relOpen && relStrip && relStrip.contains(target),
        card: target && target.closest ? target.closest('.ytl-rel-card') : null,
        scroll0: relStrip ? relStrip.scrollLeft : 0,
        onButton: !!(target && target.closest && target.closest('button')),
      };
    }, { capture: true, passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!g || !landOn || !g.inStrip) return;
      const t = e.touches[0];
      const l = toLocal(t.clientX - g.x, t.clientY - g.y);
      if (Math.abs(l.x) > Math.abs(l.y)) {
        relStrip.scrollLeft = g.scroll0 - l.x;   // 一覧を横に送る
        e.preventDefault();
      }
    }, { capture: true, passive: false });

    document.addEventListener('touchend', (e) => {
      const gg = g;
      g = null;
      if (!gg || !landOn || gg.onButton) return;
      const t = e.changedTouches[0];
      const l = toLocal(t.clientX - gg.x, t.clientY - gg.y);
      const moved = Math.hypot(l.x, l.y);
      const vertical = Math.abs(l.y) > Math.abs(l.x) * 1.2;
      if (gg.inStrip) {
        if (moved < 10 && gg.card) {
          e.preventDefault();
          playRelated(gg.card.dataset.id);
        } else if (vertical && l.y > 60) {
          closeRel();
        }
        return;
      }
      if (!relOpen && vertical && l.y < -60) {   // 上にスワイプ → 開く
        e.preventDefault();
        openRel();
        return;
      }
      if (relOpen && ((vertical && l.y > 60) || moved < 10)) {   // 下にスワイプ・タップ → 閉じる
        e.preventDefault();
        closeRel();
      }
    }, { capture: true, passive: false });

    // 全画面を抜けたら閉じる。全画面中に切り替えた動画は、ここで情報を更新
    let wasLand = false;
    setInterval(() => {
      if (wasLand && !landOn) {
        closeRel();
        if (rel && rel.parentNode) rel.remove();
        if (staleInfo) setTimeout(refreshStaleInfo, 400);
      }
      wasLand = landOn;
    }, 300);
  }

  // ============================================================
  // 16. 横全画面のPiPボタン ＋ ボタン類を3秒で隠す
  // ============================================================
  function makeLandPiPButton() {
    const b = document.createElement('button');
    b.className = 'ytl-own ytl-land-ui';
    b.type = 'button';
    b.setAttribute('aria-label', 'PiP');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    const outer = document.createElementNS(svgNS, 'rect');
    outer.setAttribute('x', '2'); outer.setAttribute('y', '4');
    outer.setAttribute('width', '20'); outer.setAttribute('height', '16');
    outer.setAttribute('rx', '2'); outer.setAttribute('fill', 'none');
    outer.setAttribute('stroke', '#fff'); outer.setAttribute('stroke-width', '2');
    const inner = document.createElementNS(svgNS, 'rect');
    inner.setAttribute('x', '12'); inner.setAttribute('y', '12');
    inner.setAttribute('width', '8'); inner.setAttribute('height', '6');
    inner.setAttribute('rx', '1'); inner.setAttribute('fill', '#fff');
    svg.appendChild(outer);
    svg.appendChild(inner);
    b.appendChild(svg);
    b.style.cssText =
      'position:absolute;top:12px;right:114px;z-index:2147483645;' +
      'width:34px;height:34px;border-radius:17px;border:none;padding:0;' +
      'background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;' +
      '-webkit-tap-highlight-color:transparent;';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePiP();
    }, true);
    return b;
  }

  const LAND_UI_HIDE_MS = 3000;
  let landUiTimer = null;
  const showLandUi = () => {
    if (!document.documentElement) return;
    document.documentElement.classList.remove('ytl-ui-hidden');
    clearTimeout(landUiTimer);
    landUiTimer = setTimeout(() => {
      const menuOpen = qMenu && qMenu.style.display === 'block';
      const relOpenNow = !!document.querySelector('.ytl-rel.open');
      if (landOn && !menuOpen && !relOpenNow) document.documentElement.classList.add('ytl-ui-hidden');
      else if (landOn) showLandUi();   // メニューを開いている間は消さない
    }, LAND_UI_HIDE_MS);
  };
  // 画面に触れたらボタンを出す（消えている間のタップは、ボタンを出すだけ）
  window.addEventListener('touchstart', () => { if (landOn) showLandUi(); }, { capture: true, passive: true });
  let landUiWas = false;
  setInterval(() => {
    if (landOn && !landUiWas) showLandUi();           // 全画面に入った → まず表示して3秒後に隠す
    if (!landOn && landUiWas && document.documentElement) {
      clearTimeout(landUiTimer);
      document.documentElement.classList.remove('ytl-ui-hidden');
    }
    landUiWas = landOn;
  }, 200);

  // ============================================================
  // 17. シークバー：タップでは動かさず、今の再生位置を長押し → 指を滑らせて移動
  // ============================================================
  const SEEK_SELECTOR = '.ytp-progress-bar-container, .ytp-progress-bar, ytm-progress-bar, ' +
    '[class*="progress-bar"], [class*="ProgressBar"], [class*="progressBar"], [class*="progress_bar"]';
  const SEEK_HOLD_MS = 350;       // これだけ押し続けたら持ち上がる
  const SEEK_HEAD_RANGE = 44;     // 再生位置からこの距離以内を押したときだけ
  const SEEK_ZONE = 48;           // プレーヤー下端からこの高さまでをシークバーとして扱う
  const SEEK_PREVIEW_MS = 250;    // 動かしている間、この間隔で場面を切り替えて見せる
  // シークバーの左右の余白（虹のバーを出しているときは短いバーに合わせる）
  const seekInset = () => {
    try { return window.__ytlRbarGeom ? window.__ytlRbarGeom().inset : 0; } catch (_) { return 0; }
  };
  // シークバーの基準（左端の位置と長さ）：YouTubeの元のバーが見つかればそれ、無ければ決め打ち
  const barSpan = (L, player) => {
    const g = player ? getTrackGeom(player) : null;
    if (g) return { start: g.left, len: g.width };
    const inset = seekInset();
    return { start: inset, len: L.W - inset * 2 };
  };
  const fracFromLocal = (L, player) => {
    const b = barSpan(L, player);
    return Math.min(1, Math.max(0, (L.x - b.start) / Math.max(1, b.len)));
  };
  const headXFromFrac = (L, frac, player) => {
    const b = barSpan(L, player);
    return b.start + frac * b.len;
  };
  // 指定の位置の場面を動画そのものにも映す（まだ読み込んでいない所も取りに行く）
  const previewSeek = (v, t) => {
    const api = getPlayerApi();
    try {
      if (api && api.seekTo) api.seekTo(t, true);
      else v.currentTime = t;
    } catch (_) { try { v.currentTime = t; } catch (_) {} }
  };

  // ---- ストーリーボード（YouTubeが用意している場面の一覧画像）からサムネイルを出す ----
  const getStoryboard = () => {
    const vid = getCurrentId();
    if (!vid) return null;
    let spec = storyboardSpecs[vid];
    if (!spec) {
      // 取りこぼしたときは、プレーヤーやページのデータから探す
      const cands = [];
      try { const api = getPlayerApi(); if (api && api.getPlayerResponse) cands.push(api.getPlayerResponse()); } catch (_) {}
      try { cands.push(window.ytInitialPlayerResponse); } catch (_) {}
      for (const pr of cands) {
        try {
          if (pr && pr.videoDetails && pr.videoDetails.videoId === vid) {
            spec = pr.storyboards.playerStoryboardSpecRenderer.spec;
            if (spec) { storyboardSpecs[vid] = spec; break; }
          }
        } catch (_) {}
      }
    }
    if (!spec) return null;
    const parts = spec.split('|');
    const base = parts[0];
    const levels = parts.slice(1).map((p) => p.split('#'));
    if (!levels.length) return null;
    // 幅180px以下でいちばん細かいもの
    let li = 0;
    levels.forEach((lv, i) => { if (+lv[0] <= 180 && +lv[0] >= +levels[li][0]) li = i; });
    const lv = levels[li];
    return {
      base, L: li, w: +lv[0], h: +lv[1], count: +lv[2], cols: +lv[3], rows: +lv[4],
      interval: +lv[5], name: lv[6], sigh: lv[7],
    };
  };
  const storyboardFrame = (sb, t, duration) => {
    if (!sb || !sb.count || !sb.cols || !sb.rows) return null;
    let idx = sb.interval > 0 ? Math.floor((t * 1000) / sb.interval) : Math.floor((t / duration) * sb.count);
    idx = Math.max(0, Math.min(sb.count - 1, idx));
    const perPage = sb.cols * sb.rows;
    const page = Math.floor(idx / perPage);
    const inPage = idx % perPage;
    const left = sb.count - page * perPage;            // このページにある枚数（最後のページは少ない）
    const colsOnPage = Math.min(sb.cols, left);
    const rowsOnPage = Math.min(sb.rows, Math.ceil(left / sb.cols));
    let url = sb.base.replace('$L', String(sb.L)).replace('$N', String(sb.name).replace('$M', String(page)));
    if (sb.sigh) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'sigh=' + sb.sigh;
    return { url, col: inPage % sb.cols, row: Math.floor(inPage / sb.cols), colsOnPage, rowsOnPage };
  };

  // YouTubeの元のシークバー（線の部分）の、プレーヤーから見た位置と長さを測る。
  // スマホ版ではシークバーがプレーヤーの「外」（上に重なる操作パネル）にあるので、
  // プレーヤーを含む入れ物全体から探し、画面上の位置をプレーヤー基準に直す（回転していても）。
  // 操作パネルが隠れて測れないときは、最後に測った値を使う。
  let trackCache = null;
  const TRACK_SELECTOR = '[class*="progress-bar"], [class*="ProgressBar"], [class*="progress_bar"], ' +
    '[class*="progressBar"], ytm-progress-bar, .ytp-progress-bar, .ytp-progress-list';
  function playerSize(player) {
    const pr = player.getBoundingClientRect();
    const vv = window.visualViewport;
    const portrait = (vv ? vv.height : window.innerHeight) > (vv ? vv.width : window.innerWidth);
    const rotated = landOn && portrait && (landDir === 1 || landDir === -1);
    return { pr, rotated, W: rotated ? pr.height : pr.width, H: rotated ? pr.width : pr.height };
  }
  function localRectOf(el, player) {
    const { pr, rotated } = playerSize(player);
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    if (rotated && landDir === 1) return { left: r.top - pr.top, top: pr.right - r.right, width: r.height, height: r.width };
    if (rotated && landDir === -1) return { left: pr.bottom - r.bottom, top: r.left - pr.left, width: r.height, height: r.width };
    return { left: r.left - pr.left, top: r.top - pr.top, width: r.width, height: r.height };
  }
  function getTrackGeom(player) {
    const { W, H } = playerSize(player);
    if (!W || !H) return null;
    const scope = document.getElementById('player-container-id') ||
                  (player.parentElement && player.parentElement.parentElement) || player;
    let best = null;
    let bestScore = -Infinity;
    scope.querySelectorAll(TRACK_SELECTOR).forEach((el) => {
      if (el.closest('.ytl-own')) return;
      const r = localRectOf(el, player);
      if (!r) return;
      // プレーヤーの横幅の半分以上あって、細くて、プレーヤーの範囲にあるもの
      if (r.width < W * 0.5 || r.width > W + 2 || r.height > 40 || r.height <= 0) return;
      if (r.top < -10 || r.top + r.height > H + 20) return;
      const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) + ' ' + el.tagName;
      let score = 0;
      if (/background|line|track|list|bar-?bg|rail/i.test(cls)) score += 2;   // 線そのものっぽい部品を優先
      if (/played|play-progress|loaded|buffer|hover|playhead|scrubber/i.test(cls)) score -= 3;  // 再生済み部分などは除く
      if (r.left > 0.5) score += 1;                                           // 左右に余白があるもの
      score -= r.height / 100;                                                // 細いほど線らしい
      if (score > bestScore) { bestScore = score; best = r; }
    });
    if (best) trackCache = { left: best.left, width: best.width, cy: best.top + best.height / 2, W, H };
    return trackCache && Math.abs(trackCache.W - W) < 1 && Math.abs(trackCache.H - H) < 1 ? trackCache : null;
  }

  // 画面上の指の位置を、プレーヤーから見た位置（左右・上下）に直す（横全画面で回転していても）
  const playerLocal = (player, tx, ty) => {
    const r = player.getBoundingClientRect();
    const vv = window.visualViewport;
    const portrait = (vv ? vv.height : window.innerHeight) > (vv ? vv.width : window.innerWidth);
    if (landOn && portrait && landDir === 1) return { x: ty - r.top, y: r.right - tx, W: r.height, H: r.width };
    if (landOn && portrait && landDir === -1) return { x: r.bottom - ty, y: tx - r.left, W: r.height, H: r.width };
    return { x: tx - r.left, y: ty - r.top, W: r.width, H: r.height };
  };

  // その位置がシークバーかどうか
  const seekZoneAt = (target, tx, ty) => {
    if (ROLE === 'browse' || miniOn || !isWatchPage()) return null;
    const player = document.querySelector('.html5-video-player');
    const v = getMainVideo();
    if (!player || !v || !Number.isFinite(v.duration) || v.duration <= 0) return null;
    if (target && target.closest && target.closest('.ytl-own, [data-ytl-drag], .ytl-land-ui')) return null;
    const onBar = !!(target && target.closest && target.closest(SEEK_SELECTOR));
    const area = document.getElementById('player-container-id') || player.parentElement || player;
    if (!onBar && !(target && (player.contains(target) || area.contains(target)))) return null;
    const L = playerLocal(player, tx, ty);
    const g = getTrackGeom(player);
    const inBottom = g
      ? (Math.abs(L.y - g.cy) <= 26 && L.x >= g.left - 24 && L.x <= g.left + g.width + 24)
      : (L.x >= 0 && L.x <= L.W && L.y >= L.H - SEEK_ZONE && L.y <= L.H + 8);
    if (!onBar && !inBottom) return null;
    return { player, v, L };
  };

  const fmtTime = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s2 = String(sec % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + s2 : m + ':' + s2;
  };

  // 指の上に出す吹き出し（場面のサムネイル＋時間）
  let seekTip = null;
  let seekThumb = null;
  let seekText = null;
  const showSeekTip = (player, frac, text, duration) => {
    if (!seekTip) {
      seekTip = document.createElement('div');
      seekTip.className = 'ytl-own';
      seekTip.style.cssText =
        'position:absolute;bottom:22px;transform:translateX(-50%);z-index:2147483645;' +
        'display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;';
      seekThumb = document.createElement('div');
      seekThumb.style.cssText =
        'border:2px solid #fff;border-radius:6px;background-color:#000;background-repeat:no-repeat;' +
        'box-shadow:0 2px 10px rgba(0,0,0,0.5);display:none;';
      seekText = document.createElement('div');
      seekText.style.cssText =
        'background:rgba(0,0,0,0.78);color:#fff;font:bold 13px sans-serif;white-space:nowrap;' +
        'padding:5px 9px;border-radius:7px;';
      seekTip.appendChild(seekThumb);
      seekTip.appendChild(seekText);
    }
    if (seekTip.parentNode !== player) player.appendChild(seekTip);
    seekText.textContent = text;

    // サムネイル
    let boxW = 80;
    const sb = duration ? getStoryboard() : null;
    const fr = sb ? storyboardFrame(sb, frac * duration, duration) : null;
    if (fr) {
      const wantW = landOn ? 200 : 150;
      const s = wantW / sb.w;
      const tw = Math.round(sb.w * s);
      const th = Math.round(sb.h * s);
      boxW = tw + 4;
      seekThumb.style.width = tw + 'px';
      seekThumb.style.height = th + 'px';
      seekThumb.style.backgroundImage = 'url("' + fr.url + '")';
      seekThumb.style.backgroundSize = (fr.colsOnPage * sb.w * s) + 'px ' + (fr.rowsOnPage * sb.h * s) + 'px';
      seekThumb.style.backgroundPosition = (-fr.col * sb.w * s) + 'px ' + (-fr.row * sb.h * s) + 'px';
      seekThumb.style.display = 'block';
    } else {
      seekThumb.style.display = 'none';
    }

    // 指の位置（再生位置）の真上に。プレーヤーの端ではみ出さないように
    const { W } = playerSize(player);
    const head = headXFromFrac({ W }, frac, player);
    const half = boxW / 2 + 6;
    seekTip.style.left = Math.min(W - half, Math.max(half, head)) + 'px';
    seekTip.style.display = 'flex';
  };
  const hideSeekTip = (delay) => {
    setTimeout(() => { if (seekTip) seekTip.style.display = 'none'; }, delay || 0);
  };

  let seekActive = false;     // シークバー上で指が触れている間
  let seekBlockUntil = 0;     // 指を離した直後も、YouTube側の反応を止めておく
  let sk = null;              // 長押し中の情報

  const startSeekTouch = (e, tx, ty) => {
    const z = seekZoneAt(e.target, tx, ty);
    if (!z) return false;
    seekActive = true;
    const frac = z.v.currentTime / z.v.duration;
    const headX = headXFromFrac(z.L, frac, z.player);
    const nearHead = Math.abs(z.L.x - headX) <= SEEK_HEAD_RANGE;
    clearTimeout(sk && sk.timer);
    sk = { player: z.player, v: z.v, startX: tx, startY: ty, armed: false, nearHead, frac, timer: null,
           wasPlaying: !z.v.paused, lastPreview: 0 };
    if (nearHead) {
      sk.timer = setTimeout(() => {
        if (!sk) return;
        sk.armed = true;   // 持ち上がった：ここから指を滑らせて移動
        // 動かしている間は一時停止して、指の位置の場面を見せる
        if (sk.wasPlaying) { try { sk.v.pause(); } catch (_) {} }
        window.__ytlSeekPreview = sk.frac;
        showSeekTip(sk.player, sk.frac, fmtTime(sk.frac * sk.v.duration) + ' / ' + fmtTime(sk.v.duration), sk.v.duration);
      }, SEEK_HOLD_MS);
    }
    return true;
  };

  const block = (e) => {
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
  };

  // ポインター系は、タッチより先に届くことがあるので、ここでも判定して止める
  for (const type of ['pointerdown', 'mousedown']) {
    window.addEventListener(type, (e) => {
      if (seekActive || Date.now() < seekBlockUntil) { block(e); return; }
      if (seekZoneAt(e.target, e.clientX, e.clientY)) {
        seekBlockUntil = Date.now() + 1500;   // 続くタッチの処理まで止めておく
        block(e);
      }
    }, true);
  }
  for (const type of ['pointermove', 'pointerup', 'mouseup', 'click']) {
    window.addEventListener(type, (e) => {
      if (seekActive || Date.now() < seekBlockUntil) block(e);
    }, true);
  }

  window.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (startSeekTouch(e, t.clientX, t.clientY)) block(e);
  }, { capture: true, passive: false });

  window.addEventListener('touchmove', (e) => {
    if (!seekActive || !sk) return;
    block(e);
    const t = e.touches[0];
    if (!sk.armed) {
      // 長押しになる前に指が動いたら、シークはしない
      if (Math.hypot(t.clientX - sk.startX, t.clientY - sk.startY) > 12) clearTimeout(sk.timer);
      return;
    }
    const L = playerLocal(sk.player, t.clientX, t.clientY);
    sk.frac = fracFromLocal(L, sk.player);
    window.__ytlSeekPreview = sk.frac;
    // 指の位置の場面を動画にも映す（動かしている間は間隔をあけて、指が止まったらすぐ）
    const now = Date.now();
    const s0 = sk;
    clearTimeout(s0.restTimer);
    if (now - s0.lastPreview >= SEEK_PREVIEW_MS) {
      s0.lastPreview = now;
      previewSeek(s0.v, s0.frac * s0.v.duration);
    } else {
      s0.restTimer = setTimeout(() => {
        if (sk !== s0) return;
        s0.lastPreview = Date.now();
        previewSeek(s0.v, s0.frac * s0.v.duration);
      }, 120);
    }
    showSeekTip(sk.player, sk.frac, fmtTime(sk.frac * sk.v.duration) + ' / ' + fmtTime(sk.v.duration), sk.v.duration);
  }, { capture: true, passive: false });

  const endSeekTouch = (e) => {
    if (!seekActive) return;
    block(e);
    seekActive = false;
    seekBlockUntil = Date.now() + 600;
    const s = sk;
    sk = null;
    if (!s) return;
    clearTimeout(s.timer);
    clearTimeout(s.restTimer);
    if (s.armed) {
      const target = s.frac * s.v.duration;
      const api = getPlayerApi();
      try {
        if (api && api.seekTo) api.seekTo(target, true);
        else s.v.currentTime = target;
      } catch (_) { s.v.currentTime = target; }
      dbg('シーク: ' + fmtTime(target));
      // もともと再生中だったら再開
      if (s.wasPlaying) {
        setTimeout(() => {
          try { if (api && api.playVideo) api.playVideo(); } catch (_) {}
          s.v.play().catch(() => {});
        }, 120);
      }
      setTimeout(() => { window.__ytlSeekPreview = null; }, 400);
      hideSeekTip(600);
    } else {
      window.__ytlSeekPreview = null;   // タップしただけ → 何もしない
    }
  };
  window.addEventListener('touchend', endSeekTouch, { capture: true, passive: false });
  window.addEventListener('touchcancel', endSeekTouch, { capture: true, passive: false });

  // ============================================================
  // 18. 再生画面で動画を上下に引っ張る
  //     上に引っ張る → 横全画面 / 下に引っ張る → ミニプレーヤー（アプリ版）
  // ============================================================
  if (ROLE !== 'browse') {
    let sw = null;
    document.addEventListener('touchstart', (e) => {
      sw = null;
      if (landOn || miniOn || seekActive || e.touches.length !== 1 || !isWatchPage()) return;
      const player = document.querySelector('.html5-video-player');
      if (!player) return;
      const t = e.touches[0];
      const r = player.getBoundingClientRect();
      if (t.clientX < r.left || t.clientX > r.right || t.clientY < r.top || t.clientY > r.bottom) return;
      if (e.target && e.target.closest && e.target.closest('button, a, .ytl-own, [data-ytl-drag]')) return;
      sw = { x: t.clientX, y: t.clientY, decided: false, vertical: false, player };
    }, { capture: true, passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!sw) return;
      const t = e.touches[0];
      const dx = t.clientX - sw.x;
      const dy = t.clientY - sw.y;
      if (!sw.decided && Math.hypot(dx, dy) > 10) {
        sw.decided = true;
        sw.vertical = Math.abs(dy) > Math.abs(dx);
      }
      if (sw.vertical) {
        e.preventDefault();   // ページがスクロールしないように
        sw.player.style.transition = 'none';
        sw.player.style.transform = 'translateY(' + Math.max(-40, Math.min(40, dy * 0.25)) + 'px)';
      }
    }, { capture: true, passive: false });

    const endSwipe = (e) => {
      const s = sw;
      sw = null;
      if (!s || !s.vertical) return;
      s.player.style.transition = 'transform 0.2s';
      s.player.style.transform = '';
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dy = t.clientY - s.y;
      if (dy < -60) {
        if (e.cancelable) e.preventDefault();
        enterLand(preferredLandDir());          // 上に引っ張った → 横全画面
      } else if (dy > 60 && IN_APP) {
        if (e.cancelable) e.preventDefault();
        postNative({ minimize: true });         // 下に引っ張った → ミニプレーヤー
      }
    };
    document.addEventListener('touchend', endSwipe, { capture: true, passive: false });
    document.addEventListener('touchcancel', endSwipe, { capture: true, passive: false });
  }
})();
