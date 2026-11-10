window.__ModuleLoader__.load({
  id: 'dsh-content-factory',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const API = '/content-studio/api'

    /* ------------------------------------------------------------------ */
    /* styles                                                              */
    /* ------------------------------------------------------------------ */
    const LINE = '0.5px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 12%, transparent))'
    const SOFT = 'var(--dsw-alias-bg-layer-3, color-mix(in srgb, currentColor 5%, transparent))'

    const S = {
      page: { display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 24px 48px', maxWidth: 1200, margin: '0 auto' },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      spread: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' },
      col: { display: 'flex', flexDirection: 'column', gap: 12 },
      card: {
        border: LINE, borderRadius: 'var(--dsw-radius-lg, 12px)', padding: 16,
        display: 'flex', flexDirection: 'column', gap: 12,
        background: 'var(--dsw-alias-bg-layer-1, transparent)',
      },
      muted: { color: 'var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 55%, transparent))', fontSize: 12, lineHeight: 1.5 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
      btn: {
        font: 'inherit', fontSize: 12, height: 30, padding: '0 12px',
        borderRadius: 'var(--dsw-radius-md, 8px)', border: '0.5px solid transparent',
        background: 'transparent', color: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
      },
      btnOn: {
        font: 'inherit', fontSize: 12, height: 30, padding: '0 12px',
        borderRadius: 'var(--dsw-radius-md, 8px)', border: '0.5px solid transparent',
        background: 'var(--dsw-alias-button-primary-fill, currentColor)',
        color: 'var(--dsw-alias-label-primary-foreground, #fff)', cursor: 'pointer', whiteSpace: 'nowrap',
      },
      tab: (active) => ({
        font: 'inherit', fontSize: 13, height: 36, padding: '0 12px', cursor: 'pointer',
        border: 0, borderBottom: active ? '2px solid currentColor' : '2px solid transparent',
        background: 'transparent', color: 'inherit', opacity: active ? 1 : 0.62,
      }),
      input: {
        font: 'inherit', fontSize: 13, height: 32, padding: '0 10px',
        borderRadius: 'var(--dsw-radius-md, 8px)',
        border: '0.5px solid var(--dsw-alias-border-l4, color-mix(in srgb, currentColor 20%, transparent))',
        background: 'var(--dsw-alias-bg-layer-1, transparent)', color: 'inherit', minWidth: 0,
      },
      area: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5,
        width: '100%', minHeight: 120, padding: 10, borderRadius: 'var(--dsw-radius-md, 8px)',
        border: '0.5px solid var(--dsw-alias-border-l4, color-mix(in srgb, currentColor 20%, transparent))',
        background: 'var(--dsw-alias-bg-layer-1, transparent)',
        color: 'inherit', boxSizing: 'border-box',
      },
      media: { width: '100%', maxHeight: 420, borderRadius: 'var(--dsw-radius-md, 8px)', background: '#000', objectFit: 'contain' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 },
      pre: {
        margin: 0, padding: 10, borderRadius: 'var(--dsw-radius-md, 8px)', border: LINE, maxHeight: 220, overflow: 'auto',
        fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: SOFT,
      },
      progress: { height: 4, borderRadius: 999, background: 'var(--dsw-alias-bg-layer-4, color-mix(in srgb, currentColor 8%, transparent))', overflow: 'hidden' },
      progressFill: (pct) => ({ height: '100%', width: `${Math.round(pct * 100)}%`, background: 'var(--dsw-alias-state-business-primary, currentColor)' }),
      dot: (on) => ({ width: 6, height: 6, borderRadius: 999, background: 'currentColor', opacity: on ? 1 : 0.28 }),
    }

    const CSS = `
.cs-page {
  /* 深色宿主的层级要由插件自己掌控，不能混用宿主的浅色 layer-0 与深色 label token。 */
  --cs-canvas: #121419;
  --cs-ink: #f3f6fc;
  --cs-paper: #1b1e25;
  --cs-well: #242831;
  --cs-fill: #1b1e25;
  --cs-fill-2: #20242c;
  --cs-fill-3: #2b303a;
  --cs-hover: #2a303b;
  --cs-border: #363c48;
  --cs-border-strong: #4b5362;
  --cs-text: var(--cs-ink);
  --cs-text-2: #bec7d6;
  --cs-text-3: #8d98aa;
  --cs-accent: #86aaff;
  --cs-accent-strong: #a8c2ff;
  --cs-on-accent: #101827;
  --cs-media-bg: #0c0f14;
  --cs-display: "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", "Noto Serif SC", Palatino, serif;
  --cs-radius: 10px;
  --cs-radius-lg: 14px;
  --cs-success: #55c98a;
  --cs-warn: #f2b85b;
  --cs-danger: #ff7582;
  color: var(--cs-text); background: var(--cs-canvas); font-size: 14px; line-height: 1.45;
  font-family: "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif;
  display: flex; flex-direction: column;
}
.cs-page { flex: 1 1 auto; height: 100%; min-height: 0; overflow: hidden; overscroll-behavior: contain; background: var(--cs-canvas); }
.cs-page-inner { display: flex; flex-direction: column; gap: 0; padding: 0; margin: 0; width: 100%; height: 100%; min-height: 0; max-width: none; }
.cs-page *, .cs-page *::before, .cs-page *::after { box-sizing: border-box; }
.cs-page h1, .cs-page h2, .cs-page h3, .cs-page p { margin: 0; }
.cs-page ::selection { background: color-mix(in srgb, var(--cs-ink) 16%, transparent); }
.cs-page :focus-visible { outline: 2px solid var(--cs-ink); outline-offset: 2px; }
.cs-page button { font-family: inherit; }
.cs-page button:disabled { cursor: not-allowed; opacity: 0.42; }
.cs-page input:focus, .cs-page select:focus, .cs-page textarea:focus { outline: none; }
.cs-page input::placeholder, .cs-page textarea::placeholder { color: var(--cs-text-3); }

.cs-chrome { position: relative; display: flex; align-items: center; justify-content: center; gap: 22px; padding: 20px 28px 14px; flex-shrink: 0; border-bottom: 1px solid var(--cs-border); background: var(--cs-canvas); }
.cs-header { display: contents; }
.cs-title { margin-right: auto; font-family: var(--cs-display); font-size: 30px; line-height: 1; letter-spacing: -0.03em; font-weight: 600; }
.cs-subtitle { display: none; }
.cs-header-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.cs-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 14px; padding: 16px 28px 20px; overflow: hidden; }
.cs-body.is-scroll { overflow-y: auto; overscroll-behavior: contain; }

.cs-tabs { position: absolute; left: 50%; transform: translateX(-50%); display: inline-flex; gap: 3px; align-items: center; padding: 3px; border: 1px solid color-mix(in srgb, var(--cs-border) 78%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--cs-paper) 72%, transparent); box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%), 0 8px 24px rgb(0 0 0 / 14%); backdrop-filter: blur(14px); }
.cs-tab { flex: 0 0 78px; width: 78px; height: 32px; padding: 0 8px; border: 0; margin: 0; border-radius: 999px; background: transparent; color: var(--cs-text-2); font-size: 13px; line-height: 32px; text-align: center; cursor: pointer; transition: background 140ms ease, color 140ms ease, box-shadow 140ms ease; }
.cs-tab:hover { color: var(--cs-text); background: color-mix(in srgb, var(--cs-hover) 72%, transparent); }
.cs-tab.is-active { color: var(--cs-on-accent); font-weight: 600; background: var(--cs-accent); box-shadow: 0 3px 10px color-mix(in srgb, var(--cs-accent) 30%, transparent); }

.cs-stats { display: flex; align-items: stretch; border: 0.5px solid var(--cs-border); border-radius: var(--cs-radius-lg); background: var(--cs-fill); overflow: hidden; }
.cs-stat { flex: 1; min-width: 0; padding: 10px 16px; border-left: 0.5px solid var(--cs-border); }
.cs-stat:first-child { border-left: 0; }
.cs-stat-label { display: block; font-size: 11px; line-height: 16px; color: var(--cs-text-3); }
.cs-stat-value { display: block; margin-top: 2px; font-size: 18px; line-height: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }

.cs-stack { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.cs-body > .cs-stack { flex: 1 1 auto; min-height: 0; }
.cs-stack > .cs-review, .cs-stack > .cs-films, .cs-stack > .cs-detail { flex: 0 0 auto; }
.cs-stat-inline { display: inline-flex; align-items: baseline; gap: 4px; font-size: 12px; color: var(--cs-text-3); }
.cs-stat-inline strong { color: var(--cs-text); font-weight: 600; font-variant-numeric: tabular-nums; }

.cs-prompt { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--cs-border); border-radius: var(--cs-radius-lg); background: var(--cs-fill); box-shadow: 0 8px 24px color-mix(in srgb, #071326 9%, transparent); position: relative; }
.cs-prompt-input { width: 100%; min-height: 78px; max-height: 180px; padding: 2px 2px 0; border: 0; resize: vertical; background: transparent; color: var(--cs-text); font: inherit; font-size: 16px; line-height: 1.55; }
.cs-prompt-input::placeholder { color: var(--cs-text-3); }
.cs-prompt-input:focus { outline: none; }
.cs-prompt-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding-top: 10px; border-top: 1px solid var(--cs-border); }
.cs-prompt-bar .cs-statusline { flex: 0 1 auto; min-width: 0; }
.cs-refs { display: flex; gap: 8px; flex-wrap: wrap; }
.cs-ref { position: relative; width: 48px; height: 48px; }
.cs-ref img { width: 100%; height: 100%; object-fit: cover; border-radius: 2px; display: block; }
.cs-ref-x { position: absolute; top: -4px; right: -4px; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 2px; background: var(--cs-ink); color: #fff; font-size: 12px; line-height: 18px; cursor: pointer; }
.cs-file { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.cs-intake { display: grid; grid-template-columns: minmax(0, 1.7fr) 88px minmax(0, 0.7fr) minmax(0, 1fr); gap: 12px 14px; padding: 16px 18px 0; }
.cs-intake-dir { grid-column: 1 / -1; display: flex; align-items: flex-end; gap: 8px; }
.cs-intake-dir .cs-field { flex: 1; }
.cs-dispatch { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 18px 16px; }
.cs-statusline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; line-height: 18px; color: var(--cs-text-2); }
.cs-lanes { display: grid; grid-template-columns: 1fr 1fr; border-top: 0.5px solid var(--cs-border); }
.cs-lane { padding: 14px 18px 16px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cs-lane + .cs-lane { border-left: 0.5px solid var(--cs-border); }
.cs-lane-kicker { font-size: 12px; line-height: 18px; color: var(--cs-text-3); }
.cs-lane-title { font-size: 14px; line-height: 22px; font-weight: 600; }
.cs-lane-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 0 18px 16px; }
.cs-log-mark { font-size: 12px; font-weight: 600; white-space: nowrap; }
.cs-log-mark.is-ok { color: var(--cs-success); }
.cs-log-mark.is-bad { color: var(--cs-danger); }
.cs-log-mark.is-wait { color: var(--cs-warn); }
.cs-chip { height: 36px; padding: 0 12px; border: 1px solid var(--cs-border-strong); border-radius: 2px; background: transparent; color: var(--cs-text-2); font-size: 13px; cursor: pointer; }
.cs-chip:hover { background: var(--cs-hover); color: var(--cs-text); }
.cs-chip.is-active { border-color: var(--cs-accent); color: var(--cs-on-accent); background: var(--cs-accent); }

.cs-studio { display: flex; flex-direction: column; gap: 14px; flex: 1 1 auto; min-height: 0; }
.cs-studio-tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cs-well { flex: 1 1 auto; min-height: 0; overflow: auto; background: var(--cs-well); border: 1px solid var(--cs-border); border-radius: var(--cs-radius-lg); padding: 18px; box-shadow: inset 0 1px 0 color-mix(in srgb, #ffffff 5%, transparent); }
.cs-empty-studio { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 20px; text-align: center; }
.cs-empty-mark { display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid color-mix(in srgb, var(--cs-accent) 45%, transparent); border-radius: 13px; color: var(--cs-accent); background: color-mix(in srgb, var(--cs-accent) 12%, transparent); font-size: 22px; }
.cs-empty-title { font-size: 15px; font-weight: 600; color: var(--cs-text); }
.cs-gates { display: grid; grid-template-columns: repeat(4, minmax(110px, 128px)); justify-content: center; gap: 12px; align-content: start; margin-top: 8px; }
.cs-gates.is-wide { grid-template-columns: repeat(4, minmax(160px, 200px)); }
.cs-gates.is-square { grid-template-columns: repeat(4, minmax(110px, 128px)); }
.cs-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 12px; align-content: start; }
.cs-well-copy { grid-column: 1 / -1; margin: 2px 0 0; color: var(--cs-text-2); font-size: 13px; line-height: 1.5; }
.cs-gate { aspect-ratio: 9 / 16; border: 1px dashed color-mix(in srgb, var(--cs-accent) 30%, var(--cs-border)); background: color-mix(in srgb, var(--cs-accent) 5%, var(--cs-fill)); border-radius: 9px; }
.cs-shot { position: relative; border-radius: 10px; overflow: hidden; background: var(--cs-media-bg); aspect-ratio: 9 / 16; border: 1px solid var(--cs-border-strong); cursor: pointer; }
.cs-shot.is-wide, .cs-gate.is-wide { aspect-ratio: 16 / 9; }
.cs-shot.is-square, .cs-gate.is-square { aspect-ratio: 1 / 1; }
.cs-shot.is-on { box-shadow: inset 0 0 0 2px var(--cs-accent), 0 0 0 3px color-mix(in srgb, var(--cs-accent) 18%, transparent); }
.cs-shot video { width: 100%; height: 100%; object-fit: cover; display: block; background: var(--cs-media-bg); pointer-events: none; }
.cs-shot-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--cs-text-2); font-size: 13px; padding: 12px; text-align: center; }
.cs-shot-check { position: absolute; top: 9px; left: 9px; width: 17px; height: 17px; margin: 0; appearance: none; border: 1px solid color-mix(in srgb, #ffffff 80%, var(--cs-accent)); background: rgb(0 0 0 / 24%); border-radius: 5px; }
.cs-shot-check:checked { background: var(--cs-accent); border-color: var(--cs-accent); box-shadow: inset 0 0 0 3px var(--cs-media-bg); }
.cs-shot-act { position: absolute; left: 8px; right: 8px; bottom: 8px; display: flex; gap: 6px; }
.cs-shot-act .cs-btn { height: 28px; padding: 0 10px; font-size: 12px; background: rgb(8 16 30 / 76%); color: #fff; border: 1px solid rgb(255 255 255 / 22%); border-radius: 7px; backdrop-filter: blur(8px); }
.cs-shot-act .cs-btn:hover:not(:disabled) { background: var(--cs-accent); border-color: var(--cs-accent); }
.cs-shot-x { position: absolute; top: 7px; right: 7px; z-index: 2; width: 26px; height: 26px; border: 1px solid rgb(255 255 255 / 18%); border-radius: 7px; background: rgb(8 16 30 / 68%); color: #fff; font-size: 16px; line-height: 1; cursor: pointer; backdrop-filter: blur(8px); }
.cs-shot-time { position: absolute; right: 9px; bottom: 43px; padding: 2px 6px; border-radius: 5px; background: rgb(8 16 30 / 68%); font-size: 11px; color: #fff; text-shadow: 0 1px 2px #000; }
.cs-preview { position: fixed; inset: 0; z-index: 1200; background: rgb(3 8 18 / 78%); display: flex; align-items: center; justify-content: center; padding: 24px; backdrop-filter: blur(8px); }
.cs-preview-box { width: min(440px, 92vw); display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--cs-border-strong); border-radius: var(--cs-radius-lg); background: var(--cs-paper); box-shadow: 0 20px 60px rgb(0 0 0 / 38%); }
.cs-preview-box video { width: 100%; max-height: 78vh; border-radius: 8px; background: var(--cs-media-bg); pointer-events: auto; }
.cs-preview-cap { margin: 0; color: var(--cs-text-2); font-size: 13px; line-height: 1.5; }
.cs-preview-bar { display: flex; gap: 8px; }
.cs-seg { display: inline-flex; height: 38px; padding: 3px; border: 1px solid var(--cs-border); border-radius: 10px; overflow: hidden; background: var(--cs-fill-2); }
.cs-seg-btn { height: 30px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent; color: var(--cs-text-2); font-size: 13px; cursor: pointer; transition: background 140ms ease, color 140ms ease; }
.cs-seg-btn:hover { color: var(--cs-text); background: var(--cs-hover); }
.cs-seg-btn:last-child { border-right: 0; }
.cs-seg-btn.is-on { background: var(--cs-accent); color: var(--cs-on-accent); box-shadow: 0 2px 6px color-mix(in srgb, var(--cs-accent) 22%, transparent); }
.cs-dock { flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; padding: 13px 14px 14px; border: 1px solid var(--cs-border); border-radius: var(--cs-radius-lg); background: var(--cs-paper); box-shadow: 0 10px 28px color-mix(in srgb, #071326 10%, transparent); }
.cs-dock-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cs-dur { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--cs-text-2); }
.cs-dur-input { width: 72px; height: 36px; padding: 0 8px; border: 1px solid var(--cs-border-strong); border-radius: 8px; background: var(--cs-fill-2); color: inherit; font: inherit; font-size: 13px; }
.cs-go { display: inline-flex; align-items: center; justify-content: center; height: 38px; min-width: 96px; margin-left: auto; padding: 0 20px; border: 0; border-radius: 9px; background: var(--cs-accent); color: var(--cs-on-accent); font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 16px color-mix(in srgb, var(--cs-accent) 24%, transparent); transition: background 140ms ease, transform 140ms ease, opacity 140ms ease; }
.cs-go:hover:not(:disabled) { background: var(--cs-accent-strong); transform: translateY(-1px); }
.cs-go:disabled { opacity: 0.48; cursor: not-allowed; box-shadow: none; }
.cs-films { flex-shrink: 0; display: flex; flex-direction: column; gap: 0; border-top: 1px solid var(--cs-border); margin-top: 8px; padding-top: 8px; }

.cs-thread { display: flex; flex-direction: column; gap: 10px; }
.cs-chat-user { align-self: flex-end; max-width: 82%; padding: 10px 12px; border-radius: 12px 12px 4px 12px; background: var(--cs-fill-2); font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
.cs-chat-ai { align-self: flex-start; max-width: 88%; display: flex; gap: 10px; padding: 12px; border: 0.5px solid var(--cs-border); border-radius: 12px 12px 12px 4px; background: var(--cs-fill); }
.cs-chat-avatar { flex: 0 0 24px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 999px; background: var(--cs-text); color: #fff; font-size: 10px; font-weight: 600; }
.cs-chat-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.cs-plan-facts { display: flex; flex-wrap: wrap; gap: 6px; }
.cs-plan-fact { display: inline-flex; align-items: baseline; gap: 4px; padding: 2px 8px; border-radius: 6px; background: var(--cs-fill-2); color: var(--cs-text-2); font-size: 12px; }
.cs-plan-fact strong { color: var(--cs-text); font-weight: 600; }

.cs-card { border: 1px solid var(--cs-border); border-radius: var(--cs-radius-lg); background: var(--cs-fill); padding: 16px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 6px 20px color-mix(in srgb, #071326 6%, transparent); }
.cs-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.cs-card-title { font-size: 14px; font-weight: 650; line-height: 20px; }
.cs-card-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cs-section-title { font-size: 12px; font-weight: 650; color: var(--cs-text-2); line-height: 18px; letter-spacing: 0.02em; }

.cs-batch-console { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.cs-brief-card, .cs-plan-card { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px; border: 1px solid var(--cs-border); border-radius: var(--cs-radius-lg); background: var(--cs-paper); box-shadow: 0 8px 24px color-mix(in srgb, #071326 7%, transparent); }
.cs-brief-card { background: linear-gradient(135deg, color-mix(in srgb, var(--cs-accent) 12%, var(--cs-paper)), var(--cs-paper) 62%); }
.cs-brief-head, .cs-plan-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.cs-brief-title, .cs-plan-title { margin: 4px 0 0; color: var(--cs-text); font-size: 19px; line-height: 27px; font-weight: 650; }
.cs-brief-step { flex: 0 0 auto; padding: 5px 9px; border: 1px solid var(--cs-border); border-radius: 999px; color: var(--cs-text-3); background: var(--cs-fill-2); font-size: 11px; }
.cs-brief-input { width: 100%; min-height: 88px; resize: vertical; padding: 12px 13px; border: 1px solid var(--cs-border-strong); border-radius: 11px; background: color-mix(in srgb, var(--cs-fill-2) 76%, transparent); color: var(--cs-text); font: inherit; font-size: 15px; line-height: 1.55; }
.cs-brief-input:focus { outline: none; border-color: var(--cs-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cs-accent) 18%, transparent); background: var(--cs-fill); }
.cs-brief-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.cs-assumption-list { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--cs-border); border-radius: 10px; background: var(--cs-fill-2); }
.cs-secondary-tool { border: 1px solid var(--cs-border); border-radius: var(--cs-radius-lg); background: color-mix(in srgb, var(--cs-paper) 82%, transparent); }
.cs-secondary-tool summary { padding: 13px 16px; cursor: pointer; color: var(--cs-text-2); font-size: 13px; font-weight: 600; }
.cs-secondary-tool > p { margin: 0 16px 12px; }
.cs-secondary-tool[open] { min-height: 0; overflow: hidden; }
.cs-secondary-tool > .cs-studio { height: min(660px, calc(100vh - 250px)); min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0 16px 16px; }
.cs-secondary-tool > .cs-studio > .cs-well { min-height: 360px; }

.cs-settings { gap: 16px; }
.cs-settings-overview { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 20px; border: 1px solid var(--cs-border); border-radius: var(--cs-radius-lg); background: linear-gradient(135deg, color-mix(in srgb, var(--cs-accent) 13%, var(--cs-paper)), var(--cs-paper) 58%); }
.cs-settings-overview-copy { min-width: 0; }
.cs-kicker { display: block; color: var(--cs-accent); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.cs-settings-title { margin: 4px 0 5px; color: var(--cs-text); font-size: 18px; line-height: 26px; font-weight: 650; }
.cs-runtime-status { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; padding: 8px 11px; border: 1px solid var(--cs-border); border-radius: 999px; color: var(--cs-text-2); background: color-mix(in srgb, var(--cs-fill-2) 82%, transparent); font-size: 12px; white-space: nowrap; }
.cs-runtime-status.is-ok { border-color: color-mix(in srgb, var(--cs-success) 45%, var(--cs-border)); }
.cs-runtime-status.is-bad { border-color: color-mix(in srgb, var(--cs-danger) 55%, var(--cs-border)); }
.cs-runtime-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--cs-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cs-success) 16%, transparent); }
.cs-runtime-status.is-bad .cs-runtime-dot { background: var(--cs-danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cs-danger) 16%, transparent); }
.cs-runtime-meta { color: var(--cs-text-3); }
.cs-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.cs-role-card { display: flex; min-width: 0; flex-direction: column; gap: 14px; padding: 16px; border: 1px solid var(--cs-border); border-radius: var(--cs-radius-lg); background: var(--cs-paper); box-shadow: 0 6px 20px color-mix(in srgb, #071326 6%, transparent); }
.cs-role-card.is-required { border-top: 2px solid color-mix(in srgb, var(--cs-accent) 62%, var(--cs-border)); }
.cs-role-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.cs-role-heading { min-width: 0; }
.cs-role-title-line { display: flex; align-items: center; gap: 8px; }
.cs-role-title { margin: 0; font-size: 16px; line-height: 22px; font-weight: 650; }
.cs-role-badge { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 999px; color: var(--cs-text-3); background: var(--cs-fill-2); font-size: 11px; }
.cs-role-badge.is-required { color: var(--cs-accent); background: color-mix(in srgb, var(--cs-accent) 12%, transparent); }
.cs-role-count { flex: 0 0 auto; color: var(--cs-text-3); font-size: 12px; }
.cs-role-empty { min-height: 48px; display: flex; align-items: center; padding: 10px 12px; border: 1px dashed var(--cs-border-strong); border-radius: 9px; color: var(--cs-text-3); font-size: 12px; line-height: 18px; }
.cs-role-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 2px; }
.cs-provider-list { display: flex; flex-direction: column; gap: 8px; }
.cs-provider-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 16px; min-width: 0; padding: 10px 11px; border: 1px solid var(--cs-border); border-radius: 10px; background: var(--cs-fill-2); }
.cs-provider-main { display: flex; align-items: center; gap: 9px; min-width: 0; }
.cs-provider-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cs-provider-title-line { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.cs-provider-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.cs-provider-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 999px; background: var(--cs-text-3); }
.cs-provider-dot.is-on { background: var(--cs-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cs-success) 14%, transparent); }
.cs-provider-actions { display: flex; align-items: center; gap: 5px; flex: 0 0 auto; flex-wrap: nowrap; justify-content: flex-end; }
.cs-provider-toggle { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 7px; border: 1px solid var(--cs-border); border-radius: 8px; color: var(--cs-text-3); font-size: 11px; cursor: pointer; white-space: nowrap; }
.cs-provider-toggle:has(input:checked) { color: var(--cs-success); border-color: color-mix(in srgb, var(--cs-success) 42%, var(--cs-border)); background: color-mix(in srgb, var(--cs-success) 8%, transparent); }
.cs-provider-toggle input { width: 14px; height: 14px; margin: 0; accent-color: var(--cs-success); }
.cs-icon-btn { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 1px solid var(--cs-border); border-radius: 8px; background: transparent; color: var(--cs-text-2); cursor: pointer; transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease; }
.cs-icon-btn svg { width: 16px; height: 16px; }
.cs-icon-btn:hover:not(:disabled) { color: var(--cs-accent); border-color: color-mix(in srgb, var(--cs-accent) 55%, var(--cs-border)); background: color-mix(in srgb, var(--cs-accent) 10%, transparent); transform: translateY(-1px); }
.cs-icon-btn.is-danger { color: var(--cs-danger); }
.cs-icon-btn.is-danger:hover:not(:disabled) { border-color: color-mix(in srgb, var(--cs-danger) 55%, var(--cs-border)); background: color-mix(in srgb, var(--cs-danger) 10%, transparent); }
.cs-config-backdrop { position: fixed; inset: 0; z-index: 1300; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgb(3 8 18 / 66%); backdrop-filter: blur(10px); }
.cs-config-editor { width: min(760px, calc(100vw - 48px)); max-height: min(88vh, 760px); display: flex; flex-direction: column; gap: 16px; overflow: auto; padding: 20px 22px 18px; border: 1px solid color-mix(in srgb, var(--cs-accent) 48%, var(--cs-border)); border-radius: 16px; background: var(--cs-paper); box-shadow: 0 24px 80px rgb(0 0 0 / 42%); }
.cs-config-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--cs-border); }
.cs-config-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border: 1px solid var(--cs-border); border-radius: 10px; background: var(--cs-fill-2); }
.cs-publish-targets { display: flex; flex-direction: column; gap: 8px; padding: 11px 12px; border: 1px solid var(--cs-border); border-radius: 10px; background: var(--cs-fill-2); }
.cs-publish-target-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.cs-publish-target-list { display: flex; flex-wrap: wrap; gap: 7px; }
.cs-config-mode { max-width: 420px; }
.cs-config-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; }
.cs-advanced { border-top: 1px solid var(--cs-border); padding-top: 12px; color: var(--cs-text-2); }
.cs-advanced summary { cursor: pointer; color: var(--cs-text-2); font-size: 12px; }
.cs-advanced p { margin: 8px 0 0; }
.cs-result-card { border-color: color-mix(in srgb, var(--cs-accent) 35%, var(--cs-border)); }
.cs-inline-result { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--cs-border); border-radius: 10px; background: var(--cs-fill-2); }
.cs-inline-result.is-ok { border-color: color-mix(in srgb, var(--cs-success) 42%, var(--cs-border)); }
.cs-inline-result.is-bad { border-color: color-mix(in srgb, var(--cs-danger) 48%, var(--cs-border)); }
.cs-inline-result-copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; color: var(--cs-text-2); font-size: 12px; line-height: 18px; }
.cs-inline-result-copy strong { color: var(--cs-text); font-size: 13px; }
.cs-result-toast { position: fixed; right: 24px; bottom: 24px; z-index: 1400; display: flex; align-items: flex-start; gap: 10px; width: min(360px, calc(100vw - 48px)); padding: 12px 14px; border: 1px solid var(--cs-border-strong); border-radius: 12px; background: var(--cs-paper); box-shadow: 0 18px 50px rgb(0 0 0 / 36%); }
.cs-result-toast.is-ok { border-color: color-mix(in srgb, var(--cs-success) 48%, var(--cs-border)); }
.cs-result-toast.is-bad { border-color: color-mix(in srgb, var(--cs-danger) 52%, var(--cs-border)); }

.cs-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 14px; border: 1px solid var(--cs-border); border-radius: 9px; background: var(--cs-fill); color: var(--cs-text); font-size: 13px; line-height: 18px; cursor: pointer; white-space: nowrap; transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease; }
.cs-btn:hover:not(:disabled) { background: var(--cs-hover); border-color: var(--cs-border-strong); transform: translateY(-1px); }
.cs-btn:focus-visible, .cs-tab:focus-visible, .cs-seg-btn:focus-visible { outline: 2px solid color-mix(in srgb, var(--cs-accent) 70%, transparent); outline-offset: 2px; }
.cs-btn-primary { background: var(--cs-accent); color: var(--cs-on-accent); border-color: var(--cs-accent); }
.cs-btn-primary:hover:not(:disabled) { background: var(--cs-accent-strong); border-color: var(--cs-accent-strong); }
.cs-btn-outline { border-color: color-mix(in srgb, var(--cs-accent) 55%, var(--cs-border)); background: transparent; color: var(--cs-accent); }
.cs-btn-outline:hover:not(:disabled) { background: color-mix(in srgb, var(--cs-accent) 12%, transparent); color: var(--cs-accent); }
.cs-btn-ghost { background: transparent; color: var(--cs-text-2); padding: 0; height: auto; border: 0; font-size: 13px; }
.cs-btn-ghost:hover:not(:disabled) { background: transparent; color: var(--cs-text); border-color: transparent; transform: none; }
.cs-btn-sm { height: 32px; padding: 0 12px; font-size: 13px; }
.cs-btn-danger { color: var(--cs-danger); }
.cs-btn-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--cs-danger) 8%, transparent); }

.cs-tag { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; }
.cs-tag-ok { background: color-mix(in srgb, var(--cs-success) 10%, transparent); color: var(--cs-success); }
.cs-tag-warn { background: color-mix(in srgb, var(--cs-warn) 12%, transparent); color: var(--cs-warn); }
.cs-tag-bad { background: color-mix(in srgb, var(--cs-danger) 10%, transparent); color: var(--cs-danger); }
.cs-tag-info { background: color-mix(in srgb, var(--cs-accent) 10%, transparent); color: var(--cs-accent); }
.cs-tag-neutral { background: var(--cs-fill-2); color: var(--cs-text-2); }
.cs-tag-outline { border: 0.5px solid var(--cs-border-strong); color: var(--cs-text-3); }

.cs-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.cs-label { font-size: 12px; line-height: 18px; color: var(--cs-text-2); }
.cs-hint { font-size: 12px; line-height: 18px; color: var(--cs-text-3); }
.cs-input, .cs-select, .cs-textarea { width: 100%; height: 36px; padding: 0 11px; border: 1px solid var(--cs-border); border-radius: 9px; background: var(--cs-fill-2); color: var(--cs-text); font: inherit; font-size: 13px; line-height: 20px; transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease; }
.cs-input:hover, .cs-select:hover, .cs-textarea:hover { border-color: var(--cs-border-strong); }
.cs-input:focus, .cs-select:focus, .cs-textarea:focus { outline: none; border-color: var(--cs-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cs-accent) 18%, transparent); background: var(--cs-fill); }
.cs-select { padding-right: 26px; }
.cs-textarea { height: auto; min-height: 72px; padding: 9px 11px; line-height: 1.5; resize: vertical; }
.cs-form-section { display: flex; flex-direction: column; gap: 10px; padding: 14px 0; border-top: 1px solid var(--cs-border); }
.cs-form-section:first-child { padding-top: 0; border-top: 0; }
.cs-form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px 16px; }
.cs-span-full { grid-column: 1 / -1; }
.cs-form-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--cs-border); }
.cs-form-actions .cs-hint { margin-left: auto; }
.cs-check { display: inline-flex; align-items: center; gap: 8px; height: 36px; font-size: 13px; cursor: pointer; }
.cs-check input { width: 16px; height: 16px; margin: 0; accent-color: var(--cs-accent); }

.cs-alert { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 0.5px solid; border-radius: var(--cs-radius); font-size: 12px; line-height: 18px; }
.cs-alert-warning { border-color: color-mix(in srgb, var(--cs-warn) 35%, transparent); background: color-mix(in srgb, var(--cs-warn) 8%, transparent); }
.cs-alert-danger { border-color: color-mix(in srgb, var(--cs-danger) 35%, transparent); background: color-mix(in srgb, var(--cs-danger) 8%, transparent); }
.cs-alert-success { border-color: color-mix(in srgb, var(--cs-success) 30%, transparent); background: color-mix(in srgb, var(--cs-success) 7%, transparent); }
.cs-alert-icon { flex: 0 0 16px; width: 16px; height: 16px; margin-top: 1px; color: var(--cs-warn); }
.cs-alert-danger .cs-alert-icon { color: var(--cs-danger); }
.cs-alert-success .cs-alert-icon { color: var(--cs-success); }
.cs-alert-body { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.cs-alert-title { font-size: 12px; line-height: 18px; font-weight: 600; }
.cs-alert-text { color: var(--cs-text-2); }
.cs-alert-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; }

.cs-list { display: flex; flex-direction: column; }
.cs-batch-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 10px 8px; border: 0; border-top: 0.5px solid var(--cs-border); border-radius: 0; background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; }
.cs-batch-row:first-child { border-top: 0; }
.cs-batch-row:hover { background: var(--cs-hover); }
.cs-batch-row.is-selected { background: var(--cs-fill-2); }
.cs-row-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.cs-row-title { font-size: 12px; font-weight: 600; }
.cs-row-meta { font-size: 12px; color: var(--cs-text-3); white-space: nowrap; }
.cs-empty { padding: 8px 0; text-align: left; color: var(--cs-text-3); font-size: 13px; line-height: 20px; }

.cs-detail { display: flex; flex-direction: column; gap: 14px; }
.cs-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.cs-detail-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--cs-text-3); font-size: 12px; }
.cs-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cs-item-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.cs-item { border: 0.5px solid var(--cs-border); border-radius: var(--cs-radius-lg); padding: 12px; display: flex; flex-direction: column; gap: 8px; background: var(--cs-fill); }
.cs-item-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cs-item-title { font-size: 12px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cs-item-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cs-item-error { color: var(--cs-danger); font-size: 12px; line-height: 18px; }

.cs-progress { height: 4px; border-radius: 999px; background: var(--cs-fill-3); overflow: hidden; }
.cs-progress > span { display: block; height: 100%; border-radius: inherit; }
.cs-cost { display: flex; flex-direction: column; gap: 6px; }
.cs-cost-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--cs-text-2); }

.cs-review { display: flex; flex: 0 0 auto; flex-direction: column; min-height: fit-content; border: 1px solid var(--cs-border); border-radius: var(--cs-radius-lg); background: var(--cs-fill); overflow: hidden; }
.cs-review-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--cs-border); }
.cs-review-desk { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); min-height: 0; align-items: stretch; }
.cs-review-stage { display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--cs-media-bg); min-height: 360px; }
.cs-review-phone { width: min(100%, 260px); height: min(58vh, 520px); aspect-ratio: 9 / 16; display: flex; align-items: center; background: var(--cs-media-bg); border-radius: 10px; overflow: hidden; }
.cs-review-phone video { width: 100%; height: 100%; max-height: none; display: block; background: var(--cs-media-bg); object-fit: contain; }
.cs-review-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; padding: 16px; border-left: 1px solid var(--cs-border); }
.cs-cover-strip { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
.cs-cover-thumb { padding: 0; border: 1px solid var(--cs-border-strong); border-radius: 8px; background: var(--cs-media-bg); cursor: pointer; overflow: hidden; line-height: 0; }
.cs-cover-thumb:hover { box-shadow: inset 0 0 0 1px var(--cs-ink); }
.cs-cover-thumb img { display: block; height: 88px; width: auto; object-fit: cover; }
.cs-cover-thumb.is-wide img { height: 52px; }
.cs-cover-thumb.is-sq img { width: 52px; height: 52px; }
.cs-review-decide { display: flex; flex: 0 0 auto; flex-direction: column; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--cs-border); background: var(--cs-fill); }
.cs-preview-box.is-cover { width: auto; max-width: 92vw; }
.cs-preview-box.is-cover img { display: block; max-width: 92vw; max-height: 82vh; background: #000; }
.cs-pre { margin: 0; padding: 10px; border-radius: var(--cs-radius); border: 0.5px solid var(--cs-border); max-height: 220px; overflow: auto; font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; background: var(--cs-fill-2); }
.cs-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.cs-muted { color: var(--cs-text-3); font-size: 12px; line-height: 18px; }
.cs-divider { height: 0.5px; background: var(--cs-border); border: 0; }
.cs-table { width: 100%; border-collapse: collapse; }
.cs-table th, .cs-table td { text-align: left; padding: 8px 0; border-top: 0.5px solid var(--cs-border); font-size: 12px; }
.cs-table th { border-top: 0; color: var(--cs-text-3); font-weight: 500; }
.cs-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; flex: 0 0 6px; }

.cs-modal-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgb(3 8 18 / 58%); backdrop-filter: blur(8px); }
.cs-modal { width: min(640px, 100%); max-height: 80vh; display: flex; flex-direction: column; gap: 12px; padding: 18px; border: 1px solid var(--cs-border-strong); border-radius: var(--cs-radius-lg); background: var(--cs-paper); color: var(--cs-text); box-shadow: 0 20px 60px rgb(0 0 0 / 32%); }
.cs-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.cs-crumbs { display: flex; flex-wrap: wrap; gap: 6px; }
.cs-dir-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cs-text-2); }
.cs-dir-list { display: flex; flex-direction: column; max-height: 45vh; overflow: auto; border-top: 0.5px solid var(--cs-border); }
.cs-dir-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 4px; border: 0; border-bottom: 0.5px solid var(--cs-border); background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; }
.cs-dir-row:hover { background: var(--cs-hover); }
.cs-dir-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cs-dir-enter { color: var(--cs-text-3); }
.cs-modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 0.5px solid var(--cs-border); }
@media (max-width: 820px) {
  .cs-chrome, .cs-body { padding-left: 16px; padding-right: 16px; }
  .cs-chrome { align-items: flex-start; flex-wrap: wrap; gap: 12px 16px; }
  .cs-title { font-size: 26px; }
  .cs-tabs { position: static; left: auto; transform: none; order: 3; width: 100%; max-width: 100%; overflow-x: auto; justify-content: center; }
  .cs-tab { flex: 0 0 78px; }
  .cs-page-inner { padding: 0; }
  .cs-review-desk, .cs-lanes { grid-template-columns: 1fr; }
  .cs-review-side { border-left: 0; border-top: 0.5px solid var(--cs-border); }
  .cs-review-phone { width: min(100%, 260px); height: 42vh; max-height: 460px; }
  .cs-review-phone video { max-height: none; }
  .cs-intake { grid-template-columns: 1fr 1fr; }
  .cs-lane + .cs-lane { border-left: 0; border-top: 0.5px solid var(--cs-border); }
  .cs-stats { flex-wrap: wrap; }
  .cs-stat { flex: 1 1 40%; border-left: 0; border-top: 0.5px solid var(--cs-border); }
  .cs-stat:nth-child(-n+2) { border-top: 0; }
  .cs-stat:nth-child(even) { border-left: 0.5px solid var(--cs-border); }
  .cs-gates, .cs-gates.is-wide, .cs-gates.is-square { grid-template-columns: repeat(2, minmax(100px, 150px)); }
  .cs-dock-row { align-items: stretch; }
  .cs-go { margin-left: 0; width: 100%; }
  .cs-prompt-bar { align-items: flex-start; }
  .cs-settings-overview { align-items: flex-start; flex-direction: column; }
  .cs-brief-head, .cs-plan-head { flex-direction: column; }
  .cs-brief-card, .cs-plan-card { padding: 16px; }
  .cs-settings-grid { grid-template-columns: 1fr; }
  .cs-provider-row { grid-template-columns: 1fr; align-items: flex-start; }
  .cs-provider-actions { width: 100%; justify-content: flex-start; flex-wrap: wrap; }
  .cs-config-backdrop { padding: 12px; }
  .cs-config-editor { width: 100%; max-height: 92vh; padding: 16px; border-radius: 14px; }
  .cs-config-grid { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .cs-gates, .cs-gates.is-wide, .cs-gates.is-square { grid-template-columns: repeat(2, minmax(88px, 1fr)); gap: 8px; }
  .cs-well { padding: 10px; }
  .cs-dock { padding: 10px; }
  .cs-seg { width: 100%; }
  .cs-seg-btn { flex: 1; padding: 0 8px; }
}
`

    function ensureStyles() {
      if (typeof document === 'undefined') return
      let style = document.getElementById('content-studio-styles')
      if (!style) {
        style = document.createElement('style')
        style.id = 'content-studio-styles'
        document.head.appendChild(style)
      }
      if (style.textContent !== CSS) style.textContent = CSS
    }

    const ITEM_STATUS_ZH = {
      pending: '待处理', running: '生成中', review_pending: '待审核', approved: '已通过',
      rejected: '已驳回', failed: '失败', cancelled: '已取消',
    }
    const STATUS_TONE = {
      review_pending: 'warn', approved: 'ok', failed: 'bad', rejected: 'bad', running: '', pending: '', cancelled: '',
    }
    const BATCH_STATUS_ZH = {
      draft: '草稿', queued: '排队', running: '运行中', paused: '已暂停', review: '待审核',
      done: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消',
    }
    const BATCH_STATUS_TONE = {
      running: '', paused: 'warn', review: 'warn', done: 'ok', failed: 'bad', partial: 'warn',
    }
    const REVIEW_MODE_ZH = { required: '需人工审核', auto: '自动放行' }
    const PAUSE_REASON_ZH = { user: '手动暂停', cost_cap: '成本达到上限' }
    const STEP_ZH = {
      script: '文案', voice: '配音', subtitle: '字幕', visual: '画面',
      plan: '剪辑方案', render: '渲染', cover: '封面', validate: '校验',
    }
    const REVIEW_REASONS = ['文案质量', '画面质量', '封面问题', '配音问题', '字幕错误', '时长不符', '其他']

    /* ------------------------------------------------------------------ */
    /* api                                                                 */
    /* ------------------------------------------------------------------ */
    async function api(method, path, body) {
      const res = await fetch(API + path, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let data
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = { raw: text }
      }
      if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`)
      return data
    }

    function Badge({ tone, children }) {
      const kind = tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : tone === 'bad' ? 'bad' : tone === 'info' ? 'info' : 'neutral'
      return h('span', { className: `cs-tag cs-tag-${kind}` }, children)
    }

    function platformLabel(platforms, id) {
      return (platforms || []).find((platform) => platform.id === id)?.label || id || '—'
    }

    function toLocalDateTime(value) {
      if (!value) return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (number) => String(number).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    async function downloadZip(path, filename) {
      const res = await fetch(API + path)
      if (!res.ok) {
        const text = await res.text()
        let message = `${res.status} ${res.statusText}`
        try { message = JSON.parse(text).error || message } catch { /* keep status text */ }
        throw new Error(message)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }

    /* ------------------------------------------------------------------ */
    /* 批次                                                            */
    /* ------------------------------------------------------------------ */
    function NewBatchForm({ onCreated, groups, health, services, platforms = [], initial = null, onPickDirectory = null, autoStart = false }) {
      const [form, setForm] = useState(() => ({
        title: '', topic: '', count: 5, dirs: '', group: '', targetSec: 26,
        aspectRatio: '9:16', materialMode: 'folder', shotCount: 8, voice: '', transition: 'cut', concurrency: '',
        platform: 'douyin', publishStartAt: '', publishIntervalMinutes: 1440, reviewMode: 'required', costCap: '',
        publishEnabled: false, publishTargetIds: [],
        ...(initial ? {
          topic: initial.topic || '',
          count: initial.count || 5,
          platform: initial.platform || 'douyin',
          targetSec: initial.targetSec || 26,
          aspectRatio: initial.aspectRatio || '9:16',
          materialMode: initial.materialMode || 'pool',
          shotCount: initial.shotCount || 8,
          reviewMode: initial.reviewMode === 'auto' ? 'auto' : 'required',
          publishStartAt: toLocalDateTime(initial.publishStartAt),
          publishIntervalMinutes: initial.publishIntervalMinutes ?? 1440,
          costCap: initial.costCap ? String(initial.costCap) : '',
          publishEnabled: Boolean(initial.publish?.enabled),
          publishTargetIds: initial.publish?.targetIntegrationIds || [],
          dirs: initial.dirs || '',
        } : {}),
      }))
      const [busy, setBusy] = useState('')
      const [message, setMessage] = useState(null)
      const [scanned, setScanned] = useState(null)
      const [publishChannels, setPublishChannels] = useState([])

      useEffect(() => {
        api('GET', '/postiz/channels').then((data) => setPublishChannels(data.channels || [])).catch(() => setPublishChannels([]))
      }, [])

      const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
      const platformPreset = useMemo(
        () => (platforms || []).find((platform) => platform.id === form.platform),
        [platforms, form.platform],
      )
      const changePlatform = (event) => {
        const id = event.target.value
        const preset = (platforms || []).find((platform) => platform.id === id)
        setForm((current) => ({
          ...current,
          platform: id,
          aspectRatio: preset?.aspectRatio || current.aspectRatio,
          targetSec: preset?.targetSec || current.targetSec,
        }))
      }

      const dirList = useMemo(
        () => form.dirs.split(/[\n;,]/).map((s) => s.trim()).filter(Boolean),
        [form.dirs],
      )

      const scan = async () => {
        setBusy('scan')
        setMessage(null)
        try {
          const result = await api('POST', '/materials/scan', { dirs: dirList })
          setScanned(result)
          setMessage({ ok: true, text: `扫描完成：${result.total} 个素材，${result.invalid.length} 个无效` })
        } catch (error) {
          setMessage({ ok: false, text: error.message })
        } finally {
          setBusy('')
        }
      }

      const create = async () => {
        setBusy('create')
        setMessage(null)
        try {
          const config = {
            topic: form.topic || form.title,
            style: '',
            platform: form.platform,
            targetSec: Number(form.targetSec) || 26,
            aspectRatio: form.aspectRatio,
            materialMode: form.materialMode,
            group: form.group || undefined,
            shotCount: Number(form.shotCount) || 8,
            voice: form.voice || undefined,
            transition: form.transition,
            concurrency: Number(form.concurrency) > 0 ? Number(form.concurrency) : undefined,
            publishStartAt: form.publishStartAt || null,
            publishIntervalMinutes: Number(form.publishIntervalMinutes) || 0,
            reviewMode: form.reviewMode,
            costCap: Number(form.costCap) > 0 ? Number(form.costCap) : null,
            materialsDirs: dirList,
            publish: {
              enabled: Boolean(form.publishEnabled && form.publishTargetIds.length > 0),
              mode: 'scheduled',
              policy: 'after_approval',
              targetIntegrationIds: form.publishTargetIds,
            },
          }
          const preflight = await api('POST', '/batches/preflight', { count: Number(form.count) || 1, config })
          const result = await api('POST', '/batches', { title: form.title || form.topic, count: Number(form.count) || 1, config })
          if (autoStart) {
            try {
              await api('POST', `/batches/${encodeURIComponent(result.batch.id)}/start`)
            } catch (startError) {
              setMessage({ ok: false, text: `批次已创建，但启动失败：${startError.message}` })
              onCreated?.(result.batch)
              return
            }
          }
          const warnings = [...new Set([...(preflight.preflight?.warnings || []), ...(result.preflight?.warnings || [])])]
          setMessage({
            ok: true,
            text: warnings.length > 0
              ? `${autoStart ? '批次已创建并开始生产' : '批次已创建'}：${result.batch.id} —— 注意：${warnings.join('；')}`
              : `${autoStart ? '批次已创建并开始生产' : '批次已创建'}：${result.batch.id}`,
            warnings,
          })
          onCreated?.(result.batch)
        } catch (error) {
          setMessage({ ok: false, text: error.message })
        } finally {
          setBusy('')
        }
      }

      const ready = (form.topic || form.title) && Number(form.count) > 0
      const field = (label, control, extra = '') =>
        h('label', { className: `cs-field ${extra}` },
          h('span', { className: 'cs-label' }, label),
          control,
        )

      return h('div', { className: 'cs-form' },
        h('div', { className: 'cs-form-section' },
          h('h3', { className: 'cs-section-title' }, '内容规格'),
          h('div', { className: 'cs-form-grid' },
            field('主题', h('input', {
              className: 'cs-input', placeholder: '例如：48V 工商业储能 BMS 的核心优势',
              value: form.topic, onChange: set('topic'),
            }), 'cs-span-full'),
            field('数量', h('input', {
              className: 'cs-input', type: 'number', min: 1, max: 200,
              value: form.count, onChange: set('count'),
            })),
            field('平台', h('select', { className: 'cs-select', value: form.platform, onChange: changePlatform },
              (platforms.length > 0 ? platforms : [{ id: 'douyin', label: '抖音' }]).map((platform) =>
                h('option', { key: platform.id, value: platform.id }, platform.label)))),
            field('目标时长（秒）', h('input', {
              className: 'cs-input', type: 'number', min: 3,
              value: form.targetSec, onChange: set('targetSec'),
            })),
            field('画幅', h('select', { className: 'cs-select', value: form.aspectRatio, onChange: set('aspectRatio') },
              ['9:16', '16:9', '1:1', '4:5'].map((value) => h('option', { key: value, value }, value)))),
            field('取材方式', h('select', { className: 'cs-select', value: form.materialMode, onChange: set('materialMode') },
              h('option', { value: 'folder' }, '按分类取材'),
              h('option', { value: 'pool' }, '全库混剪'))),
            field('分类', h('select', { className: 'cs-select', value: form.group, onChange: set('group') },
              h('option', { value: '' }, '自动'),
              (groups || []).map((group) => h('option', { key: group.group, value: group.group }, `${group.group} (${group.count})`)))),
            field('转场', h('select', { className: 'cs-select', value: form.transition, onChange: set('transition') },
              h('option', { value: 'cut' }, '硬切'),
              h('option', { value: 'fade' }, '淡入淡出'))),
            field('音色', h('input', {
              className: 'cs-input', placeholder: '留空使用默认音色',
              value: form.voice, onChange: set('voice'),
            })),
            field('单条镜头数', h('input', {
              className: 'cs-input', type: 'number', min: 1, max: 20,
              value: form.shotCount, onChange: set('shotCount'),
            })),
            field('并发', h('input', {
              className: 'cs-input', type: 'number', min: 1, max: 8, placeholder: '默认 2',
              value: form.concurrency, onChange: set('concurrency'),
            })),
          ),
        ),
        h('div', { className: 'cs-form-section' },
          h('h3', { className: 'cs-section-title' }, '发布设置'),
          h('div', { className: 'cs-form-grid' },
            field('发布起点', h('input', {
              className: 'cs-input', type: 'datetime-local',
              value: form.publishStartAt, onChange: set('publishStartAt'),
            })),
            field('发布间隔（分钟）', h('input', {
              className: 'cs-input', type: 'number', min: 0,
              value: form.publishIntervalMinutes, onChange: set('publishIntervalMinutes'),
            })),
            field('审核模式', h('select', { className: 'cs-select', value: form.reviewMode, onChange: set('reviewMode') },
              h('option', { value: 'required' }, '需人工审核'),
              h('option', { value: 'auto' }, '自动放行'))),
            field('成本上限（¥）', h('input', {
              className: 'cs-input', type: 'number', min: 0, step: '0.01', placeholder: '不设上限',
              value: form.costCap, onChange: set('costCap'),
            })),
            h('div', { className: 'cs-publish-targets cs-span-full' },
              h('div', { className: 'cs-publish-target-head' },
                h('span', { className: 'cs-label' }, '审核通过后自动发布'),
                h('label', { className: 'cs-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: form.publishEnabled,
                    onChange: (event) => setForm((current) => ({ ...current, publishEnabled: event.target.checked })),
                  }),
                  '启用',
                ),
              ),
              h('div', { className: 'cs-publish-target-list' },
                publishChannels.length > 0
                  ? publishChannels.map((channel) => h('button', {
                      key: channel.id,
                      type: 'button',
                      className: `cs-chip${form.publishTargetIds.includes(channel.id) ? ' is-active' : ''}`,
                      onClick: () => setForm((current) => ({
                        ...current,
                        publishTargetIds: current.publishTargetIds.includes(channel.id)
                          ? current.publishTargetIds.filter((id) => id !== channel.id)
                          : [...current.publishTargetIds, channel.id],
                      })),
                    }, `${channel.name} · ${channel.identifier}`))
                  : h('span', { className: 'cs-hint' }, '未发现 Postiz 账号；可先在“待分发”页配置，或留空改为手动发布。'),
              ),
              h('span', { className: 'cs-hint' }, '校验通过并审核后按发布起点和间隔自动分发；不选账号则只生成待发布内容。'),
            ),
            platformPreset
              ? h('p', { className: 'cs-hint cs-span-full' }, `平台标题上限 ${platformPreset.titleMaxLength} 字，仅提示，不阻断。`)
              : null,
          ),
        ),
        h('div', { className: 'cs-form-section' },
          h('h3', { className: 'cs-section-title' }, '素材'),
          h('div', { className: 'cs-form-grid' },
            field('素材目录', h('textarea', {
              className: 'cs-textarea cs-span-full',
              placeholder: '一行一个目录，例如 D:\\素材\\BMS工厂视频',
              value: form.dirs, onChange: set('dirs'),
            }), 'cs-span-full'),
          ),
          h('div', { className: 'cs-actions' },
            h('button', {
              className: 'cs-btn cs-btn-outline',
              onClick: scan,
              disabled: busy === 'scan' || dirList.length === 0,
            }, busy === 'scan' ? '扫描中…' : '扫描素材'),
            h('button', {
              className: 'cs-btn cs-btn-ghost',
              disabled: !onPickDirectory && !services?.pickDirectory,
              title: onPickDirectory || services?.pickDirectory ? '打开目录选择器' : '当前环境不支持目录选择',
              onClick: () => {
                const append = (picked) => {
                  if (!picked) return
                  setForm((current) => ({
                    ...current,
                    dirs: current.dirs.trim() ? `${current.dirs.trim()}\n${picked}` : picked,
                  }))
                }
                if (onPickDirectory) {
                  onPickDirectory(append)
                  return
                }
                services.pickDirectory().then(append).catch((pickError) => {
                  setMessage({ ok: false, text: `选择目录失败：${pickError.message}` })
                })
              },
            }, '选择目录'),
            scanned
              ? h('span', { className: 'cs-hint' }, `索引 ${scanned.total} 个 · ${scanned.groups.map((group) => `${group.group}:${group.count}`).join(' / ')}`)
              : null,
          ),
        ),
        h('div', { className: 'cs-form-actions' },
          h('button', {
            className: 'cs-btn cs-btn-primary',
            onClick: create,
            disabled: busy === 'create' || !ready,
          }, busy === 'create' ? (autoStart ? '创建并启动中…' : '创建中…') : (autoStart ? '创建并开始' : '创建批次')),
          h('span', { className: 'cs-hint' }, ready ? (autoStart ? '确认后立即下发到生产队列' : '创建后可在审核页启动') : '主题和数量必填'),
        ),
        message
          ? h('div', {
              className: `cs-alert ${message.ok ? (message.warnings?.length ? 'cs-alert-warning' : 'cs-alert-success') : 'cs-alert-danger'}`,
              role: 'status',
            },
              h('div', { className: 'cs-alert-body' },
                h('p', { className: 'cs-alert-text' }, message.text),
              ),
            )
          : null,
      )
    }

    function BatchConsole({ groups = [], health, services, platforms = [], readiness, onCreated }) {
      const [brief, setBrief] = useState('')
      const [parsed, setParsed] = useState(null)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')

      const parse = async () => {
        const text = brief.trim()
        if (!text) {
          setError('先写一句生产需求')
          return
        }
        setBusy('parse')
        setError('')
        setNotice('')
        try {
          const result = await api('POST', '/batches/parse', { brief: text })
          setParsed(result)
        } catch (parseError) {
          setError(parseError.message)
        } finally {
          setBusy('')
        }
      }

      const clearPlan = () => {
        setParsed(null)
        setNotice('')
        setError('')
      }

      const initial = parsed
        ? { ...(parsed.config || {}), count: parsed.count || 1, topic: parsed.config?.topic || '' }
        : null

      return h('div', { className: 'cs-batch-console' },
        h('section', { className: 'cs-brief-card' },
          h('div', { className: 'cs-brief-head' },
            h('div', null,
              h('span', { className: 'cs-kicker' }, '批量生产'),
              h('h2', { className: 'cs-brief-title' }, '先说需求，AI 帮你拆成批次'),
              h('p', { className: 'cs-muted' }, '例如：做 5 条面向海外 B2B 客户的储能 BMS 宣传视频，发 TikTok 和 LinkedIn，每天 18:00 一条。'),
            ),
            h('span', { className: 'cs-brief-step' }, parsed ? '02 / 确认计划' : '01 / 描述需求'),
          ),
          h('textarea', {
            className: 'cs-brief-input',
            id: 'batch-brief',
            rows: 3,
            value: brief,
            placeholder: '描述主题、条数、平台、发布时间和预算。没说的内容会标注默认值。',
            onChange: (event) => setBrief(event.target.value),
          }),
          h('div', { className: 'cs-brief-actions' },
            h('span', { className: 'cs-hint' }, '支持 TikTok、Instagram、YouTube、LinkedIn 及国内平台；也可以先写主题，再在计划里细调。'),
            h('button', {
              className: 'cs-btn cs-btn-primary',
              disabled: busy === 'parse' || !brief.trim(),
              onClick: parse,
            }, busy === 'parse' ? '拆解中…' : '让 AI 拆解'),
          ),
          error
            ? h('div', { className: 'cs-alert cs-alert-danger', role: 'alert' },
                h(AlertIcon),
                h('div', { className: 'cs-alert-body' }, h('p', { className: 'cs-alert-text' }, error)),
              )
            : null,
        ),
        parsed
          ? h('section', { className: 'cs-plan-card' },
              h('div', { className: 'cs-plan-head' },
                h('div', null,
                  h('span', { className: 'cs-kicker' }, parsed.source === 'llm' ? 'AI 计划' : '本地规则计划'),
                  h('h2', { className: 'cs-plan-title' }, parsed.plan?.summary || `准备生产 ${parsed.count || 1} 条内容`),
                ),
                h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: clearPlan }, '重新描述'),
              ),
              (parsed.plan?.warnings || []).length > 0
                ? h('div', { className: 'cs-alert cs-alert-warning', role: 'status' },
                    h(AlertIcon),
                    h('div', { className: 'cs-alert-body' },
                      (parsed.plan.warnings || []).map((warning) => h('p', { key: warning, className: 'cs-alert-text' }, warning)),
                    ),
                  )
                : null,
              (parsed.plan?.assumptions || []).length > 0
                ? h('div', { className: 'cs-assumption-list' },
                    h('span', { className: 'cs-label' }, '需要确认的默认值'),
                    h('div', { className: 'cs-plan-facts' },
                      parsed.plan.assumptions.map((assumption) => h('span', { key: assumption, className: 'cs-plan-fact' }, assumption)),
                    ),
                  )
                : null,
              h(NewBatchForm, {
                groups,
                health,
                services,
                platforms,
                initial,
                autoStart: true,
                onCreated: (batch) => {
                  setNotice(`批次 ${batch.id} 已创建并开始生产`)
                  onCreated?.(batch)
                },
              }),
              notice
                ? h('div', { className: 'cs-alert cs-alert-success', role: 'status' },
                    h('div', { className: 'cs-alert-body' }, h('p', { className: 'cs-alert-text' }, notice)),
                  )
                : null,
            )
          : null,
        h('details', { className: 'cs-secondary-tool' },
          h('summary', null, '视频模型试验台（单次生成，可选）'),
          h('p', { className: 'cs-hint' }, '这是一次性“提示词 → 异步生成镜头 → 选择镜头成片”，不是持续聊天；批量 BMS 运营请使用上方总控台。'),
          h(CreateComposer, { readiness, onCreated }),
        ),
      )
    }

    const ROLE_ZH = { llm: '文案模型', tts: '配音模型', video: '视频模型', image: '生图模型' }

    /** 首次使用的就绪检查：缺什么、点哪里，直接说清楚。 */
    function AlertIcon() {
      return h('svg', {
        className: 'cs-alert-icon', viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('circle', { cx: 8, cy: 8, r: 6.4 }),
        h('path', { d: 'M8 4.8v4.4' }),
        h('path', { d: 'M8 11.6h.01' }),
      )
    }

    function Readiness({ health, onConfigure, onInstallFfmpeg, installing = false, installError = '' }) {
      if (!health) return null
      const ffmpegMissing = !health.ffmpeg?.ok
      const roles = new Set((health.providers || []).filter((p) => p.enabled).map((p) => p.role))
      const missingVideo = !roles.has('video')
      const missingFinish = ['llm', 'tts'].filter((role) => !roles.has(role))
      if (!ffmpegMissing && !missingVideo && missingFinish.length === 0) return null

      const summary = [
        ffmpegMissing ? 'ffmpeg 未就绪' : null,
        missingVideo ? '缺少视频模型' : null,
        !missingVideo && missingFinish.length > 0 ? `成片还缺${missingFinish.map((role) => ROLE_ZH[role]).join('、')}` : null,
      ].filter(Boolean).join('；')

      return h('div', { className: 'cs-statusline', role: 'status' },
        h('span', null, summary),
        ffmpegMissing
          ? h('button', {
              className: 'cs-btn cs-btn-sm cs-btn-outline',
              disabled: installing,
              onClick: onInstallFfmpeg,
            }, installing ? '安装中…' : '安装 ffmpeg')
          : null,
        missingVideo || missingFinish.length > 0
          ? h('button', { className: 'cs-btn cs-btn-sm cs-btn-ghost', onClick: onConfigure }, '配置模型')
          : null,
        installError ? h('span', { style: { color: 'var(--cs-danger)' } }, installError) : null,
      )
    }

    function StepStrip({ steps }) {
      return h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
        Object.entries(STEP_ZH).map(([key, label]) => {
          const status = steps?.[key]?.status || 'pending'
          const tone = status === 'done' ? 'ok' : status === 'running' ? 'warn' : status === 'failed' ? 'bad' : 'neutral'
          return h('span', {
            key,
            className: `cs-tag cs-tag-${tone}`,
            style: { opacity: status === 'pending' ? 0.38 : 1 },
          }, label)
        }),
      )
    }

    function UsageLine({ totals }) {
      if (!totals || !totals.usage) return null
      const usage = totals.usage
      const parts = []
      if (usage.llmTokens) parts.push(`文案 ${usage.llmTokens} token`)
      if (usage.ttsCharacters) parts.push(`配音 ${usage.ttsCharacters} 字 / ${Number(usage.ttsSeconds || 0).toFixed(1)}s`)
      if (usage.videoSeconds) parts.push(`生成 ${Number(usage.videoSeconds).toFixed(1)}s × ${usage.videoShots || 0} 镜`)
      if (usage.imageCount) parts.push(`生图 ${usage.imageCount} 张`)
      if (parts.length === 0) return null
      const price = totals.cost && totals.cost.priced ? `≈ ${totals.cost.currency} ${totals.cost.total.toFixed(2)}` : '未配置价目表'
      return h('div', { className: 'cs-muted' }, `用量：${parts.join(' · ')} —— ${price}`)
    }

    function CostBar({ totals }) {
      if (!totals || !totals.costCap) return null
      const spent = Number(totals.cost?.total) || 0
      const pct = Math.min(100, Math.round((totals.capRatio || 0) * 100))
      const tone = totals.capReached ? 'var(--cs-danger)' : totals.capWarning ? 'var(--cs-warn)' : 'var(--cs-text-2)'
      return h('div', { className: 'cs-cost' },
        h('div', { className: 'cs-cost-head' },
          h('span', null, `成本上限 ¥${totals.costCap.toFixed(2)}`),
          h('span', { style: { color: tone } },
            totals.cost?.priced ? `已用 ¥${spent.toFixed(2)} · ${pct}%` : '未配置价目表，成本仍为 0')),
        h('div', { className: 'cs-progress' },
          h('span', { style: { width: `${Math.min(100, pct)}%`, background: tone } })),
        totals.capReached
          ? h('div', { className: 'cs-hint', style: { color: 'var(--cs-danger)' } }, '已达到成本上限，队列会暂停，等人工提高上限后继续')
          : totals.capWarning
            ? h('div', { className: 'cs-hint', style: { color: 'var(--cs-warn)' } }, '已使用 80% 以上')
            : null,
      )
    }

    function LogViewer({ batchId, onError }) {
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const load = useCallback(async () => {
        setBusy(true)
        try {
          setData(await api('GET', `/batches/${batchId}/log`))
        } catch (error) {
          onError?.(error.message)
        } finally {
          setBusy(false)
        }
      }, [batchId, onError])
      useEffect(() => { load() }, [load])
      if (!data) return h('div', { className: 'cs-muted' }, busy ? '读取日志…' : '')
      return h('div', { className: 'cs-card' },
        h('div', { className: 'cs-card-head' },
          h('h3', { className: 'cs-card-title' }, '生产日志'),
          h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: load }, busy ? '刷新中…' : '刷新'),
        ),
        h('div', { className: 'cs-muted' }, '批次日志'),
        h('pre', { className: 'cs-pre' }, data.batch || '（空）'),
        (data.items || []).map((item) => h('details', { key: item.id, style: { marginTop: 8 } },
          h('summary', { className: 'cs-muted', style: { cursor: 'pointer' } }, `${String(item.seq || '').padStart(2, '0')} ${item.id}`),
          h('pre', { className: 'cs-pre' }, item.log || '（空）'),
        )),
      )
    }

    function BatchDetail({ batchId, onOpenReview, refreshKey, onDeleted, platforms = [] }) {
      const [detail, setDetail] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')
      const [showLog, setShowLog] = useState(false)
      const [exporting, setExporting] = useState('')

      const load = useCallback(async () => {
        try {
          setDetail(await api('GET', `/batches/${batchId}`))
          setError('')
        } catch (e) {
          setError(e.message)
        }
      }, [batchId])

      useEffect(() => { load() }, [load, refreshKey])

      const act = async (label, path) => {
        setBusy(path)
        try {
          await api('POST', path)
          await load()
        } catch (e) {
          setError(e.message)
        } finally {
          setBusy('')
        }
      }

      const approveAll = async () => {
        const pending = (detail?.batch?.items || []).filter((item) => item.status === 'review_pending')
        if (pending.length === 0) return
        setBusy('approve-all')
        const failed = []
        for (const item of pending) {
          try {
            await api('POST', `/items/${item.id}/approve`, { note: '批量通过' })
          } catch (e) {
            failed.push(`${item.seq}: ${e.message}`)
          }
        }
        await load()
        setBusy('')
        if (failed.length > 0) setError(`部分通过失败：${failed.join('；')}`)
      }

      const exportBatch = async () => {
        setExporting('batch')
        setError('')
        try {
          await downloadZip(`/batches/${batchId}/export`, `content-studio-${batchId}.zip`)
        } catch (e) {
          setError(e.message)
        } finally {
          setExporting('')
        }
      }

      const exportItem = async (item) => {
        setExporting(item.id)
        setError('')
        try {
          await downloadZip(`/items/${item.id}/export`, `content-studio-item-${String(item.seq).padStart(3, '0')}.zip`)
        } catch (e) {
          setError(e.message)
        } finally {
          setExporting('')
        }
      }

      if (error) return h('div', { className: 'cs-card' }, h('p', { className: 'cs-alert-text' }, `读取失败：${error}`))
      if (!detail) return h('div', { className: 'cs-muted' }, '读取中…')

      const { batch } = detail
      const counts = batch.items.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1
        return acc
      }, {})
      const hasReview = batch.items.some((item) => item.status === 'review_pending')
      const canStart = ['draft', 'partial', 'failed'].includes(batch.status) || batch.items.some((item) => item.status === 'pending')

      return h('section', { className: 'cs-detail' },
        h('div', { className: 'cs-detail-head' },
          h('div', { className: 'cs-row-main' },
            h('h2', { className: 'cs-card-title' }, batch.title),
            h(Badge, { tone: BATCH_STATUS_TONE[batch.status] || '' }, BATCH_STATUS_ZH[batch.status] || batch.status),
            h('span', { className: 'cs-row-meta' }, platformLabel(platforms, batch.config?.platform)),
            h('span', { className: 'cs-row-meta' }, REVIEW_MODE_ZH[batch.config?.reviewMode] || '需人工审核'),
            h('span', { className: 'cs-row-meta' }, `${batch.items.length} 条`),
            Object.entries(counts).map(([status, count]) =>
              h('span', { key: status, className: 'cs-row-meta' }, `${ITEM_STATUS_ZH[status] || status} ${count}`)),
          ),
          h('div', { className: 'cs-actions' },
            h('button', {
              className: 'cs-btn cs-btn-outline cs-btn-sm',
              disabled: exporting === 'batch',
              onClick: exportBatch,
            }, exporting === 'batch' ? '导出中…' : '导出整批'),
            h('button', {
              className: 'cs-btn cs-btn-ghost cs-btn-sm',
              onClick: () => setShowLog((open) => !open),
            }, showLog ? '收起日志' : '生产日志'),
            canStart
              ? h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: () => act('start', `/batches/${batch.id}/start`) }, '开始')
              : null,
            batch.status === 'running'
              ? h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: () => act('pause', `/batches/${batch.id}/pause`) }, '暂停')
              : null,
            batch.status === 'paused'
              ? h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: () => act('resume', `/batches/${batch.id}/resume`) }, '继续')
              : null,
            batch.status === 'running' || batch.status === 'paused'
              ? h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: () => act('cancel', `/batches/${batch.id}/cancel`) }, '取消')
              : null,
            hasReview
              ? h('button', {
                  className: 'cs-btn cs-btn-primary cs-btn-sm',
                  disabled: busy !== '',
                  onClick: approveAll,
                }, busy === 'approve-all' ? '通过中…' : '通过全部待审')
              : null,
            h('button', {
              className: 'cs-btn cs-btn-danger cs-btn-sm',
              onClick: async () => {
                if (!window.confirm('删除这个批次及其全部产物？不可恢复。')) return
                try {
                  await api('DELETE', `/batches/${batch.id}?purge=1`)
                  onDeleted?.(batch.id)
                } catch (error) {
                  setError(error.message)
                }
              },
            }, '删除'),
          ),
        ),
        h('div', { className: 'cs-detail-meta' },
          batch.config?.publishStartAt
            ? `计划发布 ${new Date(batch.config.publishStartAt).toLocaleString('zh-CN')} · 间隔 ${batch.config.publishIntervalMinutes} 分钟`
            : '未设置计划发布时间（只记录，不自动发布）'),
        batch.status === 'paused' && batch.pauseReason
          ? h('div', { className: 'cs-alert cs-alert-warning' },
              h(AlertIcon),
              h('div', { className: 'cs-alert-body' },
                h('div', { className: 'cs-alert-title' }, `已暂停：${PAUSE_REASON_ZH[batch.pauseReason] || batch.pauseReason}`),
                batch.pauseReason === 'cost_cap'
                  ? h('div', { className: 'cs-alert-actions' },
                      h('button', {
                        className: 'cs-btn cs-btn-sm cs-btn-outline',
                        disabled: busy === 'cap',
                        onClick: async () => {
                          const value = window.prompt('新的成本上限（¥）', String(batch.config?.costCap || ''))
                          if (!value) return
                          setBusy('cap')
                          try {
                            await api('POST', `/batches/${batch.id}/config`, { costCap: Number(value) })
                            await api('POST', `/batches/${batch.id}/resume`)
                            await load()
                          } catch (error) {
                            setError(error.message)
                          } finally {
                            setBusy('')
                          }
                        },
                      }, '提高上限并继续'),
                    )
                  : null,
              ),
            )
          : null,
        batch.items.some((item) => item.status === 'running')
          ? h('div', { className: 'cs-muted' }, '有任务正在运行，可点刷新查看进度')
          : null,
        h(UsageLine, { totals: batch.totals }),
        h(CostBar, { totals: batch.totals }),
        showLog ? h(LogViewer, { batchId: batch.id, onError: setError }) : null,
        h('div', { className: 'cs-item-grid' },
          batch.items.map((item) =>
            h('div', { key: item.id, className: 'cs-item' },
              h('div', { className: 'cs-item-head' },
                h('span', { className: 'cs-item-title' }, `${String(item.seq).padStart(2, '0')} ${item.title || '（未命名）'}`),
                h('div', { className: 'cs-row-main' },
                  item.autoRetries ? h('span', { className: 'cs-muted' }, `重试 ${item.autoRetries}`) : null,
                  h(Badge, { tone: STATUS_TONE[item.status] || '' }, ITEM_STATUS_ZH[item.status] || item.status),
                ),
              ),
              h(StepStrip, { steps: item.steps }),
              h('div', { className: 'cs-item-actions' },
                item.status === 'review_pending' || item.status === 'rejected'
                  ? h('button', {
                      className: 'cs-btn cs-btn-primary cs-btn-sm',
                      onClick: () => onOpenReview(item.id, batch.items.filter((i) => i.status === 'review_pending' || i.status === 'rejected').map((i) => i.id)),
                    }, item.status === 'rejected' ? '按备注重做' : '去审核')
                  : null,
                item.status === 'approved'
                  ? h('button', {
                      className: 'cs-btn cs-btn-outline cs-btn-sm',
                      disabled: exporting === item.id,
                      onClick: () => exportItem(item),
                    }, exporting === item.id ? '导出中…' : '导出发布包')
                  : null,
                item.status === 'failed' || item.status === 'rejected' || item.status === 'pending'
                  ? h('button', {
                      className: 'cs-btn cs-btn-outline cs-btn-sm',
                      onClick: () => act('retry', `/items/${item.id}/retry`),
                    }, '重新入队')
                  : null,
              ),
              item.error ? h('div', { className: 'cs-item-error' }, String(item.error).slice(0, 160)) : null,
            ),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 审核                                                             */
    /* ------------------------------------------------------------------ */
    const COVER_THUMBS = [
      ['vertical', '竖版', 'cover-vertical.png', ''],
      ['horizontal', '横版', 'cover-horizontal.png', ' is-wide'],
      ['square', '方图', 'cover-square.png', ' is-sq'],
    ]

    function ReviewCard({ itemId, onDone, index, total, onPrev, onNext }) {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [reason, setReason] = useState(REVIEW_REASONS[0])
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState('')
      const [saved, setSaved] = useState(false)
      const [zoom, setZoom] = useState(null)
      const [draft, setDraft] = useState({ title: '', description: '', hashtags: '', coverMain: '', coverSub: '' })

      const load = useCallback(async () => {
        try {
          setData(await api('GET', `/items/${itemId}`))
          setError('')
        } catch (e) {
          setError(e.message)
        }
      }, [itemId])

      useEffect(() => { load() }, [load])

      // Seed the editable copy whenever the item reloads.
      useEffect(() => {
        const source = data?.script
        if (!source) return
        setDraft({
          title: source.title || '',
          description: source.description || '',
          hashtags: (source.hashtags || []).join(' '),
          coverMain: source.coverText?.main || '',
          coverSub: source.coverText?.sub || '',
        })
      }, [data])

      // 键盘：a 通过 / r 驳回 / ←→ 翻页。输入框里打字时不拦截。
      // 必须在任何 early return 之前注册，否则 hooks 顺序会随渲染变化。
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape' && zoom) {
            setZoom(null)
            return
          }
          const tag = String(event.target?.tagName || '').toLowerCase()
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return
          const status = data?.item?.status
          if (event.key === 'a' && status === 'review_pending') {
            api('POST', `/items/${itemId}/approve`, { note }).then(() => { load(); onDone?.() }).catch(() => {})
          } else if (event.key === 'r' && status === 'review_pending') {
            api('POST', `/items/${itemId}/reject`, { reason, note }).then(() => { load(); onDone?.() }).catch(() => {})
          } else if (event.key === 'ArrowRight') {
            onNext?.()
          } else if (event.key === 'ArrowLeft') {
            onPrev?.()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [itemId, data, note, reason, zoom, onNext, onPrev, load, onDone])

      const act = async (label, path, body) => {
        setBusy(label)
        try {
          await api('POST', path, body)
          await load()
          onDone?.()
        } catch (e) {
          setError(e.message)
        } finally {
          setBusy('')
        }
      }

      if (error) return h('div', { style: S.card }, `读取失败：${error}`)
      if (!data) return h('div', { style: S.muted }, '读取中…')

      const { item, script, report, review, media } = data
      const base = media.base
      const approved = item.status === 'approved'
      const rejected = item.status === 'rejected'
      const canDecide = item.status === 'review_pending'
      const covers = COVER_THUMBS.filter(([key]) => (media.covers?.[key] || 0) > 0)

      return h('div', { className: 'cs-review' },
        h('div', { className: 'cs-review-head' },
          h('div', { className: 'cs-row-main' },
            h('h2', { className: 'cs-card-title' }, script?.title || item.title || item.id),
            h(Badge, { tone: STATUS_TONE[item.status] || '' }, ITEM_STATUS_ZH[item.status] || item.status),
            h('span', { className: 'cs-row-meta' }, item.durationSec ? `${item.durationSec.toFixed(1)}s` : ''),
            typeof index === 'number' && total
              ? h('span', { className: 'cs-row-meta' }, `${index + 1} / ${total}`)
              : null,
          ),
          h('div', { className: 'cs-actions' },
            onPrev ? h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: onPrev }, '← 上一条') : null,
            onNext ? h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: onNext }, '下一条 →') : null,
            h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: load }, '刷新'),
          ),
        ),

        h('div', { className: 'cs-review-desk' },
          h('div', { className: 'cs-review-stage' },
            media.master > 0
              ? h('div', { className: 'cs-review-phone' },
                  h('video', { key: `${itemId}-${media.master}`, src: `${base}/06-render/master.mp4`, controls: true }))
              : h('div', { className: 'cs-empty' }, '成片尚未生成'),
          ),
          h('div', { className: 'cs-review-side' },
            h('label', { className: 'cs-field' },
              h('span', { className: 'cs-label' }, '标题'),
              h('input', {
                className: 'cs-input',
                value: draft.title, disabled: busy !== '' || approved,
                onChange: (e) => setDraft({ ...draft, title: e.target.value }),
              })),
            h('label', { className: 'cs-field' },
              h('span', { className: 'cs-label' }, '简介'),
              h('textarea', {
                className: 'cs-textarea', style: { minHeight: 64 },
                value: draft.description, disabled: busy !== '' || approved,
                onChange: (e) => setDraft({ ...draft, description: e.target.value }),
              })),
            h('label', { className: 'cs-field' },
              h('span', { className: 'cs-label' }, '标签（空格分隔）'),
              h('input', {
                className: 'cs-input',
                value: draft.hashtags, disabled: busy !== '' || approved,
                onChange: (e) => setDraft({ ...draft, hashtags: e.target.value }),
              })),
            covers.length
              ? h('div', { className: 'cs-field' },
                  h('span', { className: 'cs-label' }, '封面 · 点击放大'),
                  h('div', { className: 'cs-cover-strip' },
                    covers.map(([key, label, file, kind]) => h('button', {
                      key,
                      type: 'button',
                      className: `cs-cover-thumb${kind}`,
                      title: label,
                      'aria-label': `放大${label}封面`,
                      onClick: () => setZoom({ src: `${base}/07-cover/${file}`, label }),
                    }, h('img', { src: `${base}/07-cover/${file}`, alt: label })))),
                )
              : null,
            h('div', { className: 'cs-form-grid', style: { gridTemplateColumns: '1fr 1fr' } },
              h('label', { className: 'cs-field' },
                h('span', { className: 'cs-label' }, '封面主文案'),
                h('input', {
                  className: 'cs-input',
                  value: draft.coverMain, disabled: busy !== '' || approved,
                  onChange: (e) => setDraft({ ...draft, coverMain: e.target.value }),
                })),
              h('label', { className: 'cs-field' },
                h('span', { className: 'cs-label' }, '封面副文案'),
                h('input', {
                  className: 'cs-input',
                  value: draft.coverSub, disabled: busy !== '' || approved,
                  onChange: (e) => setDraft({ ...draft, coverSub: e.target.value }),
                })),
            ),
            h('div', { className: 'cs-actions' },
              h('button', {
                className: 'cs-btn cs-btn-primary cs-btn-sm',
                disabled: busy !== '' || approved,
                onClick: async () => {
                  setBusy('save-copy')
                  try {
                    await api('POST', `/items/${itemId}/script`, {
                      title: draft.title,
                      description: draft.description,
                      hashtags: draft.hashtags.split(/\s+/).map((t) => t.trim()).filter(Boolean),
                      coverText: { main: draft.coverMain, sub: draft.coverSub },
                    })
                    setSaved(true)
                    setTimeout(() => setSaved(false), 2000)
                    await load()
                    onDone?.()
                  } catch (error) {
                    setError(error.message)
                  } finally {
                    setBusy('')
                  }
                },
              }, saved ? '已保存，将重跑校验' : '保存文案'),
              h('span', { className: 'cs-hint' }, '只重跑校验，不重新渲染'),
            ),
            report
              ? h('div', { className: 'cs-stack', style: { gap: 4 } },
                  h('div', { className: 'cs-muted' }, `校验：${report.summary.passed}/${report.summary.total} 通过 · ${report.summary.warnings} 告警`),
                  report.errors.length > 0
                    ? h('div', { className: 'cs-item-error' }, report.errors.map((entry) => `${entry.id}: ${entry.detail}`).join('；'))
                    : null,
                  report.warnings.length > 0
                    ? h('div', { className: 'cs-hint' }, report.warnings.map((warning) => `${warning.id}: ${warning.detail}`).join('；'))
                    : null,
                )
              : null,
            review ? h('div', { className: 'cs-muted' }, `上次审核：${review.decision === 'approved' ? '通过' : review.decision === 'withdrawn' ? '已撤回' : '驳回'}${review.reason ? ` · ${review.reason}` : ''}${review.note ? ` · ${review.note}` : ''}`) : null,
          ),
        ),

        h('div', { className: 'cs-review-decide' },
          h('div', { className: 'cs-actions' },
            h('button', {
              className: 'cs-btn cs-btn-primary',
              disabled: busy !== '' || !canDecide,
              onClick: () => act('approve', `/items/${itemId}/approve`, { note }),
            }, '通过'),
            h('select', {
              className: 'cs-select', style: { width: 150 },
              value: reason, onChange: (e) => setReason(e.target.value),
            },
              REVIEW_REASONS.map((reasonText) => h('option', { key: reasonText, value: reasonText }, reasonText))),
            h('input', {
              className: 'cs-input', style: { flex: '1 1 160px' },
              placeholder: '写明要改什么，驳回后会按这条重生成', value: note, onChange: (e) => setNote(e.target.value),
            }),
            h('button', {
              className: 'cs-btn cs-btn-outline',
              disabled: busy !== '' || !canDecide,
              onClick: () => act('reject', `/items/${itemId}/reject`, { reason, note }),
            }, '驳回并重做'),
            approved
              ? h('button', {
                  className: 'cs-btn cs-btn-ghost cs-btn-sm',
                  disabled: busy !== '',
                  onClick: () => act('unapprove', `/items/${itemId}/unapprove`),
                }, '撤回通过')
              : null,
            rejected || item.status === 'pending'
              ? h('button', {
                  className: 'cs-btn cs-btn-ghost cs-btn-sm',
                  onClick: () => act('retry', `/items/${itemId}/retry`),
                }, '重新入队')
              : null,
          ),
          h('div', { className: 'cs-actions' },
            h('span', { className: 'cs-hint' }, '局部重做'),
            ['script', 'voice', 'render', 'cover'].map((step) =>
              h('button', {
                key: step,
                className: 'cs-btn cs-btn-ghost cs-btn-sm',
                disabled: busy !== '' || approved,
                onClick: () => act(`rerun-${step}`, `/items/${itemId}/rerun`, { from: step }),
              }, `${STEP_ZH[step] || step}起`)),
          ),
        ),

        zoom
          ? h('div', { className: 'cs-preview', onClick: () => setZoom(null) },
              h('div', { className: 'cs-preview-box is-cover', onClick: (event) => event.stopPropagation() },
                h('img', { src: zoom.src, alt: zoom.label }),
                h('p', { className: 'cs-preview-cap' }, zoom.label),
                h('button', { className: 'cs-btn cs-btn-outline', onClick: () => setZoom(null) }, '关闭'),
              ))
          : null,
      )
    }

    /* ------------------------------------------------------------------ */
    /* 模型配置                                                          */
    /* ------------------------------------------------------------------ */
    const KIND_ZH = {
      'dashscope-wan': '百炼万相', llm: '文案', tts: '配音', image: '生图',
      comfyui: 'ComfyUI', 'http-generic': '本地 HTTP', 'ark-seedance': '方舟 Seedance',
    }
    const PRESETS = {
      wan: {
        id: 'bailian-wan', kind: 'dashscope-wan', enabled: true,
        origin: 'https://dashscope.aliyuncs.com', model: 'wan2.2-t2v-plus', apiKey: '',
        defaults: { durationSec: 5, aspectRatio: '9:16', resolution: '480P' },
      },
      llm: {
        id: 'gpt-text', kind: 'llm', enabled: true, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', apiKey: '',
      },
      tts: {
        id: 'bailian-tts', kind: 'tts', enabled: true,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-tts-flash', voice: 'Cherry', apiKey: '',
      },
      image: {
        id: 'gpt-image', kind: 'image', enabled: true, baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: '',
      },
      comfyui: {
        id: 'local-comfyui', kind: 'comfyui', enabled: false, baseUrl: 'http://127.0.0.1:8188', model: '',
        defaults: { width: 768, height: 1344, durationSec: 5, fps: 24 },
        limits: { concurrency: 1 }, workflowRef: '/home/spark01/comfyui/ltx-t2v-5s-api.json',
      },
      httpGeneric: {
        id: 'local-http', kind: 'http-generic', enabled: true, baseUrl: 'http://127.0.0.1:9000',
        defaults: { width: 768, height: 1344, durationSec: 5, fps: 24 }, limits: { concurrency: 1 },
        protocol: {
          health: { method: 'GET', path: '/health' },
          submit: { method: 'POST', path: '/generate', body: { prompt: '${prompt}', num_frames: '${frames}', seed: '${seed}' } },
          poll: { method: 'GET', path: '/tasks/${taskId}' },
          extract: { taskId: '$.task_id', state: '$.data.status', videoUrl: '$.data.video_url', error: '$.data.message' },
          stateMap: { queued: ['pending', 'queued'], running: ['running'], succeeded: ['success', 'done'], failed: ['error', 'failed'] },
        },
      },
      ark: {
        id: 'seedance', kind: 'ark-seedance', enabled: true,
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
        modelId: '', apiKey: '',
      },
    }
    const URL_HINT = {
      'dashscope-wan': 'https://dashscope.aliyuncs.com',
      llm: 'https://api.openai.com/v1 或兼容网关',
      tts: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      image: 'https://api.openai.com/v1 或兼容网关',
      comfyui: 'http://127.0.0.1:8188',
      'http-generic': 'http://127.0.0.1:9000',
      'ark-seedance': 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
    }

    const ROLE_CONFIG = {
      script: {
        title: '文案',
        subtitle: '生成标题、口播、标签和剪辑方案',
        required: true,
        kinds: ['llm'],
        preset: 'llm',
        empty: '还没有文案模型，先接一个 OpenAI 兼容接口。',
      },
      voice: {
        title: '配音',
        subtitle: '把口播文案合成为带时间轴的音频',
        required: true,
        kinds: ['tts'],
        preset: 'tts',
        empty: '还没有配音模型，可接百炼兼容接口或 OpenAI Speech。',
      },
      video: {
        title: '视频',
        subtitle: '生成镜头或调用本地视频工作流',
        required: true,
        kinds: ['dashscope-wan', 'comfyui', 'http-generic', 'ark-seedance'],
        preset: 'wan',
        empty: '还没有视频模型。云端用万相，本地可选 ComfyUI 或 HTTP。',
      },
      image: {
        title: '生图',
        subtitle: '生成封面底图；不配置也能用纯色降级',
        required: false,
        kinds: ['image'],
        preset: 'image',
        empty: '可选。没有生图模型时，封面会使用纯色底图。',
      },
    }
    const PRESET_BY_KIND = Object.fromEntries(Object.entries(PRESETS).map(([key, value]) => [value.kind, key]))
    const VIDEO_KIND_OPTIONS = [
      ['dashscope-wan', '百炼万相'],
      ['comfyui', '本地 ComfyUI'],
      ['http-generic', '本地 HTTP'],
      ['ark-seedance', '方舟 Seedance（预留）'],
    ]
    const USER_CONFIG_FIELDS = ['id', 'origin', 'baseUrl', 'model', 'modelId', 'apiKey', 'voice', 'workflowRef']

    function blankPreset(key) {
      const source = PRESETS[key]
      const next = { ...source, id: '', enabled: true }
      for (const field of USER_CONFIG_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(next, field)) next[field] = ''
      }
      return next
    }

    function providerRole(kind) {
      return Object.entries(ROLE_CONFIG).find(([, role]) => role.kinds.includes(kind))?.[0] || 'video'
    }

    function providerModeLabel(kind) {
      return KIND_ZH[kind] || kind || '模型'
    }

    function providerFields(kind) {
      const name = ['id', '名称']
      const key = ['apiKey', 'API Key']
      const url = kind === 'dashscope-wan' ? ['origin', '地址'] : ['baseUrl', '地址']
      const model = ['model', '模型']
      if (kind === 'dashscope-wan') return [name, url, model, key]
      if (kind === 'llm' || kind === 'image') return [name, url, model, key]
      if (kind === 'tts') return [name, url, model, ['voice', '音色'], key]
      if (kind === 'comfyui') return [name, url, model, ['workflowRef', '工作流文件']]
      if (kind === 'http-generic') return [name, url]
      if (kind === 'ark-seedance') return [name, url, ['modelId', '模型'], key]
      return [name, url]
    }

    function ProviderIcon({ name }) {
      const common = { viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
      if (name === 'models') return h('svg', common, h('rect', { x: 3, y: 3, width: 14, height: 4, rx: 1 }), h('rect', { x: 3, y: 9, width: 14, height: 4, rx: 1 }), h('rect', { x: 3, y: 15, width: 14, height: 2, rx: 1 }))
      if (name === 'edit') return h('svg', common, h('path', { d: 'M4 14.8V17h2.2L15.8 7.4l-2.2-2.2L4 14.8Z' }), h('path', { d: 'm12.7 6.1 1.2-1.2a1.6 1.6 0 0 1 2.2 0l.9.9a1.6 1.6 0 0 1 0 2.2l-1.2 1.2' }))
      if (name === 'delete') return h('svg', common, h('path', { d: 'M4 5.5h12M8 5.5V3.8h4v1.7M6.2 5.5l.6 10.7h6.4l.6-10.7M8.5 8.2v5.5M11.5 8.2v5.5' }))
      return h('svg', common, h('circle', { cx: 10, cy: 10, r: 6.5 }), h('path', { d: 'm7.2 10 1.8 1.8 3.8-4' }))
    }

    function ProviderIconButton({ name, label, ...props }) {
      return h('button', { ...props, className: `cs-icon-btn${props.className ? ` ${props.className}` : ''}`, title: label, 'aria-label': label }, h(ProviderIcon, { name }))
    }

    function ProvidersPage() {
      const [providers, setProviders] = useState([])
      const [health, setHealth] = useState(null)
      const [draft, setDraft] = useState(null)
      const [models, setModels] = useState([])
      const [result, setResult] = useState(null)
      const [busy, setBusy] = useState('')

      const load = useCallback(async () => {
        const [list, info] = await Promise.all([api('GET', '/providers'), api('GET', '/health')])
        setProviders(list.providers || [])
        setHealth(info)
      }, [])

      useEffect(() => { load().catch((e) => setResult({ ok: false, title: '读取失败', detail: e.message })) }, [load])

      const startEdit = (provider) => {
        setDraft({ ...provider, apiKey: '', _existing: true })
        setModels([])
        setResult(null)
      }
      const addPreset = (key) => {
        setDraft({ ...blankPreset(key), _existing: false })
        setModels([])
        setResult(null)
      }
      const patch = (key, value) => {
        setDraft((current) => ({ ...current, [key]: value }))
      }
      const probe = async (want, id) => {
        const payload = draft && (!id || draft.id === id)
          ? (() => {
              const { _existing, hasApiKey, ...rest } = draft
              return { ...rest, apiKey: rest.apiKey || (hasApiKey ? '__stored__' : ''), want }
            })()
          : { id, want }
        setBusy(want === 'models' ? `models:${id || draft?.id || 'draft'}` : want === 'test' ? `test:${id || draft?.id || 'draft'}` : `health:${id || draft?.id || 'draft'}`)
        try {
          const data = await api('POST', '/probe', payload)
          if (want === 'test') {
            setResult({
              ok: data.job?.status === 'succeeded',
              title: '试生成',
              detail: data.job?.detail || data.job?.error || data.health?.detail || '',
            })
          } else if (want === 'models') {
            const list = data.models || []
            setModels(list)
            const video = list.filter((id) => /t2v|i2v|video/i.test(id))
            setResult({
              ok: data.health?.ok !== false && list.length > 0,
              title: '上游模型',
              detail: list.length === 0
                ? (data.health?.detail || '没有模型')
                : video.length
                  ? `${list.length} 个，在「模型」下拉里选`
                  : `${list.length} 个，没有视频（t2v/i2v）。兼容地址常只列对话/图片；视频万相把地址改成 https://dashscope.aliyuncs.com，同一把 Key 再拉一次。`,
            })
          } else {
            setResult({
              ok: data.health?.ok !== false,
              title: '连通',
              detail: data.health?.detail || (data.health?.ok ? '已连通' : '未连通'),
            })
          }
        } catch (e) {
          setResult({ ok: false, title: want === 'models' ? '获取模型失败' : '连通失败', detail: e.message })
        } finally {
          setBusy('')
        }
      }
      const save = async () => {
        if (!draft) return
        const { _existing, hasApiKey, ...rest } = draft
        const payload = {
          ...rest,
          apiKey: rest.apiKey || (hasApiKey ? '__stored__' : ''),
        }
        if (!/^[\p{L}\p{N}._-]{1,64}$/u.test(payload.id || '')) {
          setResult({ ok: false, title: '配置名称不合法', detail: '支持中文、字母、数字、点、下划线和短横线，最多 64 个字符' })
          return
        }
        setBusy('save')
        try {
          await api('PUT', `/providers/${encodeURIComponent(payload.id)}`, payload)
          setDraft(null)
          setModels([])
          await load()
          setResult({ ok: true, title: '已保存', detail: `${payload.id} 已加入生产配置` })
          setTimeout(() => setResult(null), 4500)
        } catch (e) {
          setResult({ ok: false, title: '保存失败', detail: e.message })
        } finally {
          setBusy('')
        }
      }
      const test = async (id) => {
        setBusy(`test:${id}`)
        setResult({ ok: true, title: `${id} 测试中…`, detail: '' })
        try {
          const data = await api('POST', `/providers/${encodeURIComponent(id)}/test`, {})
          setResult({ ok: data.job.status === 'succeeded', title: `${id} 测试结果`, detail: data.job.detail || data.job.error || data.job.status })
        } catch (e) {
          setResult({ ok: false, title: `${id} 测试失败`, detail: e.message })
        } finally {
          setBusy('')
        }
      }
      const remove = async (id) => {
        await api('DELETE', `/providers/${encodeURIComponent(id)}`).catch(() => {})
        await load()
      }
      const toggleEnabled = async (provider) => {
        setBusy(`toggle:${provider.id}`)
        try {
          const payload = {
            ...provider,
            enabled: provider.enabled === false,
            apiKey: provider.hasApiKey ? '__stored__' : '',
          }
          delete payload.hasApiKey
          await api('PUT', `/providers/${encodeURIComponent(provider.id)}`, payload)
          await load()
          setResult({ ok: true, title: payload.enabled ? '配置已启用' : '配置已停用', detail: provider.id })
          setTimeout(() => setResult(null), 3000)
        } catch (error) {
          setResult({ ok: false, title: '切换失败', detail: error.message })
        } finally {
          setBusy('')
        }
      }

      const changeKind = (kind) => {
        const presetKey = PRESET_BY_KIND[kind]
        if (!presetKey) return
        setDraft({ ...blankPreset(presetKey), _existing: false })
        setModels([])
        setResult(null)
      }
      const roleProviders = (role) => providers.filter((provider) => role.kinds.includes(provider.kind))
      const addressLabel = (kind) => kind === 'comfyui' ? '服务地址' : kind === 'dashscope-wan' ? 'API 地址' : 'API 地址'
      const fieldHelp = (key, kind) => {
        if (key === 'id') return '支持中文、字母、数字、点、下划线和短横线，最多 64 个字符。'
        if (key === 'apiKey') return '密钥只保存在本机，已有密钥时留空即可。'
        if (key === 'modelId') return '填写控制台里的模型 ID。'
        if (key === 'voice') return '可选；留空使用上游默认音色。'
        if (key === 'workflowRef') return 'ComfyUI 的 API 工作流 JSON 文件路径。'
        if (key === 'origin' || key === 'baseUrl') return kind === 'comfyui' ? '填写 ComfyUI 服务根地址。' : '可以使用官方地址，也可以填写兼容网关。'
        return ''
      }
      const fieldTitle = (key, label, kind) => {
        if (key === 'id') return '配置名称'
        if (key === 'baseUrl' || key === 'origin') return addressLabel(kind)
        if (key === 'model') return '模型名称'
        if (key === 'modelId') return '模型 ID'
        return label
      }
      const renderProvider = (provider) => {
        const role = ROLE_CONFIG[providerRole(provider.kind)]
        return h('div', { key: provider.id, className: 'cs-provider-row' },
          h('div', { className: 'cs-provider-main' },
            h('span', { className: `cs-provider-dot${provider.enabled !== false ? ' is-on' : ''}` }),
            h('div', { className: 'cs-provider-copy' },
              h('div', { className: 'cs-provider-title-line' },
                h('strong', { className: 'cs-provider-title' }, provider.id),
                h(Badge, { tone: provider.enabled !== false ? 'ok' : 'neutral' }, provider.enabled !== false ? '已启用' : '已停用'),
                h(Badge, { tone: 'neutral' }, providerModeLabel(provider.kind)),
              ),
              h('span', { className: 'cs-muted' }, provider.origin || provider.baseUrl || role?.subtitle || ''),
            ),
          ),
          h('div', { className: 'cs-provider-actions' },
            h('label', { className: 'cs-provider-toggle', title: provider.enabled === false ? '启用配置' : '停用配置' },
              h('input', {
                type: 'checkbox',
                checked: provider.enabled !== false,
                disabled: busy === `toggle:${provider.id}`,
                onChange: () => toggleEnabled(provider),
              }),
              h('span', null, provider.enabled === false ? '停用' : '启用'),
            ),
            h(ProviderIconButton, { name: 'test', label: busy === `health:${provider.id}` ? '检测中' : '测试联通', disabled: busy === `health:${provider.id}`, onClick: () => probe('health', provider.id) }),
            provider.kind !== 'http-generic'
              ? h(ProviderIconButton, { name: 'models', label: busy === `models:${provider.id}` ? '获取中' : '获取模型', disabled: busy === `models:${provider.id}`, onClick: () => probe('models', provider.id) })
              : null,
            h(ProviderIconButton, { name: 'edit', label: '编辑配置', onClick: () => startEdit(provider) }),
            h(ProviderIconButton, { name: 'delete', label: '删除配置', className: 'is-danger', onClick: () => remove(provider.id) }),
          ),
        )
      }

      return h('div', { className: 'cs-stack cs-settings' },
        h('div', { className: 'cs-settings-overview' },
          h('div', { className: 'cs-settings-overview-copy' },
            h('span', { className: 'cs-kicker' }, '生产依赖'),
            h('h2', { className: 'cs-settings-title' }, '先配四类模型，再开始生成'),
            h('p', { className: 'cs-muted' }, '按任务配置，不需要先理解底层适配器。视频模型里的连接方式可以随时更换。'),
          ),
          health
            ? h('div', { className: `cs-runtime-status${health.ffmpeg.ok ? ' is-ok' : ' is-bad'}` },
                h('span', { className: 'cs-runtime-dot' }),
                h('span', null, `ffmpeg ${health.ffmpeg.ok ? '已就绪' : '不可用'}`),
                h('span', { className: 'cs-runtime-meta' }, `队列 ${health.queue ? `${health.queue.active.length} 运行 / ${health.queue.queued} 排队` : '未启动'}`),
              )
            : null,
        ),
        health && !health.ffmpeg.ok
          ? h('div', { className: 'cs-alert cs-alert-danger', role: 'alert' },
              h(AlertIcon),
              h('div', { className: 'cs-alert-body' }, h('p', { className: 'cs-alert-text' }, health.ffmpeg.error)),
            )
          : null,
        h('div', { className: 'cs-settings-grid' },
          Object.entries(ROLE_CONFIG).map(([roleKey, role]) => {
            const entries = roleProviders(role)
            return h('section', { key: roleKey, className: `cs-role-card${role.required ? ' is-required' : ''}` },
              h('div', { className: 'cs-role-head' },
                h('div', { className: 'cs-role-heading' },
                  h('div', { className: 'cs-role-title-line' },
                    h('h2', { className: 'cs-role-title' }, role.title),
                    h('span', { className: `cs-role-badge${role.required ? ' is-required' : ''}` }, role.required ? '必需' : '可选'),
                  ),
                  h('p', { className: 'cs-muted' }, role.subtitle),
                ),
                h('span', { className: 'cs-role-count' }, entries.length ? `${entries.length} 个` : '未配置'),
              ),
              entries.length
                ? h('div', { className: 'cs-provider-list' }, entries.map(renderProvider))
                : h('div', { className: 'cs-role-empty' }, role.empty),
              h('div', { className: 'cs-role-actions' },
                h('button', {
                  className: 'cs-btn cs-btn-outline cs-btn-sm',
                  onClick: () => addPreset(role.preset),
                }, `＋ 添加${role.title}模型`),
                roleKey === 'video'
                  ? h('span', { className: 'cs-hint' }, '添加后在接入方式里选择云端或本地')
                  : null,
              ),
            )
          }),
        ),
        draft
          ? h('div', {
              className: 'cs-config-backdrop',
              onClick: (event) => { if (event.target === event.currentTarget) { setDraft(null); setModels([]) } },
            },
              h('section', {
                className: 'cs-config-editor',
                role: 'dialog',
                'aria-modal': true,
                onClick: (event) => event.stopPropagation(),
              },
              h('div', { className: 'cs-config-editor-head' },
                h('div', null,
                  h('span', { className: 'cs-kicker' }, draft._existing ? '编辑配置' : '新建配置'),
                  h('h2', { className: 'cs-card-title' }, `${draft._existing ? '编辑' : '添加'}${KIND_ZH[draft.kind] || '模型'}`),
                ),
                h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: () => { setDraft(null); setModels([]) } }, '关闭'),
              ),
              !draft._existing && ROLE_CONFIG.video.kinds.includes(draft.kind)
                ? h('label', { className: 'cs-field cs-config-mode' },
                    h('span', { className: 'cs-label' }, '接入方式'),
                    h('select', { className: 'cs-select', value: draft.kind, onChange: (event) => changeKind(event.target.value) },
                      VIDEO_KIND_OPTIONS.map(([kind, label]) => h('option', { key: kind, value: kind }, label))),
                    h('span', { className: 'cs-hint' }, '只影响视频生成这一类，不会改变其他模型配置。'),
                  )
                : null,
              h('div', { className: 'cs-form-grid cs-config-grid' },
                providerFields(draft.kind).map(([key, label]) => {
                  const isUrl = key === 'baseUrl' || key === 'origin'
                  const isModel = key === 'model' || key === 'modelId'
                  const title = fieldTitle(key, label, draft.kind)
                  return h('label', {
                    key,
                    className: isUrl || key === 'workflowRef' ? 'cs-field cs-span-full' : 'cs-field',
                  },
                    h('span', { className: 'cs-label' }, title),
                    isModel && models.length
                      ? h('select', {
                          className: 'cs-select', value: draft[key] || '',
                          onChange: (event) => patch(key, event.target.value),
                        },
                          draft[key] && !models.includes(draft[key]) ? h('option', { value: draft[key] }, draft[key]) : h('option', { value: '' }, `从上游选择（${models.length}）`),
                          models.map((name) => h('option', { key: name, value: name }, name)),
                        )
                      : h('input', {
                          className: 'cs-input', type: key === 'apiKey' ? 'password' : 'text', value: draft[key] || '',
                          placeholder: key === 'apiKey' && draft.hasApiKey ? '已保存，留空则不改' : isUrl ? (URL_HINT[draft.kind] || '') : key === 'id' ? '例如：主文案模型' : '',
                          autoComplete: key === 'apiKey' ? 'off' : undefined,
                          readOnly: key === 'id' && draft._existing,
                          onChange: (event) => patch(key, event.target.value),
                        }),
                    fieldHelp(key, draft.kind) ? h('span', { className: 'cs-hint' }, fieldHelp(key, draft.kind)) : null,
                  )
                }),
              ),
              draft.kind === 'http-generic'
                ? h('details', { className: 'cs-advanced' },
                    h('summary', null, '高级：HTTP 协议'),
                    h('p', { className: 'cs-hint' }, '默认协议是 /health、/generate、/tasks/:id。需要自定义字段时，保留现有协议对象并在代码配置里调整。'),
                  )
                : null,
              h('div', { className: 'cs-form-actions' },
                h('button', { className: 'cs-btn cs-btn-outline', disabled: Boolean(busy), onClick: () => probe('health') }, busy.startsWith('health:') ? '检测中…' : '测试联通'),
                draft.kind === 'http-generic' ? null : h('button', { className: 'cs-btn cs-btn-outline', disabled: Boolean(busy), onClick: () => probe('models') }, busy.startsWith('models:') ? '获取中…' : '获取模型'),
                h('button', { className: 'cs-btn cs-btn-outline', disabled: Boolean(busy), onClick: () => probe('test') }, busy.startsWith('test:') ? '生成中…' : '试生成'),
                h('button', { className: 'cs-btn cs-btn-primary', onClick: save, disabled: busy === 'save' }, busy === 'save' ? '保存中…' : '保存配置'),
                h('button', { className: 'cs-btn cs-btn-ghost', onClick: () => { setDraft(null); setModels([]) } }, '取消'),
              ),
              result
                ? h('div', { className: `cs-inline-result${result.ok ? ' is-ok' : ' is-bad'}`, role: 'status', 'aria-live': 'polite' },
                    h(Badge, { tone: result.ok ? 'ok' : 'bad' }, result.ok ? '成功' : '失败'),
                    h('div', { className: 'cs-inline-result-copy' },
                      h('strong', null, result.title),
                      result.detail ? h('span', null, String(result.detail).slice(0, 500)) : null,
                    ),
                  )
                : null,
              ),
            )
          : null,
        !draft && result
          ? h('div', { className: `cs-result-toast${result.ok ? ' is-ok' : ' is-bad'}`, role: 'status', 'aria-live': 'polite' },
              h(Badge, { tone: result.ok ? 'ok' : 'bad' }, result.ok ? '成功' : '失败'),
              h('div', { className: 'cs-inline-result-copy' },
                h('strong', null, result.title),
                result.detail ? h('span', null, String(result.detail).slice(0, 500)) : null,
              ),
              h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: () => setResult(null), 'aria-label': '关闭提示' }, '×'),
            )
          : null,
      )
    }

    function ReadyPage({ refreshKey, platforms = [], onError }) {
      const [batches, setBatches] = useState([])
      const [postiz, setPostiz] = useState(null)
      const [channels, setChannels] = useState([])
      const [publishJobs, setPublishJobs] = useState([])
      const [picked, setPicked] = useState([])
      const [form, setForm] = useState({ apiUrl: 'https://api.postiz.com', apiKey: '' })
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState('')

      const load = useCallback(async () => {
        try {
          const [list, cfg, jobInfo] = await Promise.all([api('GET', '/batches'), api('GET', '/postiz'), api('GET', '/publish/jobs')])
          setBatches(list.batches || [])
          setPublishJobs(jobInfo.jobs || [])
          setPostiz(cfg)
          setForm((current) => ({ ...current, apiUrl: cfg.apiUrl || current.apiUrl }))
          if (cfg.hasApiKey) {
            try {
              const data = await api('GET', '/postiz/channels')
              setChannels(data.channels || [])
            } catch (error) {
              setChannels([])
              onError?.(error.message)
            }
          } else {
            setChannels([])
          }
        } catch (error) {
          onError?.(error.message)
        }
      }, [onError])

      useEffect(() => { load() }, [load, refreshKey])

      const rows = []
      for (const batch of batches) {
        for (const item of batch.items || []) {
          if (item.status === 'approved') rows.push({ batch, item })
        }
      }

      const download = async (item) => {
        setBusy(`zip:${item.id}`)
        try {
          await downloadZip(`/items/${item.id}/export`, `content-studio-item-${String(item.seq).padStart(3, '0')}.zip`)
        } catch (error) {
          onError?.(error.message)
        } finally {
          setBusy('')
        }
      }

      const savePostiz = async () => {
        setBusy('postiz')
        setNotice('')
        try {
          const saved = await api('POST', '/postiz', {
            apiUrl: form.apiUrl,
            apiKey: form.apiKey || (postiz?.hasApiKey ? '__stored__' : ''),
          })
          setPostiz(saved)
          setForm((current) => ({ ...current, apiKey: '' }))
          setNotice(saved.hasApiKey ? 'Postiz 已保存，正在拉账号' : '已清掉密钥')
          await load()
        } catch (error) {
          onError?.(error.message)
        } finally {
          setBusy('')
        }
      }

      const distribute = async (item) => {
        if (!picked.length) {
          onError?.('先勾选要发到的 Postiz 账号')
          return
        }
        setBusy(`dist:${item.id}`)
        setNotice('')
        try {
          const data = await api('POST', `/items/${item.id}/publish`, { integrationIds: picked, scheduleAt: new Date().toISOString(), mode: 'now' })
          const names = (data.job?.targets || []).map((channel) => channel.name).join('、')
          setNotice(`已加入发布队列：${names || '已提交'}`)
          await load()
        } catch (error) {
          onError?.(error.message)
        } finally {
          setBusy('')
        }
      }

      const toggle = (id) => {
        setPicked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
      }

      return h('div', { className: 'cs-stack' },
        h('p', { className: 'cs-hint' },
          '导出发布包是成片、封面和文案的 zip，给抖音 / 小红书 / 视频号手工发。Postiz 没有这些国内号。已接的 TikTok / YouTube 等可以在这里直接分发。'),
        h('div', { className: 'cs-card' },
          h('div', { className: 'cs-card-head' },
            h('h2', { className: 'cs-card-title' }, 'Postiz'),
            h('span', { className: 'cs-muted' }, postiz?.hasApiKey ? `${channels.length} 个账号` : '未连接'),
          ),
          h('div', { className: 'cs-form-grid' },
            h('label', { className: 'cs-field' },
              h('span', { className: 'cs-label' }, 'API 地址'),
              h('input', {
                className: 'cs-input',
                value: form.apiUrl,
                placeholder: 'https://api.postiz.com 或自建 https://host/api',
                onChange: (event) => setForm({ ...form, apiUrl: event.target.value }),
              })),
            h('label', { className: 'cs-field' },
              h('span', { className: 'cs-label' }, 'API 密钥'),
              h('input', {
                className: 'cs-input',
                type: 'password',
                value: form.apiKey,
                placeholder: postiz?.hasApiKey ? '已保存，留空则不改' : '从 Postiz 设置里复制',
                autoComplete: 'off',
                onChange: (event) => setForm({ ...form, apiKey: event.target.value }),
              })),
          ),
          h('div', { className: 'cs-actions' },
            h('button', {
              className: 'cs-btn cs-btn-outline cs-btn-sm',
              disabled: busy !== '',
              onClick: savePostiz,
            }, busy === 'postiz' ? '保存中…' : '保存并拉账号'),
          ),
          channels.length
            ? h('div', { className: 'cs-cover-strip', style: { marginTop: 8 } },
                channels.map((channel) => h('button', {
                  key: channel.id,
                  type: 'button',
                  className: `cs-chip${picked.includes(channel.id) ? ' is-active' : ''}`,
                  onClick: () => toggle(channel.id),
                }, `${channel.name} · ${channel.identifier}`)))
            : postiz?.hasApiKey
              ? h('p', { className: 'cs-hint' }, '密钥已保存，但没有拉到账号。检查地址，或去 Postiz 先连频道。')
              : null,
        ),
        h('div', { className: 'cs-card' },
          h('div', { className: 'cs-card-head' },
            h('h2', { className: 'cs-card-title' }, '待分发'),
            h('div', { className: 'cs-card-actions' },
              h('span', { className: 'cs-muted' }, `${rows.length} 条 · ${publishJobs.filter((job) => job.status === 'scheduled' || job.status === 'publishing').length} 个发布中`),
              h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: load }, '刷新'),
            ),
          ),
          notice ? h('p', { className: 'cs-hint' }, notice) : null,
          rows.length === 0
            ? h('div', { className: 'cs-empty' }, '还没有待分发的条目。审核通过后会出现在这里。')
            : h('div', { className: 'cs-list' },
                rows.map(({ batch, item }) => h('div', {
                  key: item.id,
                  className: 'cs-batch-row',
                  style: { cursor: 'default' },
                },
                  h('div', { className: 'cs-row-main' },
                    h('span', { className: 'cs-row-title' }, item.title || item.id),
                    h(Badge, { tone: item.publish?.status === 'failed' ? 'bad' : item.publish?.status === 'published' ? 'info' : item.publish?.status === 'publishing' ? 'warn' : 'ok' },
                      item.publish?.status === 'published' ? '已发布' : item.publish?.status === 'publishing' ? '发布中' : item.publish?.status === 'failed' ? '发布失败' : '已通过'),
                    h('span', { className: 'cs-row-meta' }, item.durationSec ? `${item.durationSec.toFixed(1)}s` : ''),
                    item.distribute?.channels?.length
                      ? h('span', { className: 'cs-row-meta' }, item.distribute.channels.map((channel) => channel.name).join('、'))
                      : null,
                    h('span', { className: 'cs-row-meta' }, batch.title),
                  ),
                  h('div', { className: 'cs-actions' },
                    h('button', {
                      className: 'cs-btn cs-btn-primary cs-btn-sm',
                      disabled: busy !== '' || !picked.length,
                      onClick: () => distribute(item),
                    }, busy === `dist:${item.id}` ? '分发中…' : '分发'),
                    h('button', {
                      className: 'cs-btn cs-btn-ghost cs-btn-sm',
                      disabled: busy !== '',
                      onClick: () => download(item),
                    }, busy === `zip:${item.id}` ? '导出中…' : '导出 zip'),
                  ),
                )),
              ),
        ),
      )
    }

    function SettingsPage() {
      return h(ProvidersPage)
    }

    function DirectoryPicker({ services, open, onClose, onPick }) {
      const [listing, setListing] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)

      const load = useCallback(async (path) => {
        setBusy(true)
        setError('')
        try {
          setListing(await services.listDirectory(path))
        } catch (loadError) {
          setError(loadError.message)
        } finally {
          setBusy(false)
        }
      }, [services])

      useEffect(() => {
        if (!open) return
        setListing(null)
        setError('')
        load(undefined)
      }, [open, load])

      if (!open) return null

      const crumbs = listing?.crumbs || []
      const entries = listing?.entries || []
      return h('div', {
        className: 'cs-modal-backdrop',
        onClick: (event) => { if (event.target === event.currentTarget) onClose() },
      },
        h('div', { className: 'cs-modal', role: 'dialog', 'aria-modal': 'true' },
          h('div', { className: 'cs-modal-head' },
            h('h2', { className: 'cs-card-title' }, '选择目录'),
            h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: onClose }, '关闭'),
          ),
          crumbs.length > 0
            ? h('div', { className: 'cs-crumbs' },
                crumbs.map((crumb) => h('button', {
                  key: crumb.path,
                  className: 'cs-chip',
                  onClick: () => load(crumb.path),
                }, crumb.name || crumb.path)),
              )
            : null,
          h('div', { className: 'cs-dir-path cs-mono' }, listing?.path || (busy ? '读取中…' : '')),
          error
            ? h('div', { className: 'cs-alert cs-alert-danger', role: 'alert' },
                h(AlertIcon),
                h('div', { className: 'cs-alert-body' }, h('p', { className: 'cs-alert-text' }, error)),
              )
            : null,
          h('div', { className: 'cs-dir-list' },
            entries.map((entry) => h('button', {
              key: entry.path,
              className: 'cs-dir-row',
              disabled: busy,
              onClick: () => load(entry.path),
            },
              h('span', { className: 'cs-dir-name' }, entry.name),
              h('span', { className: 'cs-dir-enter' }, '›'),
            )),
            listing && entries.length === 0 ? h('div', { className: 'cs-empty' }, '没有子目录') : null,
          ),
          h('div', { className: 'cs-modal-actions' },
            h('button', {
              className: 'cs-btn cs-btn-primary',
              disabled: busy || !listing,
              onClick: () => onPick(listing.path),
            }, '选择当前目录'),
            h('button', { className: 'cs-btn cs-btn-ghost', onClick: onClose }, '取消'),
          ),
        ),
      )
    }

    function Seg({ value, onChange, options, label }) {
      return h('div', { className: 'cs-seg', role: 'group', 'aria-label': label },
        options.map(([id, text]) => h('button', {
          key: String(id),
          type: 'button',
          className: `cs-seg-btn${value === id ? ' is-on' : ''}`,
          onClick: () => onChange(id),
        }, text)),
      )
    }

    function CreateComposer({ readiness, onCreated }) {
      const [prompt, setPrompt] = useState('')
      const [refs, setRefs] = useState([])
      const [aspect, setAspect] = useState('9:16')
      const [resolution, setResolution] = useState('480P')
      const CLIP_PRESETS = [15, 30, 60, 90]
      const CLIP_MAX_SEC = 180
      const [targetSec, setTargetSec] = useState(30)
      const [customDur, setCustomDur] = useState(false)
      const [clips, setClips] = useState([])
      const [picked, setPicked] = useState([])
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [preview, setPreview] = useState(null)
      const [playing, setPlaying] = useState(false)

      const loadClips = useCallback(async () => {
        const data = await api('GET', '/clips')
        setClips(data.clips || [])
      }, [])

      useEffect(() => { loadClips().catch((e) => setError(e.message)) }, [loadClips])
      useEffect(() => {
        if (!clips.some((clip) => clip.status === 'running')) return undefined
        const timer = setInterval(() => { loadClips().catch(() => {}) }, 3000)
        return () => clearInterval(timer)
      }, [clips, loadClips])

      const addRefs = (fileList) => {
        const next = [...fileList].filter((file) => file.type.startsWith('image/')).map((file) => ({
          name: file.name,
          url: URL.createObjectURL(file),
        }))
        setRefs((current) => [...current, ...next].slice(0, 4))
      }

      const generate = async () => {
        if (!prompt.trim()) {
          setError('先写提示词')
          return
        }
        setBusy('gen')
        setError('')
        setNotice('')
        try {
          const data = await api('POST', '/clips', { prompt: prompt.trim(), aspectRatio: aspect, resolution, durationSec: targetSec })
          if (targetSec > 30) setNotice(`${targetSec} 秒会按每段最多 30 秒首尾帧接龙，最长 ${CLIP_MAX_SEC} 秒。要等几分钟，按秒计费。`)
          else if (targetSec >= 15) setNotice(`${targetSec} 秒镜头生成中，大约几分钟。`)
          setClips((current) => [data.clip, ...current.filter((clip) => clip.id !== data.clip.id)])
        } catch (genError) {
          setError(genError.message)
        } finally {
          setBusy('')
        }
      }

      const film = async (clipIds) => {
        if (!clipIds.length) {
          setError('先勾选镜头')
          return
        }
        setBusy('film')
        setError('')
        try {
          const data = await api('POST', '/films', {
            clipIds,
            targetSec,
            prompt: prompt.trim(),
            aspectRatio: aspect,
            resolution,
          })
          setNotice(data.notice || '成片已创建')
          onCreated?.(data.batch)
        } catch (filmError) {
          setError(filmError.message)
        } finally {
          setBusy('')
        }
      }

      const toggle = (id) => {
        setPicked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
      }

      const remove = async (id) => {
        await api('DELETE', `/clips/${encodeURIComponent(id)}`)
        setClips((current) => current.filter((clip) => clip.id !== id))
        setPicked((current) => current.filter((item) => item !== id))
        setPreview((current) => current && current.id === id ? null : current)
      }

      const retry = async (clip) => {
        setBusy(`retry:${clip.id}`)
        setError('')
        try {
          const data = await api('POST', `/clips/${encodeURIComponent(clip.id)}/retry`)
          setClips((current) => current.map((item) => item.id === clip.id ? data.clip : item))
        } catch (retryError) {
          setError(retryError.message)
        } finally {
          setBusy('')
        }
      }

      const ratio = aspect === '16:9' ? ' is-wide' : aspect === '1:1' ? ' is-square' : ''
      const shotClass = `cs-shot${ratio}`

      return h('div', { className: 'cs-studio' },
        h('div', { className: 'cs-well' },
          clips.length === 0
            ? h('div', { className: 'cs-empty-studio' },
                h('div', { className: 'cs-empty-mark', 'aria-hidden': true }, '✦'),
                h('strong', { className: 'cs-empty-title' }, '从一句话开始生成镜头'),
                h('p', { className: 'cs-well-copy' }, '还没有镜头。写下画面、动作和氛围，生成结果会按时间顺序出现在这里。'),
                h('div', { className: `cs-gates${ratio}`, 'aria-hidden': true },
                  [0, 1, 2, 3].map((index) => h('div', { key: index, className: `cs-gate${ratio}` })),
                ),
              )
            : h('div', { className: 'cs-gallery' },
                clips.map((clip) => h('div', {
                  key: clip.id,
                  className: `${shotClass}${picked.includes(clip.id) ? ' is-on' : ''}`,
                  onClick: clip.status === 'succeeded' ? () => toggle(clip.id) : undefined,
                  onMouseEnter: (event) => { event.currentTarget.querySelector('video')?.play().catch(() => {}) },
                  onMouseLeave: (event) => { event.currentTarget.querySelector('video')?.pause() },
                },
                  clip.status === 'succeeded' && clip.url
                    ? h('video', { src: clip.url, muted: true, loop: true, playsInline: true, preload: 'metadata' })
                    : h('div', { className: 'cs-shot-ph', title: clip.error || '' },
                        clip.status === 'running' ? '生成中…' : (clip.prompt || '失败')),
                  h('button', {
                    className: 'cs-shot-x', type: 'button', 'aria-label': '删除镜头',
                    disabled: busy !== '',
                    onClick: (event) => { event.stopPropagation(); remove(clip.id).catch((err) => setError(err.message)) },
                  }, '×'),
                  clip.status === 'succeeded' ? h('span', { className: 'cs-shot-time' }, `${clip.durationSec || 5}秒`) : null,
                  clip.status === 'succeeded'
                    ? h('input', {
                        className: 'cs-shot-check', type: 'checkbox',
                        checked: picked.includes(clip.id),
                        onChange: (event) => { event.stopPropagation(); toggle(clip.id) },
                        onClick: (event) => event.stopPropagation(),
                        'aria-label': '勾选进成片',
                      })
                    : null,
                  h('div', { className: 'cs-shot-act' },
                    clip.status === 'succeeded'
                      ? [
                          h('button', {
                            key: 'preview', className: 'cs-btn cs-btn-sm',
                            onClick: (event) => { event.stopPropagation(); setPlaying(true); setPreview(clip) },
                          }, '预览'),
                          h('button', {
                            key: 'film', className: 'cs-btn cs-btn-sm',
                            disabled: busy !== '',
                            onClick: (event) => { event.stopPropagation(); film([clip.id]) },
                          }, '成片'),
                        ]
                      : clip.status === 'failed'
                        ? [
                            h('button', {
                              key: 'retry', className: 'cs-btn cs-btn-sm',
                              disabled: busy !== '',
                              onClick: (event) => { event.stopPropagation(); retry(clip) },
                            }, '重试'),
                            h('button', {
                              key: 'edit', className: 'cs-btn cs-btn-sm',
                              onClick: (event) => { event.stopPropagation(); setPrompt(clip.prompt || '') },
                            }, '改'),
                          ]
                        : null,
                  ),
                )),
              ),
        ),
        preview
          ? h('div', { className: 'cs-preview', onClick: () => { setPreview(null); setPlaying(false) } },
              h('div', { className: 'cs-preview-box', onClick: (event) => event.stopPropagation() },
                h('video', {
                  src: preview.url, controls: true, autoPlay: true, playsInline: true,
                  onPlay: () => setPlaying(true),
                  onPause: () => setPlaying(false),
                  onEnded: () => setPlaying(false),
                }),
                h('p', { className: 'cs-preview-cap' }, `${preview.durationSec || 5}秒 · ${preview.prompt || ''}`),
                h('div', { className: 'cs-preview-bar' },
                  h('button', {
                    className: 'cs-btn cs-btn-outline',
                    onClick: (event) => {
                      const video = event.currentTarget.closest('.cs-preview-box')?.querySelector('video')
                      if (!video) return
                      if (video.paused) video.play()
                      else video.pause()
                    },
                  }, playing ? '暂停' : '播放'),
                  h('button', { className: 'cs-btn cs-btn-outline', onClick: () => { setPreview(null); setPlaying(false) } }, '关闭'),
                ),
              ))
          : null,
        h('section', { className: 'cs-dock' },
          h('div', { className: 'cs-dock-row' },
            h(Seg, { label: '画幅', value: aspect, onChange: setAspect, options: [['9:16', '9:16'], ['16:9', '16:9'], ['1:1', '1:1']] }),
            h(Seg, { label: '清晰度', value: resolution, onChange: setResolution, options: [['480P', '480P'], ['1080P', '1080P']] }),
            h(Seg, {
              label: '时长',
              value: customDur || !CLIP_PRESETS.includes(targetSec) ? 'custom' : targetSec,
              onChange: (id) => {
                if (id === 'custom') {
                  setCustomDur(true)
                  return
                }
                setCustomDur(false)
                setTargetSec(id)
              },
              options: [[15, '15秒'], [30, '30秒'], [60, '1分钟'], [90, '1分半'], ['custom', '自定义']],
            }),
            customDur || !CLIP_PRESETS.includes(targetSec)
              ? h('label', { className: 'cs-dur' },
                  h('input', {
                    className: 'cs-dur-input', type: 'number', min: 5, max: CLIP_MAX_SEC, step: 5,
                    value: targetSec,
                    onChange: (event) => {
                      const n = Math.round(Number(event.target.value))
                      setTargetSec(Number.isFinite(n) ? Math.min(CLIP_MAX_SEC, Math.max(5, n)) : 5)
                    },
                  }),
                  `秒，最长 ${CLIP_MAX_SEC}`,
                )
              : null,
            h('button', {
              className: 'cs-btn cs-btn-outline',
              disabled: busy !== '' || picked.length === 0,
              onClick: () => film(picked),
            }, busy === 'film' ? '拼接中…' : picked.length ? `开始成片 ${picked.length}` : '开始成片'),
          ),
          refs.length
            ? h('div', { className: 'cs-refs' },
                refs.map((item, index) => h('div', { key: `${item.name}-${index}`, className: 'cs-ref' },
                  h('img', { src: item.url, alt: item.name }),
                  h('button', {
                    className: 'cs-ref-x', type: 'button', 'aria-label': '移除参考图',
                    onClick: () => setRefs((current) => current.filter((_, itemIndex) => itemIndex !== index)),
                  }, '×'),
                )))
            : null,
          h('div', { className: 'cs-prompt' },
            h('textarea', {
              className: 'cs-prompt-input',
              rows: 3,
              placeholder: '描述要生成的镜头。例如：BMS 工厂产线，电芯分选、焊接和测试，干净工业广告风，不要字幕',
              value: prompt,
              onChange: (event) => setPrompt(event.target.value),
            }),
            h('div', { className: 'cs-prompt-bar' },
              h('label', { className: 'cs-btn cs-btn-ghost' },
                '参考图',
                h('input', {
                  className: 'cs-file', type: 'file', accept: 'image/*', multiple: true,
                  onChange: (event) => {
                    addRefs(event.target.files || [])
                    event.target.value = ''
                  },
                }),
              ),
              h('span', { className: 'cs-hint' }, `每条 ${targetSec} 秒，最长 ${CLIP_MAX_SEC}`),
              readiness,
              h('button', {
                className: 'cs-go',
                disabled: busy === 'gen',
                onClick: generate,
              }, busy === 'gen' ? '提交中…' : '生成'),
            ),
          ),
          error
            ? h('div', { className: 'cs-alert cs-alert-danger', role: 'alert' },
                h('div', { className: 'cs-alert-body' }, h('p', { className: 'cs-alert-text' }, error)))
            : null,
          notice
            ? h('div', { className: 'cs-alert cs-alert-success', role: 'status' },
                h('div', { className: 'cs-alert-body' }, h('p', { className: 'cs-alert-text' }, notice)))
            : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 工作台                                                            */
    /* ------------------------------------------------------------------ */
    function Workbench({ services }) {
      ensureStyles()
      const [tab, setTab] = useState('console')
      const [batches, setBatches] = useState([])
      const [selected, setSelected] = useState(null)
      const [reviewQueue, setReviewQueue] = useState([])
      const [reviewIndex, setReviewIndex] = useState(0)
      const [groups, setGroups] = useState([])
      const [platforms, setPlatforms] = useState([])
      const [health, setHealth] = useState(null)
      const [error, setError] = useState('')
      const [installError, setInstallError] = useState('')
      const [installing, setInstalling] = useState(false)
      const [tick, setTick] = useState(0)
      const [showAdvanced, setShowAdvanced] = useState(false)
      const [advancedInitial, setAdvancedInitial] = useState(null)
      const [composerKey, setComposerKey] = useState(0)
      const [picker, setPicker] = useState(null)

      const load = useCallback(async () => {
        try {
          const [list, groupInfo, healthInfo, metaInfo] = await Promise.all([
            api('GET', '/batches'), api('GET', '/materials/groups'), api('GET', '/health'), api('GET', '/meta'),
          ])
          setBatches(list.batches || [])
          setGroups(groupInfo.groups || [])
          setHealth(healthInfo)
          setPlatforms(metaInfo.platforms || [])
          setError('')
        } catch (e) {
          setError(e.message)
        }
      }, [])

      useEffect(() => { load() }, [load, tick])

      useEffect(() => {
        const timer = setInterval(() => setTick((n) => n + 1), 5000)
        return () => clearInterval(timer)
      }, [])

      const installFfmpeg = async () => {
        setInstalling(true)
        setInstallError('')
        try {
          await api('POST', '/tools/install-ffmpeg')
          await load()
        } catch (installFailure) {
          setInstallError(installFailure.message)
        } finally {
          setInstalling(false)
        }
      }

      const itemStatuses = batches.flatMap((batch) => (batch.items || []).map((item) => item.status))
      const reviewable = batches.flatMap((batch) => (batch.items || [])
        .filter((item) => item.status === 'review_pending' || item.status === 'rejected')
        .map((item) => item.id))
      const summary = [
        ['运行中', itemStatuses.filter((status) => status === 'running').length],
        ['待审核', itemStatuses.filter((status) => status === 'review_pending').length],
        ['已驳回', itemStatuses.filter((status) => status === 'rejected').length],
        ['失败', itemStatuses.filter((status) => status === 'failed').length],
        ['待分发', itemStatuses.filter((status) => status === 'approved').length],
      ]

      const openReview = (itemId, queue) => {
        const ids = Array.isArray(queue) && queue.length > 0 ? queue : (itemId ? [itemId] : reviewable)
        if (ids.length) {
          setReviewQueue(ids)
          setReviewIndex(itemId ? Math.max(0, ids.indexOf(itemId)) : 0)
        }
        if (!selected && batches[0]) setSelected(batches[0].id)
        setTab('review')
      }

      return h('div', { className: 'cs-page' },
        h('div', { className: 'cs-page-inner' },
        h('div', { className: 'cs-chrome' },
          h('h1', { className: 'cs-title' }, ({ console: '生成', review: '审核', ready: '待分发', settings: '设置' })[tab]),
          h('nav', { className: 'cs-tabs' },
            [['console', '生成'], ['review', '审核'], ['ready', '待分发'], ['settings', '设置']].map(([key, label]) =>
              h('button', {
                key,
                className: `cs-tab${tab === key ? ' is-active' : ''}`,
                'aria-current': tab === key ? 'page' : undefined,
                onClick: () => (key === 'review' ? openReview() : setTab(key)),
              }, key === 'review' && reviewable.length ? `${label} ${reviewable.length}` : label)),
          ),
          h('button', { className: 'cs-btn cs-btn-ghost', style: { marginLeft: 'auto' }, onClick: load }, '刷新'),
        ),
        error
          ? h('div', { className: 'cs-alert cs-alert-danger', role: 'alert', style: { margin: '0 28px 8px' } },
              h(AlertIcon),
              h('div', { className: 'cs-alert-body' },
                h('p', { className: 'cs-alert-text' }, `接口不可用：${error}`),
              ),
            )
          : null,
        h('div', { className: 'cs-body is-scroll' },
        tab === 'console'
          ? h(BatchConsole, {
              key: composerKey,
              groups,
              health,
              services,
              platforms,
              readiness: h(Readiness, {
                health,
                onConfigure: () => setTab('settings'),
                onInstallFfmpeg: installFfmpeg,
                installing,
                installError,
              }),
              onCreated: (batch) => {
                setSelected(batch.id)
                setTab('review')
                load()
              },
            })
          : null,

        tab === 'review'
          ? h('div', { className: 'cs-stack' },
              reviewQueue.length > 0
                ? h(ReviewCard, {
                    key: reviewQueue[reviewIndex],
                    itemId: reviewQueue[reviewIndex],
                    index: reviewIndex,
                    total: reviewQueue.length,
                    onPrev: reviewIndex > 0 ? () => setReviewIndex((i) => Math.max(0, i - 1)) : undefined,
                    onNext: reviewIndex < reviewQueue.length - 1 ? () => setReviewIndex((i) => i + 1) : undefined,
                    onDone: () => {
                      setTick((n) => n + 1)
                      if (reviewIndex < reviewQueue.length - 1) setReviewIndex((i) => i + 1)
                    },
                  })
                : h('p', { className: 'cs-empty' }, batches.length
                  ? '点下面一条成片，打开待审内容。'
                  : '还没有成片。去生成页做出镜头，再点成片。'),
              reviewQueue.length > 0
                ? h('div', { className: 'cs-actions' },
                    h('button', {
                      className: 'cs-btn cs-btn-ghost cs-btn-sm',
                      onClick: () => { setReviewQueue([]); setReviewIndex(0) },
                    }, '收起预览'),
                    h('span', { className: 'cs-hint' }, '快捷键：A 通过 · R 驳回并重做 · ← → 翻页'),
                  )
                : null,
              batches.length > 0
                ? h('section', { className: 'cs-films' },
                    h('div', { className: 'cs-card-head' },
                      h('h2', { className: 'cs-card-title' }, '成片'),
                      h('div', { className: 'cs-card-actions' },
                        summary.map(([label, value]) => h('span', { key: label, className: 'cs-stat-inline' },
                          label, h('strong', null, String(value)))),
                      ),
                    ),
                    h('div', { className: 'cs-list' },
                      batches.map((batch) => {
                        const failed = (batch.items || []).filter((item) => item.status === 'failed').length
                        const passed = (batch.items || []).some((item) => item.status === 'approved')
                        const mark = failed > 0 ? ['告警', 'is-bad'] : passed ? ['待分发', 'is-ok'] : ['进行中', 'is-wait']
                        return h('button', {
                          key: batch.id,
                          className: `cs-batch-row${selected === batch.id ? ' is-selected' : ''}`,
                          onClick: () => setSelected(batch.id),
                        },
                          h('div', { className: 'cs-row-main' },
                            h('span', { className: 'cs-dot', style: { opacity: batch.status === 'cancelled' ? 0.3 : 1 } }),
                            h('span', { className: 'cs-row-title' }, batch.title),
                            h(Badge, { tone: BATCH_STATUS_TONE[batch.status] || '' }, BATCH_STATUS_ZH[batch.status] || batch.status),
                            h('span', { className: 'cs-row-meta' }, platformLabel(platforms, batch.config?.platform)),
                          ),
                          h('span', { className: `cs-log-mark ${mark[1]}` }, mark[0]),
                          h('span', { className: 'cs-row-meta' }, `${batch.items.length} 条 · ${new Date(batch.createdAt).toLocaleString('zh-CN')}`),
                        )
                      }),
                    ),
                  )
                : null,
              selected ? h(BatchDetail, {
                batchId: selected,
                refreshKey: tick,
                platforms,
                onOpenReview: openReview,
                onDeleted: () => { setSelected(null); setTick((n) => n + 1) },
              }) : null,
            )
          : null,

        tab === 'ready' ? h(ReadyPage, { refreshKey: tick, platforms, onError: setError }) : null,

        tab === 'settings' ? h(SettingsPage, { platforms }) : null,
        ),

        picker
          ? h(DirectoryPicker, {
              services,
              open: true,
              onClose: () => setPicker(null),
              onPick: (path) => {
                picker.onPick?.(path)
                setPicker(null)
              },
            })
          : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* registration                                                        */
    /* ------------------------------------------------------------------ */
    function SidebarIcon({ size = 18, active = false }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        style: { opacity: active ? 1 : 0.78 },
      },
        h('rect', { x: 3, y: 7, width: 18, height: 13, rx: 2 }),
        h('path', { d: 'M3 11h18' }),
        h('path', { d: 'M7 7l2-3M12 7l2-3M17 7l2-3' }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ensureStyles()
        // 目录选择器来自宿主；拿不到时表单退化成手填路径
        const services = {
          pickDirectory: async () => {
            // 可选服务：没挂目录选择器时表单退化成手填路径
            const picker = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : ctx.uiWorkspace
            if (!picker || typeof picker.pickDirectory !== 'function') return null
            return picker.pickDirectory()
          },
          listDirectory: async (path, signal) => {
            const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : ctx.uiWorkspace
            if (!workspace || typeof workspace.listDirectory !== 'function') {
              throw new Error('当前宿主不支持目录浏览，请直接粘贴路径')
            }
            return workspace.listDirectory(path, signal)
          },
        }
        const Bound = (props) => h(Workbench, { ...props, services })
        Bound.displayName = 'ContentStudioWorkbench'

        // 主区域面板 + 左侧栏图标，和「插件」「自动化任务」同一套 slot；
        // 不再注册 settings.section，避免两个入口。
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: 'content-studio',
            },
            Bound,
          ),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'content-studio',
              order: 25,
              label: () => '内容生产',
            },
            SidebarIcon,
          ),
        )
      },
      // 测试缝隙：渲染测试需要单独挂载这些子组件。Cordis 忽略未知字段。
      __components: {
        Workbench, BatchConsole, ProvidersPage, NewBatchForm, BatchDetail, ReviewCard,
        Readiness, UsageLine, StepStrip, CostBar, LogViewer, ReadyPage, SettingsPage, SidebarIcon, CreateComposer, DirectoryPicker,
      },
    }
  },
})
