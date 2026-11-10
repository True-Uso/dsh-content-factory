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
  --cs-radius: var(--dsw-radius-md, 8px);
  --cs-radius-lg: var(--dsw-radius-lg, 12px);
  --cs-border: var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 12%, transparent));
  --cs-border-strong: var(--dsw-alias-border-l4, color-mix(in srgb, currentColor 20%, transparent));
  --cs-text: var(--dsw-alias-label-primary, currentColor);
  --cs-text-2: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 72%, transparent));
  --cs-text-3: var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 55%, transparent));
  --cs-fill: var(--dsw-alias-bg-layer-1, transparent);
  --cs-fill-2: var(--dsw-alias-bg-layer-3, color-mix(in srgb, currentColor 5%, transparent));
  --cs-fill-3: var(--dsw-alias-bg-layer-4, color-mix(in srgb, currentColor 8%, transparent));
  --cs-hover: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 6%, transparent));
  --cs-accent: var(--dsw-alias-state-business-primary, color-mix(in srgb, currentColor 80%, transparent));
  --cs-success: var(--dsw-alias-state-success-primary, #2ea043);
  --cs-warn: var(--dsw-alias-state-warn-primary, #d29922);
  --cs-danger: var(--dsw-alias-state-error-primary, #f85149);
  color: var(--cs-text); font-size: 13px; line-height: 1.5;
}
.cs-page { flex: 1 1 auto; height: 100%; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-gutter: stable; }
.cs-page-inner { display: flex; flex-direction: column; gap: 16px; padding: 20px 24px 48px; max-width: 1200px; margin: 0 auto; width: 100%; }
.cs-page *, .cs-page *::before, .cs-page *::after { box-sizing: border-box; }
.cs-page h1, .cs-page h2, .cs-page h3, .cs-page p { margin: 0; }
.cs-page ::selection { background: color-mix(in srgb, var(--cs-accent) 22%, transparent); }
.cs-page :focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--cs-accent)); outline-offset: 1px; }
.cs-page button { font-family: inherit; transition: filter 150ms ease, background-color 150ms ease, border-color 150ms ease; }
.cs-page button:hover:not(:disabled) { filter: brightness(0.97); }
.cs-page button:active:not(:disabled) { filter: brightness(0.93); }
.cs-page button:disabled { opacity: 0.4; cursor: not-allowed; }
.cs-page input:focus, .cs-page select:focus, .cs-page textarea:focus { border-color: var(--cs-accent) !important; outline: none; }
.cs-page input::placeholder, .cs-page textarea::placeholder { color: var(--cs-text-3); }

.cs-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.cs-title { font-size: 18px; line-height: 26px; font-weight: 600; letter-spacing: -0.01em; }
.cs-subtitle { margin-top: 4px; font-size: 12px; line-height: 18px; color: var(--cs-text-3); }
.cs-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.cs-tabs { display: flex; gap: 2px; border-bottom: 0.5px solid var(--cs-border); }
.cs-tab { height: 36px; padding: 0 12px; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; border-radius: 0; background: transparent; color: var(--cs-text-2); font-size: 13px; cursor: pointer; }
.cs-tab:hover { color: var(--cs-text); background: var(--cs-hover); }
.cs-tab.is-active { color: var(--cs-text); border-bottom-color: var(--cs-text); font-weight: 600; }

.cs-stats { display: flex; align-items: stretch; border: 0.5px solid var(--cs-border); border-radius: var(--cs-radius-lg); background: var(--cs-fill); overflow: hidden; }
.cs-stat { flex: 1; min-width: 0; padding: 10px 16px; border-left: 0.5px solid var(--cs-border); }
.cs-stat:first-child { border-left: 0; }
.cs-stat-label { display: block; font-size: 11px; line-height: 16px; color: var(--cs-text-3); }
.cs-stat-value { display: block; margin-top: 2px; font-size: 18px; line-height: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }

.cs-stack { display: flex; flex-direction: column; gap: 16px; }
.cs-stat-inline { display: inline-flex; align-items: baseline; gap: 4px; font-size: 12px; color: var(--cs-text-3); }
.cs-stat-inline strong { color: var(--cs-text); font-weight: 600; font-variant-numeric: tabular-nums; }

.cs-composer { padding: 18px 18px 14px; gap: 10px; }
.cs-composer:focus-within { border-color: var(--cs-accent); }
.cs-prompt-input { width: 100%; min-height: 74px; padding: 0; border: 0; background: transparent; color: var(--cs-text); font: inherit; font-size: 15px; line-height: 1.6; resize: vertical; outline: none; }
.cs-composer-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cs-composer-bar .cs-hint { flex: 1 1 240px; }
.cs-composer-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 2px; }
.cs-composer-meta .cs-input { flex: 1 1 240px; }
.cs-chip { height: 28px; padding: 0 10px; border: 0.5px solid var(--cs-border-strong); border-radius: 999px; background: transparent; color: var(--cs-text-2); font-size: 12px; cursor: pointer; }
.cs-chip:hover { background: var(--cs-hover); }
.cs-chip.is-active { border-color: var(--cs-accent); color: var(--cs-accent); background: color-mix(in srgb, var(--cs-accent) 8%, transparent); }

.cs-thread { display: flex; flex-direction: column; gap: 10px; }
.cs-chat-user { align-self: flex-end; max-width: 82%; padding: 10px 12px; border-radius: 12px 12px 4px 12px; background: var(--cs-fill-2); font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
.cs-chat-ai { align-self: flex-start; max-width: 88%; display: flex; gap: 10px; padding: 12px; border: 0.5px solid var(--cs-border); border-radius: 12px 12px 12px 4px; background: var(--cs-fill); }
.cs-chat-avatar { flex: 0 0 24px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 999px; background: var(--cs-text); color: #fff; font-size: 10px; font-weight: 600; }
.cs-chat-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.cs-plan-facts { display: flex; flex-wrap: wrap; gap: 6px; }
.cs-plan-fact { display: inline-flex; align-items: baseline; gap: 4px; padding: 2px 8px; border-radius: 6px; background: var(--cs-fill-2); color: var(--cs-text-2); font-size: 12px; }
.cs-plan-fact strong { color: var(--cs-text); font-weight: 600; }

.cs-card { border: 0.5px solid var(--cs-border); border-radius: var(--cs-radius-lg); background: var(--cs-fill); padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.cs-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.cs-card-title { font-size: 13px; font-weight: 600; line-height: 20px; }
.cs-card-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cs-section-title { font-size: 12px; font-weight: 600; color: var(--cs-text-2); line-height: 18px; }

.cs-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 12px; border: 0.5px solid transparent; border-radius: var(--cs-radius); background: transparent; color: var(--cs-text); font-size: 12px; line-height: 18px; cursor: pointer; white-space: nowrap; }
.cs-btn:hover:not(:disabled) { background: var(--cs-hover); }
.cs-btn-primary { background: var(--dsw-alias-button-primary-fill, var(--cs-text)); color: var(--dsw-alias-label-primary-foreground, #fff); border-color: transparent; }
.cs-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--cs-text)); }
.cs-btn-outline { border-color: var(--cs-border-strong); background: transparent; }
.cs-btn-outline:hover:not(:disabled) { background: var(--cs-hover); }
.cs-btn-ghost { background: transparent; }
.cs-btn-sm { height: 26px; padding: 0 9px; font-size: 12px; }
.cs-btn-danger { color: var(--cs-danger); }
.cs-btn-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--cs-danger) 8%, transparent); }

.cs-tag { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; }
.cs-tag-ok { background: color-mix(in srgb, var(--cs-success) 10%, transparent); color: var(--cs-success); }
.cs-tag-warn { background: color-mix(in srgb, var(--cs-warn) 12%, transparent); color: var(--cs-warn); }
.cs-tag-bad { background: color-mix(in srgb, var(--cs-danger) 10%, transparent); color: var(--cs-danger); }
.cs-tag-info { background: color-mix(in srgb, var(--cs-accent) 10%, transparent); color: var(--cs-accent); }
.cs-tag-neutral { background: var(--dsw-alias-bg-module-platform, var(--cs-fill-2)); color: var(--cs-text-2); }
.cs-tag-outline { border: 0.5px solid var(--cs-border-strong); color: var(--cs-text-3); }

.cs-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.cs-label { font-size: 12px; line-height: 18px; color: var(--cs-text-2); }
.cs-hint { font-size: 12px; line-height: 18px; color: var(--cs-text-3); }
.cs-input, .cs-select, .cs-textarea { width: 100%; height: 32px; padding: 0 10px; border: 0.5px solid var(--cs-border-strong); border-radius: var(--cs-radius); background: var(--cs-fill); color: var(--cs-text); font: inherit; font-size: 13px; line-height: 20px; }
.cs-select { padding-right: 26px; }
.cs-textarea { height: auto; min-height: 64px; padding: 8px 10px; line-height: 1.5; resize: vertical; }
.cs-form-section { display: flex; flex-direction: column; gap: 10px; padding: 14px 0; border-top: 0.5px solid var(--cs-border); }
.cs-form-section:first-child { padding-top: 0; border-top: 0; }
.cs-form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px 16px; }
.cs-span-full { grid-column: 1 / -1; }
.cs-form-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 12px; border-top: 0.5px solid var(--cs-border); }
.cs-form-actions .cs-hint { margin-left: auto; }

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
.cs-empty { padding: 24px 12px; text-align: center; color: var(--cs-text-3); font-size: 12px; line-height: 18px; }

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

.cs-review-grid { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); gap: 16px; }
.cs-review-pane { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.cs-media { width: 100%; max-height: 420px; border-radius: var(--cs-radius); background: #000; object-fit: contain; }
.cs-cover { width: 100%; height: auto; border: 0.5px solid var(--cs-border); border-radius: var(--cs-radius); display: block; }
.cs-pre { margin: 0; padding: 10px; border-radius: var(--cs-radius); border: 0.5px solid var(--cs-border); max-height: 220px; overflow: auto; font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; background: var(--cs-fill-2); }
.cs-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.cs-muted { color: var(--cs-text-3); font-size: 12px; line-height: 18px; }
.cs-divider { height: 0.5px; background: var(--cs-border); border: 0; }
.cs-table { width: 100%; border-collapse: collapse; }
.cs-table th, .cs-table td { text-align: left; padding: 8px 0; border-top: 0.5px solid var(--cs-border); font-size: 12px; }
.cs-table th { border-top: 0; color: var(--cs-text-3); font-weight: 500; }
.cs-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; flex: 0 0 6px; }

.cs-modal-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.32); }
.cs-modal { width: min(640px, 100%); max-height: 80vh; display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 0.5px solid var(--cs-border); border-radius: var(--cs-radius-lg); background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18); }
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
  .cs-page-inner { padding: 12px 12px 40px; }
  .cs-review-grid { grid-template-columns: 1fr; }
  .cs-stats { flex-wrap: wrap; }
  .cs-stat { flex: 1 1 40%; border-left: 0; border-top: 0.5px solid var(--cs-border); }
  .cs-stat:nth-child(-n+2) { border-top: 0; }
  .cs-stat:nth-child(even) { border-left: 0.5px solid var(--cs-border); }
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
    function NewBatchForm({ onCreated, groups, health, services, platforms = [], initial = null, onPickDirectory = null }) {
      const [form, setForm] = useState(() => ({
        title: '', topic: '', count: 5, dirs: '', group: '', targetSec: 26,
        aspectRatio: '9:16', materialMode: 'folder', shotCount: 8, voice: '', transition: 'cut', concurrency: '',
        platform: 'douyin', publishStartAt: '', publishIntervalMinutes: 1440, reviewMode: 'required', costCap: '',
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
          dirs: initial.dirs || '',
        } : {}),
      }))
      const [busy, setBusy] = useState('')
      const [message, setMessage] = useState(null)
      const [scanned, setScanned] = useState(null)

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
          }
          const result = await api('POST', '/batches', { title: form.title || form.topic, count: Number(form.count) || 1, config })
          const warnings = result.preflight?.warnings || []
          setMessage({
            ok: true,
            text: warnings.length > 0
              ? `批次已创建：${result.batch.id} —— 注意：${warnings.join('；')}`
              : `批次已创建：${result.batch.id}`,
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
              className: 'cs-input', placeholder: '例如：秋日通勤三件套',
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
            platformPreset
              ? h('p', { className: 'cs-hint cs-span-full' }, `平台标题上限 ${platformPreset.titleMaxLength} 字，仅提示，不阻断。发布起点与间隔只记录，本期不自动发布。`)
              : null,
          ),
        ),
        h('div', { className: 'cs-form-section' },
          h('h3', { className: 'cs-section-title' }, '素材'),
          h('div', { className: 'cs-form-grid' },
            field('素材目录', h('textarea', {
              className: 'cs-textarea cs-span-full',
              placeholder: '一行一个目录，例如 D:\\素材\\穿搭',
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
          }, busy === 'create' ? '创建中…' : '创建批次'),
          h('span', { className: 'cs-hint' }, ready ? '创建后可在总控台启动' : '主题和数量必填'),
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
      const missing = ['llm', 'tts', 'video'].filter((role) => !roles.has(role))
      if (!ffmpegMissing && missing.length === 0) return null

      const summary = [
        ffmpegMissing ? 'ffmpeg 未就绪' : null,
        missing.length > 0 ? `缺少${missing.map((role) => ROLE_ZH[role]).join('、')}` : null,
      ].filter(Boolean).join('；')

      return h('div', { className: 'cs-alert cs-alert-warning', role: 'status' },
        h(AlertIcon),
        h('div', { className: 'cs-alert-body' },
          h('div', { className: 'cs-alert-title' }, '还不能开始生产'),
          h('p', { className: 'cs-alert-text' }, summary),
          h('div', { className: 'cs-alert-actions' },
            ffmpegMissing
              ? h('button', {
                  className: 'cs-btn cs-btn-sm cs-btn-outline',
                  disabled: installing,
                  onClick: onInstallFfmpeg,
                }, installing ? '安装中…' : '安装 ffmpeg')
              : null,
            missing.length > 0
              ? h('button', { className: 'cs-btn cs-btn-sm cs-btn-outline', onClick: onConfigure }, '去配置模型')
              : null,
          ),
          installError
            ? h('div', { className: 'cs-hint', style: { color: 'var(--cs-danger)' } }, installError)
            : null,
          ffmpegMissing && health.ffmpeg?.error
            ? h('details', { className: 'cs-hint' },
                h('summary', { style: { cursor: 'pointer' } }, '查看 ffmpeg 错误'),
                h('p', { style: { margin: '4px 0 0' } }, health.ffmpeg.error),
              )
            : null,
        ),
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
                item.status === 'review_pending'
                  ? h('button', {
                      className: 'cs-btn cs-btn-primary cs-btn-sm',
                      onClick: () => onOpenReview(item.id, batch.items.filter((i) => i.status === 'review_pending').map((i) => i.id)),
                    }, '去审核')
                  : null,
                item.status === 'approved'
                  ? h('button', {
                      className: 'cs-btn cs-btn-outline cs-btn-sm',
                      disabled: exporting === item.id,
                      onClick: () => exportItem(item),
                    }, exporting === item.id ? '导出中…' : '导出发布包')
                  : null,
                item.status === 'failed'
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
    function ReviewCard({ itemId, onDone, index, total, onPrev, onNext }) {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [reason, setReason] = useState(REVIEW_REASONS[0])
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState('')
      const [saved, setSaved] = useState(false)
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
      }, [itemId, data, note, reason, onNext, onPrev, load, onDone])

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

      return h('div', { className: 'cs-card cs-stack' },
        h('div', { className: 'cs-card-head' },
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

        h('div', { className: 'cs-review-grid' },
          h('div', { className: 'cs-review-pane' },
            media.master > 0
              ? h('video', { key: `${itemId}-${media.master}`, src: `${base}/06-render/master.mp4`, controls: true, className: 'cs-media' })
              : h('div', { className: 'cs-empty' }, '成片尚未生成'),
            media.covers.vertical > 0
              ? h('img', { src: `${base}/07-cover/cover-vertical.png`, className: 'cs-cover' })
              : null,
          ),
          h('div', { className: 'cs-review-pane' },
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

        h('div', { className: 'cs-actions' },
          h('button', {
            className: 'cs-btn cs-btn-primary cs-btn-sm',
            disabled: busy !== '' || approved,
            onClick: () => act('approve', `/items/${itemId}/approve`, { note }),
          }, '通过'),
          h('select', {
            className: 'cs-select', style: { width: 150 },
            value: reason, onChange: (e) => setReason(e.target.value),
          },
            REVIEW_REASONS.map((reasonText) => h('option', { key: reasonText, value: reasonText }, reasonText))),
          h('input', {
            className: 'cs-input', style: { flex: '1 1 160px' },
            placeholder: '驳回备注', value: note, onChange: (e) => setNote(e.target.value),
          }),
          h('button', {
            className: 'cs-btn cs-btn-outline cs-btn-sm',
            disabled: busy !== '',
            onClick: () => act('reject', `/items/${itemId}/reject`, { reason, note }),
          }, '驳回'),
          approved
            ? h('button', {
                className: 'cs-btn cs-btn-ghost cs-btn-sm',
                disabled: busy !== '',
                onClick: () => act('unapprove', `/items/${itemId}/unapprove`),
              }, '撤回通过')
            : null,
        ),

        h('div', { className: 'cs-actions' },
          h('span', { className: 'cs-hint' }, '局部重做：'),
          ['script', 'voice', 'render', 'cover'].map((step) =>
            h('button', {
              key: step,
              className: 'cs-btn cs-btn-outline cs-btn-sm',
              disabled: busy !== '' || approved,
              onClick: () => act(`rerun-${step}`, `/items/${itemId}/rerun`, { from: step }),
            }, `${STEP_ZH[step] || step}起`)),
          rejected
            ? h('button', {
                className: 'cs-btn cs-btn-ghost cs-btn-sm',
                onClick: () => act('retry', `/items/${itemId}/retry`),
              }, '重新入队')
            : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 模型配置                                                          */
    /* ------------------------------------------------------------------ */
    const PRESETS = {
      llm: {
        id: 'gpt-text', kind: 'llm', enabled: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', apiKey: '',
      },
      tts: {
        id: 'bailian-tts', kind: 'tts', enabled: false,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-tts', voice: 'Cherry', apiKey: '',
      },
      image: {
        id: 'gpt-image', kind: 'image', enabled: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: '',
      },
      comfyui: {
        id: 'local-comfyui', kind: 'comfyui', enabled: false, baseUrl: 'http://127.0.0.1:8188',
        defaults: { width: 768, height: 1344, durationSec: 5, fps: 24 },
        limits: { concurrency: 1 }, workflowRef: 'D:\\素材\\ltx-t2v.json',
      },
      httpGeneric: {
        id: 'local-http', kind: 'http-generic', enabled: false, baseUrl: 'http://127.0.0.1:9000',
        defaults: { width: 768, height: 1344, durationSec: 5, fps: 24 }, limits: { concurrency: 1 },
        protocol: {
          health: { method: 'GET', path: '/health' },
          submit: { method: 'POST', path: '/generate', body: { prompt: '${prompt}', num_frames: '${frames}', seed: '${seed}' } },
          poll: { method: 'GET', path: '/tasks/${taskId}' },
          extract: { taskId: '$.task_id', state: '$.data.status', videoUrl: '$.data.video_url', error: '$.data.message' },
          stateMap: { queued: ['pending', 'queued'], running: ['running'], succeeded: ['success', 'done'], failed: ['error', 'failed'] },
        },
      },
      ark: { id: 'seedance', kind: 'ark-seedance', enabled: false, modelId: '', apiKey: '' },
    }

    function ProvidersPage() {
      const [providers, setProviders] = useState([])
      const [health, setHealth] = useState(null)
      const [draft, setDraft] = useState(null)
      const [text, setText] = useState('')
      const [result, setResult] = useState(null)
      const [busy, setBusy] = useState('')

      const load = useCallback(async () => {
        const [list, info] = await Promise.all([api('GET', '/providers'), api('GET', '/health')])
        setProviders(list.providers || [])
        setHealth(info)
      }, [])

      useEffect(() => { load().catch((e) => setResult({ ok: false, title: '读取失败', detail: e.message })) }, [load])

      const startEdit = (provider) => {
        setDraft(provider)
        setText(JSON.stringify(provider, null, 2))
        setResult(null)
      }
      const addPreset = (key) => {
        setDraft(PRESETS[key])
        setText(JSON.stringify(PRESETS[key], null, 2))
        setResult(null)
      }
      const save = async () => {
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch (e) {
          setResult({ ok: false, title: 'JSON 解析失败', detail: e.message })
          return
        }
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(parsed.id || '')) {
          setResult({ ok: false, title: 'id 不合法', detail: '字母、数字、点、下划线、短横线，≤64' })
          return
        }
        setBusy('save')
        try {
          await api('PUT', `/providers/${encodeURIComponent(parsed.id)}`, parsed)
          setDraft(null)
          await load()
          setResult({ ok: true, title: '已保存', detail: parsed.id })
        } catch (e) {
          setResult({ ok: false, title: '保存失败', detail: e.message })
        } finally {
          setBusy('')
        }
      }
      const check = async (id) => {
        setBusy(`health:${id}`)
        try {
          const data = await api('POST', `/providers/${encodeURIComponent(id)}/health`)
          setResult({ ok: data.health?.ok !== false, title: `${id} 健康检查`, detail: data.health?.detail || (data.health?.ok ? '正常' : '不可用') })
        } catch (e) {
          setResult({ ok: false, title: `${id} 检查失败`, detail: e.message })
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

      return h('div', { className: 'cs-stack' },
        health && !health.ffmpeg.ok
          ? h('div', { className: 'cs-alert cs-alert-danger', role: 'alert' },
              h(AlertIcon),
              h('div', { className: 'cs-alert-body' },
                h('p', { className: 'cs-alert-text' }, health.ffmpeg.error),
              ),
            )
          : null,
        health
          ? h('div', { className: 'cs-muted' },
              `ffmpeg ${health.ffmpeg.ok ? '已就绪' : '不可用'} · 队列 ${health.queue ? `${health.queue.active.length} 运行 / ${health.queue.queued} 排队` : '未启动'}`)
          : null,
        h('div', { className: 'cs-actions' },
          h('button', { className: 'cs-btn cs-btn-outline cs-btn-sm', onClick: () => addPreset('llm') }, '＋ 文案模型'),
          h('button', { className: 'cs-btn cs-btn-outline cs-btn-sm', onClick: () => addPreset('tts') }, '＋ 配音模型'),
          h('button', { className: 'cs-btn cs-btn-outline cs-btn-sm', onClick: () => addPreset('image') }, '＋ 生图模型'),
          h('button', { className: 'cs-btn cs-btn-outline cs-btn-sm', onClick: () => addPreset('comfyui') }, '＋ 本地 ComfyUI'),
          h('button', { className: 'cs-btn cs-btn-outline cs-btn-sm', onClick: () => addPreset('httpGeneric') }, '＋ 本地 HTTP'),
          h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: () => addPreset('ark') }, '＋ 方舟 Seedance（预留）'),
        ),
        providers.length === 0
          ? h('div', { className: 'cs-card' },
              h('div', { className: 'cs-empty' }, '还没有配置任何模型。至少要配一个文案模型、一个配音模型、一个视频模型才能产出。'))
          : null,
        providers.map((provider) =>
          h('div', { key: provider.id, className: 'cs-card' },
            h('div', { className: 'cs-card-head' },
              h('div', { className: 'cs-row-main' },
                h('span', { className: 'cs-dot', style: { opacity: provider.enabled !== false ? 1 : 0.3 } }),
                h('span', { className: 'cs-card-title' }, provider.id),
                h(Badge, { tone: 'neutral' }, provider.kind),
                provider.kind === 'ark-seedance' && !provider.modelId
                  ? h('span', { className: 'cs-hint' }, '未配置模型 ID')
                  : null,
              ),
              h('div', { className: 'cs-actions' },
                h('button', {
                  className: 'cs-btn cs-btn-ghost cs-btn-sm',
                  disabled: busy === `health:${provider.id}`,
                  onClick: () => check(provider.id),
                }, '健康检查'),
                h('button', {
                  className: 'cs-btn cs-btn-ghost cs-btn-sm',
                  disabled: busy === `test:${provider.id}`,
                  onClick: () => test(provider.id),
                }, busy === `test:${provider.id}` ? '测试中…' : '测试'),
                h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: () => startEdit(provider) }, '编辑'),
                h('button', { className: 'cs-btn cs-btn-danger cs-btn-sm', onClick: () => remove(provider.id) }, '删除'),
              ),
            ),
            provider.baseUrl ? h('div', { className: 'cs-mono' }, provider.baseUrl) : null,
          ),
        ),
        draft
          ? h('div', { className: 'cs-card' },
              h('p', { className: 'cs-muted' }, '整段 JSON 就是配置，保存后立即生效。apiKey 显示 __stored__ 表示已保存；填新值即替换，留空即清除。'),
              h('textarea', {
                className: 'cs-textarea cs-mono', style: { minHeight: 180 },
                value: text, spellCheck: false, onChange: (e) => setText(e.target.value),
              }),
              h('div', { className: 'cs-actions' },
                h('button', { className: 'cs-btn cs-btn-primary cs-btn-sm', onClick: save, disabled: busy === 'save' }, '保存'),
                h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: () => setDraft(null) }, '取消'),
              ),
            )
          : null,
        result
          ? h('div', { className: 'cs-card' },
              h('div', { className: 'cs-row-main' },
                h(Badge, { tone: result.ok ? 'ok' : 'bad' }, result.ok ? '成功' : '失败'),
                h('span', { className: 'cs-card-title' }, result.title),
              ),
              result.detail ? h('pre', { className: 'cs-pre' }, String(result.detail).slice(0, 500)) : null,
            )
          : null,
      )
    }

    function ReadyPage({ refreshKey, platforms = [], onError }) {
      const [batches, setBatches] = useState([])
      const [busy, setBusy] = useState('')

      const load = useCallback(async () => {
        try {
          const data = await api('GET', '/batches')
          setBatches(data.batches || [])
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
        setBusy(item.id)
        try {
          await downloadZip(`/items/${item.id}/export`, `content-studio-item-${String(item.seq).padStart(3, '0')}.zip`)
        } catch (error) {
          onError?.(error.message)
        } finally {
          setBusy('')
        }
      }

      return h('div', { className: 'cs-stack' },
        h('div', { className: 'cs-card' },
          h('div', { className: 'cs-card-head' },
            h('h2', { className: 'cs-card-title' }, '待发布'),
            h('div', { className: 'cs-card-actions' },
              h('span', { className: 'cs-muted' }, `${rows.length} 条`),
              h('button', { className: 'cs-btn cs-btn-ghost cs-btn-sm', onClick: load }, '刷新'),
            ),
          ),
          rows.length === 0
            ? h('div', { className: 'cs-empty' }, '还没有待发布的条目。审核通过的条目会出现在这里。')
            : h('div', { className: 'cs-list' },
                rows.map(({ batch, item }) => h('div', {
                  key: item.id,
                  className: 'cs-batch-row',
                  style: { cursor: 'default' },
                },
                  h('div', { className: 'cs-row-main' },
                    h('span', { className: 'cs-row-title' }, item.title || item.id),
                    h(Badge, { tone: 'ok' }, '已通过'),
                    h('span', { className: 'cs-row-meta' }, platformLabel(platforms, batch.config?.platform)),
                    h('span', { className: 'cs-row-meta' }, item.durationSec ? `${item.durationSec.toFixed(1)}s` : ''),
                    h('span', { className: 'cs-row-meta' }, batch.title),
                  ),
                  h('button', {
                    className: 'cs-btn cs-btn-primary cs-btn-sm',
                    disabled: busy === item.id,
                    onClick: () => download(item),
                  }, busy === item.id ? '导出中…' : '导出发布包'),
                )),
              ),
        ),
      )
    }

    function SettingsPage({ platforms = [] }) {
      return h('div', { className: 'cs-stack' },
        h(ProvidersPage),
        h('div', { className: 'cs-card' },
          h('div', { className: 'cs-card-head' },
            h('h2', { className: 'cs-card-title' }, '平台预设'),
          ),
          h('p', { className: 'cs-muted' }, 'v1 复用同一组已验证规格；平台差异先只影响标题字数提示，后续可按平台调参。'),
          h('table', { className: 'cs-table' },
            h('thead', null,
              h('tr', null,
                h('th', null, '平台'),
                h('th', null, '画幅'),
                h('th', null, '目标时长'),
                h('th', null, '标题上限'),
                h('th', null, '封面'),
              ),
            ),
            h('tbody', null,
              platforms.map((platform) => h('tr', { key: platform.id },
                h('td', null, platform.label),
                h('td', null, platform.aspectRatio),
                h('td', null, `${platform.targetSec}s`),
                h('td', null, `${platform.titleMaxLength} 字`),
                h('td', null, `${platform.coverWidth}×${platform.coverHeight}`),
              )),
            ),
          ),
        ),
      )
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

    function CreateComposer({ platforms = [], services, onCreated, onAdjust, onPickDirectory }) {
      const [brief, setBrief] = useState('')
      const [dirs, setDirs] = useState('')
      const [parsing, setParsing] = useState(false)
      const [creating, setCreating] = useState(false)
      const [plan, setPlan] = useState(null)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState('')
      const [scanned, setScanned] = useState(null)

      const dirList = useMemo(
        () => dirs.split(/[\n;,]/).map((entry) => entry.trim()).filter(Boolean),
        [dirs],
      )

      const scan = async () => {
        if (dirList.length === 0) return
        setBusy('scan')
        setError('')
        try {
          const result = await api('POST', '/materials/scan', { dirs: dirList })
          setScanned(result)
        } catch (scanError) {
          setError(scanError.message)
        } finally {
          setBusy('')
        }
      }

      const parse = async () => {
        if (!brief.trim()) {
          setError('先用一句话描述你想生产什么')
          return
        }
        setParsing(true)
        setError('')
        setNotice(null)
        try {
          setPlan(await api('POST', '/batches/parse', { brief: brief.trim() }))
        } catch (parseError) {
          setError(parseError.message)
        } finally {
          setParsing(false)
        }
      }

      const confirm = async () => {
        if (!plan) return
        setCreating(true)
        setError('')
        try {
          if (dirList.length > 0) await api('POST', '/materials/scan', { dirs: dirList })
          const result = await api('POST', '/batches', {
            title: plan.config.topic || '新批次',
            count: plan.count,
            config: { ...plan.config, materialMode: 'pool' },
          })
          const warnings = result.preflight?.warnings || []
          setNotice({
            tone: warnings.length > 0 ? 'warning' : 'success',
            text: warnings.length > 0
              ? `已创建 ${result.batch.id}，注意：${warnings.join('；')}`
              : `已创建 ${result.batch.id}`,
          })
          setPlan(null)
          setBrief('')
          onCreated?.(result.batch)
        } catch (createError) {
          setError(createError.message)
        } finally {
          setCreating(false)
        }
      }

      const fact = (label, value) => h('span', { className: 'cs-plan-fact' },
        h('span', null, label),
        h('strong', null, String(value)),
      )

      return h('div', { className: 'cs-stack' },
        h('section', { className: 'cs-card cs-composer' },
          h('textarea', {
            className: 'cs-prompt-input',
            rows: 3,
            placeholder: '描述你想生产什么，例如：做 5 条秋日通勤穿搭，发抖音，每天 18:00 一条，预算 20 元',
            value: brief,
            onChange: (event) => setBrief(event.target.value),
          }),
          h('div', { className: 'cs-composer-meta' },
            h('input', {
              className: 'cs-input',
              placeholder: '素材目录（可稍后在高级设置里填）',
              value: dirs,
              onChange: (event) => setDirs(event.target.value),
            }),
            h('button', {
              className: 'cs-btn cs-btn-ghost cs-btn-sm',
              disabled: !onPickDirectory,
              onClick: () => onPickDirectory?.((picked) => {
                setDirs((current) => current.trim() ? `${current.trim()}\n${picked}` : picked)
              }),
            }, '选择目录'),
            h('button', {
              className: 'cs-btn cs-btn-outline cs-btn-sm',
              disabled: dirList.length === 0 || busy === 'scan',
              onClick: scan,
            }, busy === 'scan' ? '扫描中…' : '扫描素材'),
            scanned ? h('span', { className: 'cs-hint' }, `已索引 ${scanned.total} 个素材`) : null,
          ),
          h('div', { className: 'cs-composer-bar' },
            h('button', {
              className: 'cs-btn cs-btn-primary',
              disabled: parsing,
              onClick: parse,
            }, parsing ? 'AI 正在拆解…' : '让 AI 拆解'),
            h('button', {
              className: 'cs-btn cs-btn-ghost',
              disabled: !brief.trim(),
              onClick: () => onAdjust?.({
                topic: brief.trim(),
                dirs,
                materialMode: 'pool',
              }),
            }, '高级设置'),
            h('span', { className: 'cs-hint' }, '描述主题、条数、平台、发布时间、预算；没说到的会用默认值。'),
          ),
          error
            ? h('div', { className: 'cs-alert cs-alert-danger', role: 'alert' },
                h(AlertIcon),
                h('div', { className: 'cs-alert-body' },
                  h('p', { className: 'cs-alert-text' }, error),
                ),
              )
            : null,
          notice
            ? h('div', {
                className: `cs-alert ${notice.tone === 'warning' ? 'cs-alert-warning' : 'cs-alert-success'}`,
                role: 'status',
              },
                h(AlertIcon),
                h('div', { className: 'cs-alert-body' },
                  h('p', { className: 'cs-alert-text' }, notice.text),
                ),
              )
            : null,
        ),
        plan
          ? h('div', { className: 'cs-thread' },
              h('div', { className: 'cs-chat-user' }, brief),
              h('div', { className: 'cs-chat-ai' },
                h('div', { className: 'cs-chat-avatar' }, 'AI'),
                h('div', { className: 'cs-chat-body' },
                  h('div', { className: 'cs-row-main' },
                    h('span', { className: 'cs-card-title' }, '生产计划'),
                    h(Badge, { tone: 'info' }, plan.source === 'llm' ? 'AI 解析' : '本地解析'),
                  ),
                  h('p', { className: 'cs-muted' }, plan.plan.summary),
                  h('div', { className: 'cs-plan-facts' },
                    fact('平台', platformLabel(platforms, plan.config.platform)),
                    fact('条数', plan.count),
                    fact('时长', `${plan.config.targetSec}s`),
                    fact('审核', plan.config.reviewMode === 'auto' ? '自动放行' : '需人工审核'),
                    plan.config.publishStartAt
                      ? fact('发布时间', new Date(plan.config.publishStartAt).toLocaleString('zh-CN'))
                      : null,
                    fact('成本上限', plan.config.costCap ? `¥${plan.config.costCap}` : '不设'),
                  ),
                  plan.plan.assumptions?.length
                    ? h('ul', { className: 'cs-hint', style: { margin: 0, paddingLeft: 18 } },
                        plan.plan.assumptions.map((assumption, index) => h('li', { key: index }, assumption)))
                    : null,
                  plan.plan.warnings?.length
                    ? h('div', { className: 'cs-hint', style: { color: 'var(--cs-warn)' } }, plan.plan.warnings.join('；'))
                    : null,
                  h('div', { className: 'cs-actions' },
                    h('button', {
                      className: 'cs-btn cs-btn-primary cs-btn-sm',
                      disabled: creating,
                      onClick: confirm,
                    }, creating ? '创建中…' : '确认创建'),
                    h('button', {
                      className: 'cs-btn cs-btn-outline cs-btn-sm',
                      onClick: () => onAdjust?.({ ...plan.config, count: plan.count, dirs }),
                    }, '调整参数'),
                    h('button', {
                      className: 'cs-btn cs-btn-ghost cs-btn-sm',
                      onClick: () => setPlan(null),
                    }, '重新描述'),
                  ),
                ),
              ),
            )
          : null,
      )
    }

    /* ------------------------------------------------------------------ */
    /* 工作台                                                            */
    /* ------------------------------------------------------------------ */
    function Workbench({ services }) {
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
      const summary = [
        ['运行中', itemStatuses.filter((status) => status === 'running').length],
        ['待审核', itemStatuses.filter((status) => status === 'review_pending').length],
        ['失败', itemStatuses.filter((status) => status === 'failed').length],
        ['待发布', itemStatuses.filter((status) => status === 'approved').length],
      ]

      return h('div', { className: 'cs-page' },
        h('div', { className: 'cs-page-inner' },
        h('header', { className: 'cs-header' },
          h('div', null,
            h('h1', { className: 'cs-title' }, '内容生产 · 总控台'),
            h('p', { className: 'cs-subtitle' }, '批量生产：文案 → 配音 → 字幕 → 画面 → 渲染 → 封面 → 校验 → 审核/导出'),
          ),
          h('div', { className: 'cs-header-actions' },
            h('button', { className: 'cs-btn cs-btn-ghost', onClick: load }, '刷新'),
          ),
        ),
        error
          ? h('div', { className: 'cs-alert cs-alert-danger', role: 'alert' },
              h(AlertIcon),
              h('div', { className: 'cs-alert-body' },
                h('p', { className: 'cs-alert-text' }, `接口不可用：${error}`),
              ),
            )
          : null,
        h(Readiness, {
          health,
          onConfigure: () => setTab('settings'),
          onInstallFfmpeg: installFfmpeg,
          installing,
          installError,
        }),
        h('nav', { className: 'cs-tabs' },
          [['console', '总控台'], ['review', '审核'], ['ready', '待发布'], ['settings', '设置']].map(([key, label]) =>
            h('button', {
              key,
              className: `cs-tab${tab === key ? ' is-active' : ''}`,
              'aria-current': tab === key ? 'page' : undefined,
              onClick: () => setTab(key),
            }, label)),
        ),

        tab === 'console'
          ? h('div', { className: 'cs-stack' },
              h(CreateComposer, {
                key: composerKey,
                platforms,
                services,
                onPickDirectory: (onPick) => setPicker({ onPick }),
                onCreated: (batch) => {
                  setSelected(batch.id)
                  load()
                },
                onAdjust: (initial) => {
                  setAdvancedInitial(initial)
                  setShowAdvanced(true)
                },
              }),
              showAdvanced
                ? h('section', { className: 'cs-card' },
                    h('div', { className: 'cs-card-head' },
                      h('h2', { className: 'cs-card-title' }, '高级设置'),
                      h('button', {
                        className: 'cs-btn cs-btn-ghost cs-btn-sm',
                        onClick: () => setShowAdvanced(false),
                      }, '收起'),
                    ),
                    h(NewBatchForm, {
                      key: `advanced-${composerKey}-${advancedInitial?.topic || ''}`,
                      initial: advancedInitial,
                      groups,
                      health,
                      services,
                      platforms,
                      onPickDirectory: (onPick) => setPicker({ onPick }),
                      onCreated: (batch) => {
                        setSelected(batch.id)
                        setShowAdvanced(false)
                        setComposerKey((key) => key + 1)
                        load()
                      },
                    }),
                  )
                : null,
              h('section', { className: 'cs-card' },
                h('div', { className: 'cs-card-head' },
                  h('h2', { className: 'cs-card-title' }, '批次'),
                  h('div', { className: 'cs-card-actions' },
                    summary.map(([label, value]) => h('span', { key: label, className: 'cs-stat-inline' },
                      label, h('strong', null, String(value)))),
                  ),
                ),
                batches.length === 0
                  ? h('div', { className: 'cs-empty' }, '还没有批次。上面描述一句，或者点「高级设置」手动创建。')
                  : h('div', { className: 'cs-list' },
                      batches.map((batch) => {
                        const failed = (batch.items || []).filter((item) => item.status === 'failed').length
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
                            failed > 0 ? h(Badge, { tone: 'bad' }, `失败 ${failed}`) : null,
                          ),
                          h('span', { className: 'cs-row-meta' }, `${batch.items.length} 条 · ${new Date(batch.createdAt).toLocaleString('zh-CN')}`),
                        )
                      }),
                    ),
              ),
              selected ? h(BatchDetail, {
                batchId: selected,
                refreshKey: tick,
                platforms,
                onOpenReview: (itemId, queue) => {
                  const ids = Array.isArray(queue) && queue.length > 0 ? queue : [itemId]
                  setReviewQueue(ids)
                  setReviewIndex(Math.max(0, ids.indexOf(itemId)))
                  setTab('review')
                },
                onDeleted: () => { setSelected(null); setTick((n) => n + 1) },
              }) : null,
            )
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
                : h('div', { className: 'cs-card' },
                    h('div', { className: 'cs-empty' }, '从总控台的批次详情点「去审核」选择一条内容。')),
              h('div', { className: 'cs-actions' },
                reviewQueue.length > 0
                  ? h('button', {
                      className: 'cs-btn cs-btn-ghost cs-btn-sm',
                      onClick: () => { setReviewQueue([]); setReviewIndex(0) },
                    }, '关闭审核')
                  : null,
                h('span', { className: 'cs-hint' }, '快捷键：A 通过 · R 驳回 · ← → 翻页'),
              ),
            )
          : null,

        tab === 'ready' ? h(ReadyPage, { refreshKey: tick, platforms, onError: setError }) : null,

        tab === 'settings' ? h(SettingsPage, { platforms }) : null,

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
        Workbench, ProvidersPage, NewBatchForm, BatchDetail, ReviewCard,
        Readiness, UsageLine, StepStrip, CostBar, LogViewer, ReadyPage, SettingsPage, SidebarIcon, CreateComposer, DirectoryPicker,
      },
    }
  },
})
