// ==UserScript==
// @name         YT Lite (iOS Safari)
// @description  動画広告の自動スキップ・広告枠の非表示・バックグラウンド再生・アプリ誘導バナーの非表示
// @version      4.3
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
  const YTL_VERSION = '4.3';
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
  const pruneAds = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 3) return obj;
    if (Array.isArray(obj)) {
      for (const item of obj) pruneAds(item, depth + 1);
      return obj;
    }
    for (const k of AD_KEYS) {
      if (k in obj) {
        try { delete obj[k]; } catch (_) {}
      }
    }
    if (obj.playerResponse) pruneAds(obj.playerResponse, depth + 1);
    if (obj.response) pruneAds(obj.response, depth + 1);
    return obj;
  };

  // JSON.parse 経由で読まれるデータ
  try {
    const origParse = JSON.parse;
    JSON.parse = function (...args) {
      const result = origParse.apply(this, args);
      try { pruneAds(result); } catch (_) {}
      return result;
    };
  } catch (_) {}

  // fetch のレスポンス(.json())経由で読まれるデータ
  try {
    const origJson = Response.prototype.json;
    Response.prototype.json = function () {
      return origJson.call(this).then((r) => {
        try { pruneAds(r); } catch (_) {}
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
        set: (v) => { stored = pruneAds(v); },
      });
    } catch (_) {}
  }

  // ============================================================
  // 1. バックグラウンド再生
  //    YouTubeは「ページが非表示になった」ことを検知して再生を止めるので、
  //    常に「表示中」と答えるようにする。
  // ============================================================
  const hiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  const isReallyHidden = () => {
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
    if (!wantPiP) return;
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
    return extractNextIds(await res.json());
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

  // ------------------------------------------------------------
  // 動作確認用ログ（画面左上）。原因がわかったら DEBUG を false に
  // ------------------------------------------------------------
  const DEBUG = !IN_APP;
  const dbgLines = [];
  let dbgBox = null;
  let dbgHideTimer = null;
  const dbg = (msg) => {
    if (!DEBUG) return;
    try { console.log('[YT Lite]', msg); } catch (_) {}
    const t = new Date();
    const stamp = String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
    dbgLines.push(stamp + ' ' + msg);
    while (dbgLines.length > 8) dbgLines.shift();
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
    dbgHideTimer = setTimeout(() => { if (dbgBox) dbgBox.style.display = 'none'; }, 60000);
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
    location.assign('/watch?v=' + id + (t > 3 ? '&t=' + t + 's' : ''));
  }

  onReallyVisible = () => {
    if (!pendingNavId) { setTimeout(refreshStaleInfo, 800); return; }
    const id = pendingNavId;
    pendingNavId = null;
    const v = getMainVideo();
    if (v && !v.paused) return;  // その間に再生が始まっていれば何もしない
    dbg('画面に戻ったので開き直す');
    location.assign('/watch?v=' + id);
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
          location.assign('/watch?v=' + targetId);
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
  const findNextId = async (current) => {
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
      if (listId && api && typeof api.nextVideo === 'function') {
        dbg('再生リストの次へ');
        if (inBackground) staleInfo = true;
        api.nextVideo();
        setTimeout(() => ensurePlaying(getCurrentId()), 500);
        if (wantPiP) scheduleRePiP();
        return;
      }

      // 先読みしてあればそれを使い、なければここで探す
      let next = (prefetched && prefetched.forId === current) ? prefetched.nextId : null;
      if (next) dbg('先読み済みの次の動画を使う');
      else next = await findNextId(current);
      if (!next) { dbg('次の動画が見つからない'); return; }
      dbg('次: ' + next);
      playedIds.push(next);

      // 画面で見ているときは、ページごと移動（タイトルや説明もちゃんと新しくなる）
      if (!inBackground) {
        dbg('ページごと次の動画へ');
        location.assign('/watch?v=' + next);
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
        try { history.replaceState(history.state, '', '/watch?v=' + next); } catch (_) {}
        ensurePlaying(next);
        if (wantPiP) scheduleRePiP();
      } else {
        // 最終手段：ページごと移動（PiPは切れる）
        dbg('ページ移動で次へ');
        location.assign('/watch?v=' + next);
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

    // PiPか裏で再生しているときだけ
    const background = isInPiP(v) || isReallyHidden();
    if (!background) return;

    // 1) 残り20秒で次の動画を決めておく
    if (remaining < PREFETCH_SEC && !prefetching &&
        !(prefetched && prefetched.forId === current)) {
      prefetching = true;
      findNextId(current).then((id) => {
        if (id) {
          prefetched = { forId: current, nextId: id };
          dbg('先読み: ' + id);
        }
      }).finally(() => { prefetching = false; });
    }

    // 2) 残り1秒で、止まる前に次へ
    if (remaining < SWITCH_SEC && earlySwitchedFor !== current) {
      earlySwitchedFor = current;
      endHandledFor = current;  // 終了検知の側で二重に進まないように
      dbg('終わる直前に次へ切り替え（' + (isInPiP(v) ? 'PiP' : '裏') + '）');
      playNext();
    }
  }, true);

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
    const ver = document.createElement('div');
    ver.textContent = (IN_APP ? 'yo!!tube' : 'YT Lite') + ' v' + YTL_VERSION + (IN_APP ? '（アプリ）' : '（Safari）');
    ver.style.cssText = 'padding:6px 14px 8px;font-size:11px;opacity:0.5;';
    qMenu.appendChild(ver);
    qMenu.style.display = 'block';
  };

  const makeQualityUi = () => {
    qBtn = document.createElement('button');
    qBtn.className = 'ytl-own';
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
    } else if (qBtn && qBtn.parentNode) {
      closeQualityMenu();
      qBtn.remove();
      qMenu.remove();
      if (rBtn) rBtn.remove();
    }
  }, 300);

  // ============================================================
  // 10. アプリ版から呼ぶ入口（自動PiP・裏での切り替えの押し直し）
  // ============================================================
  let autoPiPStarted = false;
  Object.assign(window.ytLite = window.ytLite || {}, {
    // ホームに戻る瞬間にアプリから呼ばれる：再生中ならPiPにする
    autoPiP: () => {
      const v = getMainVideo();
      if (!v || v.paused || v.ended || !isWatchPage() || isInPiP(v)) return false;
      unlockPiP(v);
      try {
        if (v.webkitSetPresentationMode) v.webkitSetPresentationMode('picture-in-picture');
        else if (v.requestPictureInPicture) v.requestPictureInPicture().catch(() => {});
        autoPiPStarted = true;
        return true;
      } catch (_) { return false; }
    },
    // アプリに戻ってきたら、自動で開いたPiPは閉じて元の画面に戻す
    cancelAutoPiP: () => {
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
    b.className = 'ytl-own';
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
    const RAINBOW = 'linear-gradient(to bottom,' +
      '#ff2d55 0 16.6%,#ff9500 16.6% 33.3%,#ffd60a 33.3% 50%,' +
      '#34c759 50% 66.6%,#0a84ff 66.6% 83.3%,#8e5bff 83.3% 100%)';

    const rbCss = `
      .ytl-rbar { position:absolute; left:0; right:0; bottom:0; height:6px; z-index:60;
                  pointer-events:none; background:rgba(255,255,255,0.18); }
      .ytl-rbar-fill { position:absolute; left:0; top:0; bottom:0; width:0;
                       background:${RAINBOW}; overflow:hidden; }
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
      /* YouTubeの赤い再生バーも、見つかったものは虹色に */
      .ytp-play-progress, .progress-bar-played,
      .ytProgressBarLineProgressBarPlayed, [class*="ProgressBarPlayed"] {
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

    let rbar = null;
    let rfill = null;
    let rstar = null;
    setInterval(() => {
      const player = document.querySelector('.html5-video-player');
      const v = getMainVideo();
      const show = player && v && isWatchPage() && Number.isFinite(v.duration) && v.duration > 0 &&
                   !player.classList.contains('ad-showing') && !player.classList.contains('ad-interrupting');
      if (!show) {
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
      const pct = Math.min(100, Math.max(0, (v.currentTime / v.duration) * 100));
      rfill.style.width = pct + '%';
      rstar.style.left = pct + '%';
      // 一時停止中は流れ星も止める
      rstar.style.animationPlayState = v.paused ? 'paused' : 'running';
    }, 250);
  }
})();
