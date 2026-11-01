export const STYLE_ID = 'zustand-inspector-styles'

export const css = /* css */ `
.zi-root {
  --zi-bg: #ffffff;
  --zi-bg-alt: #f6f7f9;
  --zi-bg-hover: #eef1f5;
  --zi-bg-active: #e3ecff;
  --zi-border: #e2e5ea;
  --zi-fg: #1f2329;
  --zi-muted: #6b7280;
  --zi-accent: #3b6cf6;
  --zi-accent-fg: #ffffff;
  --zi-current: #0e9f6e;
  --zi-warn: #b45309;
  --zi-danger: #c2410c;
  --zi-str: #b5420f;
  --zi-num: #1d4ed8;
  --zi-bool: #7c3aed;
  --zi-key: #0f5d8c;
  --zi-fn: #8a6d00;
  --zi-added-bg: #e7f6ec;
  --zi-added-fg: #116329;
  --zi-removed-bg: #fdeceb;
  --zi-removed-fg: #a1260d;
  --zi-changed-bg: #fff6e0;
  --zi-changed-fg: #8a5a00;
  --zi-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --zi-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;

  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  width: 100%;
  background: var(--zi-bg);
  color: var(--zi-fg);
  font: 12px/1.45 var(--zi-sans);
}
.zi-root.zi-dark {
  --zi-bg: #141518;
  --zi-bg-alt: #1b1d21;
  --zi-bg-hover: #23262c;
  --zi-bg-active: #1f2c4a;
  --zi-border: #2b2e35;
  --zi-fg: #e4e6ea;
  --zi-muted: #8b919c;
  --zi-accent: #6d8cff;
  --zi-accent-fg: #0b0c0e;
  --zi-current: #34d399;
  --zi-warn: #f59e0b;
  --zi-danger: #fb923c;
  --zi-str: #f0a172;
  --zi-num: #8cb4ff;
  --zi-bool: #c4a1ff;
  --zi-key: #7cc7e8;
  --zi-fn: #e6c65c;
  --zi-added-bg: #12301f;
  --zi-added-fg: #6ee7a0;
  --zi-removed-bg: #3a1a14;
  --zi-removed-fg: #fca58a;
  --zi-changed-bg: #34290f;
  --zi-changed-fg: #f6cf72;
}
.zi-root *, .zi-root *::before, .zi-root *::after { box-sizing: border-box; }
.zi-root button, .zi-root input, .zi-root select { font: inherit; color: inherit; }

.zi-toolbar {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 6px 8px; border-bottom: 1px solid var(--zi-border); background: var(--zi-bg-alt);
}
.zi-toolbar .zi-spacer { flex: 1 1 auto; }
.zi-select, .zi-input {
  height: 26px; padding: 0 8px; border: 1px solid var(--zi-border); border-radius: 6px;
  background: var(--zi-bg);
}
.zi-input { min-width: 120px; width: 160px; }
.zi-btn {
  display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 9px;
  border: 1px solid var(--zi-border); border-radius: 6px; background: var(--zi-bg); cursor: pointer;
  white-space: nowrap;
}
.zi-btn:hover:not(:disabled) { background: var(--zi-bg-hover); }
.zi-btn:disabled { opacity: .45; cursor: default; }
.zi-btn.zi-on { border-color: var(--zi-warn); color: var(--zi-warn); }
.zi-btn.zi-primary { background: var(--zi-accent); border-color: var(--zi-accent); color: var(--zi-accent-fg); }
.zi-btn:focus-visible, .zi-select:focus-visible, .zi-input:focus-visible, .zi-timeline:focus-visible {
  outline: 2px solid var(--zi-accent); outline-offset: 1px;
}
.zi-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--zi-current); display: inline-block; }
.zi-paused .zi-dot { background: var(--zi-warn); }

.zi-scrub {
  display: flex; align-items: center; gap: 8px; padding: 4px 10px;
  border-bottom: 1px solid var(--zi-border); color: var(--zi-muted);
}
.zi-scrub input[type=range] { flex: 1; accent-color: var(--zi-accent); }

.zi-main { display: flex; flex: 1 1 auto; min-height: 0; }
.zi-timeline {
  flex: 0 0 38%; max-width: 420px; min-width: 200px; overflow: auto;
  border-right: 1px solid var(--zi-border); margin: 0; padding: 4px 0; list-style: none;
}
.zi-row {
  display: grid; grid-template-columns: 34px 1fr auto 22px; align-items: center; gap: 6px;
  padding: 3px 8px 3px 10px; cursor: pointer; border-left: 2px solid transparent;
}
.zi-row:hover { background: var(--zi-bg-hover); }
.zi-row.zi-selected { background: var(--zi-bg-active); }
.zi-row.zi-current { border-left-color: var(--zi-current); }
.zi-row.zi-future { opacity: .5; }
.zi-row .zi-id { color: var(--zi-muted); font: 11px var(--zi-mono); }
.zi-row .zi-name { font-family: var(--zi-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zi-row .zi-time { color: var(--zi-muted); font: 11px var(--zi-mono); }
.zi-row .zi-jump {
  visibility: hidden; width: 22px; height: 20px; padding: 0; border: 0; border-radius: 4px;
  background: transparent; cursor: pointer; color: var(--zi-accent);
}
.zi-row:hover .zi-jump, .zi-row.zi-selected .zi-jump { visibility: visible; }
.zi-row .zi-jump:hover { background: var(--zi-bg-hover); }
.zi-row.zi-current .zi-jump { visibility: hidden; }
.zi-tag {
  display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 4px; font: 10px var(--zi-sans);
  background: var(--zi-bg-hover); color: var(--zi-muted); vertical-align: 1px;
}
.zi-dropped { padding: 4px 10px; color: var(--zi-muted); font-size: 11px; }

.zi-detail { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
.zi-detail-head {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 6px 10px;
  border-bottom: 1px solid var(--zi-border);
}
.zi-detail-heading { display: flex; flex: 1 1 220px; align-items: baseline; gap: 8px; min-width: 0; }
.zi-detail-title {
  font-family: var(--zi-mono); font-weight: 600; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.zi-detail-sub { flex: none; color: var(--zi-muted); font: 11px var(--zi-mono); white-space: nowrap; }
.zi-current-chip {
  flex: none; padding: 0 6px; border-radius: 4px; font: 10px/18px var(--zi-sans); letter-spacing: .03em;
  text-transform: uppercase; color: var(--zi-current); background: var(--zi-bg-hover);
}
.zi-detail-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.zi-tabs { display: flex; gap: 2px; }
.zi-tab {
  height: 24px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; color: var(--zi-muted);
}
.zi-tab:hover { background: var(--zi-bg-hover); }
.zi-tab.zi-active { background: var(--zi-bg-active); color: var(--zi-fg); }
.zi-body { flex: 1 1 auto; overflow: auto; padding: 8px 10px 16px; font: 12px/1.6 var(--zi-mono); }

.zi-tree { margin: 0; padding: 0; list-style: none; }
.zi-tree .zi-tree { padding-left: 16px; }
.zi-node > .zi-line { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; min-width: 0; }
.zi-line > .zi-key, .zi-line > .zi-index, .zi-line > .zi-mapkey, .zi-line > .zi-arrow,
.zi-line > .zi-toggle, .zi-line > .zi-toggle-spacer { flex: none; }
.zi-val { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.zi-toggle {
  width: 14px; padding: 0; border: 0; background: transparent; cursor: pointer; color: var(--zi-muted);
  font-size: 10px; line-height: 1;
}
.zi-toggle-spacer { display: inline-block; width: 14px; }
.zi-key { color: var(--zi-key); }
.zi-key::after, .zi-index::after { content: ":"; color: var(--zi-muted); }
.zi-index { color: var(--zi-muted); }
.zi-mapkey { color: var(--zi-key); }
.zi-arrow { color: var(--zi-muted); }
.zi-str { color: var(--zi-str); }
.zi-num { color: var(--zi-num); }
.zi-bool { color: var(--zi-bool); }
.zi-null, .zi-muted { color: var(--zi-muted); }
.zi-fn { color: var(--zi-fn); }
.zi-date, .zi-type { color: var(--zi-bool); }
.zi-error { color: var(--zi-danger); }
.zi-redacted { color: var(--zi-warn); font-style: italic; }

.zi-changes { margin: 0; padding: 0; list-style: none; }
.zi-change { display: grid; grid-template-columns: 64px 1fr; gap: 8px; padding: 4px 0; border-bottom: 1px dashed var(--zi-border); }
.zi-badge { align-self: start; text-align: center; border-radius: 4px; font: 10px/18px var(--zi-sans); text-transform: uppercase; letter-spacing: .03em; }
.zi-badge.zi-added { background: var(--zi-added-bg); color: var(--zi-added-fg); }
.zi-badge.zi-removed { background: var(--zi-removed-bg); color: var(--zi-removed-fg); }
.zi-badge.zi-changed { background: var(--zi-changed-bg); color: var(--zi-changed-fg); }
.zi-change-path { font-weight: 600; }
.zi-change-values { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.zi-from { text-decoration: line-through; text-decoration-color: var(--zi-removed-fg); opacity: .8; }

.zi-empty {
  margin: auto; max-width: 420px; padding: 24px; text-align: center; color: var(--zi-muted); font-family: var(--zi-sans);
}
.zi-empty code { font-family: var(--zi-mono); color: var(--zi-fg); }
.zi-note { color: var(--zi-muted); font-family: var(--zi-sans); }
.zi-hidden, .zi-root [hidden] { display: none !important; }

.zi-check { display: inline-flex; align-items: center; gap: 4px; }
.zi-check input { margin: 0; }

/* Narrow panes (phones, split panes): stack timeline over detail and let the
   whole panel scroll, instead of squeezing both into a short pane. */
.zi-root.zi-narrow { overflow-y: auto; }
.zi-narrow .zi-main { flex: none; flex-direction: column; }
.zi-narrow .zi-timeline {
  flex: none; max-width: none; min-width: 0; max-height: 220px;
  border-right: 0; border-bottom: 1px solid var(--zi-border);
}
.zi-narrow .zi-detail { flex: none; }
.zi-narrow .zi-body { flex: none; overflow: visible; overflow-x: auto; }
.zi-narrow .zi-input { flex: 1 1 140px; width: auto; }
.zi-narrow .zi-toolbar .zi-spacer { display: none; }
`
