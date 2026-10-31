import { formatPath } from '../diff'
import type { ActionMeta, Command, InspectorEvents, SessionExport, StoreInfo } from '../protocol'
import { envelope, isOwnMessage } from '../session'
import { getDefaultTransport, type Transport } from '../transport'
import {
  childrenOf,
  escapeHtml,
  formatDelta,
  formatTime,
  inline,
  nodeKind,
  summary,
} from './format'
import { css, STYLE_ID } from './styles'

export type Theme = 'light' | 'dark'
type Tab = 'state' | 'diff' | 'action'

export interface PanelOptions {
  transport?: Transport
  theme?: Theme
}

interface PanelStore {
  storeId: string
  name: string
  actions: Array<ActionMeta>
  currentId: number
  paused: boolean
  maxHistory: number
  dropped: number
  /** Serialized live state (the state at `currentId`). */
  state: unknown
}

const DEFAULT_OPEN_DEPTH = 1

/**
 * Host-agnostic panel. It only needs a DOM node and a Transport, so the same
 * widget can be mounted by TanStack Devtools, a Vite DevTools dock, a browser
 * extension page or a plain <div>.
 */
export class PanelView {
  readonly root: HTMLDivElement
  #transport: Transport
  #stores = new Map<string, PanelStore>()
  #storeOrder: Array<string> = []
  #selectedStore: string | null = null
  /** `null` = follow the latest/current action. */
  #selectedAction: number | null = null
  #tab: Tab = 'state'
  #filter = ''
  #showFunctions = false
  #toggles = new Map<string, boolean>()
  #snapshots = new Map<string, unknown>()
  #requested = new Set<string>()
  #disposers: Array<() => void> = []
  #frame: number | null = null
  #stickToBottom = true
  #renderedStoreKey = ''
  #disposed = false
  #el: {
    store: HTMLSelectElement
    status: HTMLSpanElement
    pause: HTMLButtonElement
    reset: HTMLButtonElement
    commit: HTMLButtonElement
    exportBtn: HTMLButtonElement
    importBtn: HTMLButtonElement
    file: HTMLInputElement
    filter: HTMLInputElement
    fns: HTMLInputElement
    scrubWrap: HTMLDivElement
    scrub: HTMLInputElement
    scrubLabel: HTMLSpanElement
    main: HTMLDivElement
    timeline: HTMLUListElement
    title: HTMLSpanElement
    sub: HTMLSpanElement
    jump: HTMLButtonElement
    tabs: HTMLDivElement
    body: HTMLDivElement
    empty: HTMLDivElement
  }

  constructor(host: HTMLElement, options: PanelOptions = {}) {
    this.#transport = options.transport ?? getDefaultTransport()
    ensureStyles(host)

    const root = document.createElement('div')
    root.className = 'zi-root'
    root.innerHTML = /* html */ `
      <div class="zi-toolbar" role="toolbar" aria-label="Zustand inspector controls">
        <span class="zi-status" title="Recording"><span class="zi-dot"></span></span>
        <select class="zi-select" aria-label="Store" data-ref="store"></select>
        <button class="zi-btn" data-ref="pause" title="Pause recording">Pause</button>
        <button class="zi-btn" data-ref="commit" title="Keep current state, clear history">Commit</button>
        <button class="zi-btn" data-ref="reset" title="Back to the initial state">Reset</button>
        <span class="zi-spacer"></span>
        <input class="zi-input" data-ref="filter" type="search" placeholder="Filter actions" aria-label="Filter actions" />
        <label class="zi-note" title="Show store actions (functions) in the state tree"><input type="checkbox" data-ref="fns" /> fns</label>
        <button class="zi-btn" data-ref="exportBtn" title="Download this store's history as JSON">Export</button>
        <button class="zi-btn" data-ref="importBtn" title="Load state from an exported JSON file">Import</button>
        <input type="file" accept="application/json,.json" data-ref="file" class="zi-hidden" />
      </div>
      <div class="zi-scrub" data-ref="scrubWrap">
        <span data-ref="scrubLabel"></span>
        <input type="range" min="0" max="0" value="0" step="1" data-ref="scrub" aria-label="Time travel" />
      </div>
      <div class="zi-main" data-ref="main">
        <ul class="zi-timeline" tabindex="0" aria-label="Actions" data-ref="timeline"></ul>
        <section class="zi-detail">
          <div class="zi-detail-head">
            <span class="zi-detail-title" data-ref="title"></span>
            <span class="zi-detail-sub" data-ref="sub"></span>
            <button class="zi-btn zi-primary" data-ref="jump" title="Restore the store to this action">Jump here</button>
            <div class="zi-tabs" role="tablist" data-ref="tabs">
              <button class="zi-tab" role="tab" data-tab="state">State</button>
              <button class="zi-tab" role="tab" data-tab="diff">Diff</button>
              <button class="zi-tab" role="tab" data-tab="action">Action</button>
            </div>
          </div>
          <div class="zi-body" data-ref="body"></div>
        </section>
      </div>
      <div class="zi-empty zi-hidden" data-ref="empty">
        <p><strong>No Zustand stores yet.</strong></p>
        <p>Wrap a store with <code>inspector(creator, { name })</code> or call <code>inspectStore(store, { name })</code>.</p>
      </div>
    `
    const ref = <T extends Element>(name: string) => root.querySelector(`[data-ref="${name}"]`) as T
    this.#el = {
      store: ref('store'),
      status: root.querySelector('.zi-status') as HTMLSpanElement,
      pause: ref('pause'),
      reset: ref('reset'),
      commit: ref('commit'),
      exportBtn: ref('exportBtn'),
      importBtn: ref('importBtn'),
      file: ref('file'),
      filter: ref('filter'),
      fns: ref('fns'),
      scrubWrap: ref('scrubWrap'),
      scrub: ref('scrub'),
      scrubLabel: ref('scrubLabel'),
      main: ref('main'),
      timeline: ref('timeline'),
      title: ref('title'),
      sub: ref('sub'),
      jump: ref('jump'),
      tabs: ref('tabs'),
      body: ref('body'),
      empty: ref('empty'),
    }
    this.root = root
    host.appendChild(root)
    this.setTheme(options.theme ?? 'dark')
    this.#bindDom()
    this.#bindTransport()

    // Late-mount sync: the page answers with a `store` event per recorder.
    this.#transport.reconnect?.()
    this.#transport.send('hello', envelope())
    this.render()
  }

  setTheme(theme: Theme): void {
    this.root.classList.toggle('zi-dark', theme === 'dark')
    this.root.classList.toggle('zi-light', theme !== 'dark')
  }

  /** Render synchronously (normally batched to the next animation frame). */
  render(): void {
    if (this.#disposed) return
    this.#frame = null
    const store = this.#currentStore()
    const hasStores = this.#storeOrder.length > 0
    this.#el.empty.classList.toggle('zi-hidden', hasStores)
    this.#el.main.classList.toggle('zi-hidden', !hasStores)
    this.#el.scrubWrap.classList.toggle('zi-hidden', !hasStores)
    this.#renderStoreSelect()
    this.#renderToolbar(store)
    if (!store) return
    this.#renderScrubber(store)
    this.#renderTimeline(store)
    this.#renderDetail(store)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#disposers.forEach((d) => d())
    this.#disposers = []
    if (this.#frame !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.#frame)
    }
    this.root.remove()
  }

  // ───────────────────────────── transport ─────────────────────────────

  #bindTransport(): void {
    const t = this.#transport
    const on = <K extends keyof InspectorEvents>(type: K, cb: (p: InspectorEvents[K]) => void) =>
      this.#disposers.push(
        t.on(type, (payload) => {
          if (this.#disposed || !isOwnMessage(payload)) return
          cb(payload)
        }),
      )

    on('store', (info) => this.#upsertStore(info))
    on('action', (msg) => {
      const store = this.#stores.get(msg.storeId)
      if (!store) return
      store.actions.push(msg.action)
      const overflow = store.actions.length - store.maxHistory
      if (overflow > 0) store.actions.splice(0, overflow)
      store.currentId = msg.currentId
      store.dropped = msg.dropped
      store.state = msg.state
      this.#snapshots.set(key(store.storeId, msg.currentId), msg.state)
      this.#schedule()
    })
    on('jumped', (msg) => {
      const store = this.#stores.get(msg.storeId)
      if (!store) return
      store.currentId = msg.currentId
      store.state = msg.state
      this.#snapshots.set(key(store.storeId, msg.currentId), msg.state)
      this.#schedule()
    })
    on('status', (msg) => {
      const store = this.#stores.get(msg.storeId)
      if (!store) return
      store.paused = msg.paused
      this.#schedule()
    })
    on('snapshot', (msg) => {
      const k = key(msg.storeId, msg.id)
      this.#requested.delete(k)
      this.#snapshots.set(k, msg.state)
      this.#schedule()
    })
    on('export', (msg) => downloadJson(msg.data))
    on('removed', (msg) => {
      this.#stores.delete(msg.storeId)
      this.#storeOrder = this.#storeOrder.filter((id) => id !== msg.storeId)
      if (this.#selectedStore === msg.storeId) {
        this.#selectedStore = this.#storeOrder[0] ?? null
        this.#selectedAction = null
      }
      this.#schedule()
    })
  }

  #upsertStore(info: StoreInfo): void {
    const isNew = !this.#stores.has(info.storeId)
    this.#stores.set(info.storeId, {
      storeId: info.storeId,
      name: info.name,
      actions: [...info.actions],
      currentId: info.currentId,
      paused: info.paused,
      maxHistory: info.maxHistory,
      dropped: info.dropped,
      state: info.state,
    })
    // A full description replaces history (reset/commit/HMR): drop stale snapshots.
    for (const k of [...this.#snapshots.keys()]) {
      if (k.startsWith(`${info.storeId}\u0000`)) this.#snapshots.delete(k)
    }
    this.#snapshots.set(key(info.storeId, info.currentId), info.state)
    if (isNew) this.#storeOrder.push(info.storeId)
    if (!this.#selectedStore) this.#selectedStore = info.storeId
    if (this.#selectedStore === info.storeId && this.#selectedAction !== null) {
      if (!info.actions.some((a) => a.id === this.#selectedAction)) this.#selectedAction = null
    }
    this.#schedule()
  }

  #command(command: Command): void {
    const store = this.#currentStore()
    if (!store) return
    this.#transport.send('command', { ...envelope(), storeId: store.storeId, command })
  }

  // ───────────────────────────── DOM events ─────────────────────────────

  #bindDom(): void {
    const el = this.#el
    const listen = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
    ) => {
      target.addEventListener(type, handler as EventListener)
      this.#disposers.push(() => target.removeEventListener(type, handler as EventListener))
    }

    listen(el.store, 'change', () => {
      this.#selectedStore = el.store.value
      this.#selectedAction = null
      this.#stickToBottom = true
      this.render()
    })
    listen(el.pause, 'click', () => {
      const store = this.#currentStore()
      if (store) this.#command({ type: store.paused ? 'resume' : 'pause' })
    })
    listen(el.reset, 'click', () => {
      this.#selectedAction = null
      this.#command({ type: 'reset' })
    })
    listen(el.commit, 'click', () => {
      this.#selectedAction = null
      this.#command({ type: 'commit' })
    })
    listen(el.exportBtn, 'click', () => this.#command({ type: 'export' }))
    listen(el.importBtn, 'click', () => el.file.click())
    listen(el.file, 'change', async () => {
      const file = el.file.files?.[0]
      el.file.value = ''
      if (!file) return
      try {
        const data = JSON.parse(await file.text())
        const state = isSessionExport(data) ? data.entries.at(-1)?.state : data
        if (state !== undefined) this.#command({ type: 'import', state })
      } catch (error) {
        console.warn('[zustand-inspector] could not import file', error)
      }
    })
    listen(el.filter, 'input', () => {
      this.#filter = el.filter.value.trim().toLowerCase()
      this.render()
    })
    listen(el.fns, 'change', () => {
      this.#showFunctions = el.fns.checked
      this.render()
    })

    let scrubFrame: number | null = null
    listen(el.scrub, 'input', () => {
      const store = this.#currentStore()
      if (!store) return
      const action = store.actions[Number(el.scrub.value)]
      if (!action) return
      this.#selectedAction = null
      if (scrubFrame !== null) return
      scrubFrame = requestFrame(() => {
        scrubFrame = null
        const latest = this.#currentStore()?.actions[Number(el.scrub.value)]
        if (latest) this.#command({ type: 'jump', toId: latest.id })
      })
    })

    listen(el.timeline, 'scroll', () => {
      const t = el.timeline
      this.#stickToBottom = t.scrollTop + t.clientHeight >= t.scrollHeight - 4
    })
    listen(el.timeline, 'click', (e) => {
      const target = e.target as HTMLElement
      const row = target.closest<HTMLElement>('.zi-row')
      if (!row) return
      const id = Number(row.dataset.id)
      if (target.closest('.zi-jump')) {
        this.#command({ type: 'jump', toId: id })
        return
      }
      this.#select(id)
    })
    listen(el.timeline, 'dblclick', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.zi-row')
      if (row) this.#command({ type: 'jump', toId: Number(row.dataset.id) })
    })
    listen(el.timeline, 'keydown', (e) => {
      const store = this.#currentStore()
      if (!store) return
      const visible = this.#visibleActions(store)
      if (visible.length === 0) return
      const current = this.#selectedAction ?? store.currentId
      const index = visible.findIndex((a) => a.id === current)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const next = visible[Math.min(visible.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)))]
        if (next) this.#select(next.id)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        this.#command({ type: 'jump', toId: current })
      } else if (e.key === 'Escape') {
        this.#selectedAction = null
        this.render()
      }
    })
    listen(el.jump, 'click', () => {
      const store = this.#currentStore()
      if (store) this.#command({ type: 'jump', toId: this.#selectedAction ?? store.currentId })
    })
    listen(el.tabs, 'click', (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined
      if (!tab) return
      this.#tab = tab
      this.render()
    })
    listen(el.body, 'click', (e) => {
      const toggle = (e.target as HTMLElement).closest<HTMLElement>('[data-toggle]')
      if (!toggle) return
      const path = toggle.dataset.toggle!
      const depth = Number(toggle.dataset.depth)
      this.#toggles.set(path, !this.#isOpen(path, depth))
      this.render()
    })
  }

  #select(id: number): void {
    const store = this.#currentStore()
    this.#selectedAction = store && id === store.actions.at(-1)?.id && id === store.currentId ? null : id
    this.render()
  }

  // ───────────────────────────── rendering ─────────────────────────────

  #schedule(): void {
    if (this.#frame !== null || this.#disposed) return
    this.#frame = requestFrame(() => this.render())
  }

  #currentStore(): PanelStore | undefined {
    return this.#selectedStore ? this.#stores.get(this.#selectedStore) : undefined
  }

  #renderStoreSelect(): void {
    const signature = this.#storeOrder.map((id) => `${id}:${this.#stores.get(id)?.name}`).join('|')
    if (signature !== this.#renderedStoreKey) {
      this.#renderedStoreKey = signature
      this.#el.store.innerHTML = this.#storeOrder
        .map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(this.#stores.get(id)!.name)}</option>`)
        .join('')
    }
    if (this.#selectedStore) this.#el.store.value = this.#selectedStore
    this.#el.store.disabled = this.#storeOrder.length === 0
  }

  #renderToolbar(store: PanelStore | undefined): void {
    const el = this.#el
    const paused = !!store?.paused
    this.root.classList.toggle('zi-paused', paused)
    el.status.title = paused ? 'Recording paused' : 'Recording'
    el.pause.textContent = paused ? 'Resume' : 'Pause'
    el.pause.classList.toggle('zi-on', paused)
    for (const button of [el.pause, el.reset, el.commit, el.exportBtn, el.importBtn]) {
      button.disabled = !store
    }
  }

  #renderScrubber(store: PanelStore): void {
    const index = Math.max(0, store.actions.findIndex((a) => a.id === store.currentId))
    this.#el.scrub.max = String(Math.max(0, store.actions.length - 1))
    this.#el.scrub.value = String(index)
    this.#el.scrub.disabled = store.actions.length < 2
    const atLatest = store.currentId === store.actions.at(-1)?.id
    this.#el.scrubLabel.textContent = `${index + 1} / ${store.actions.length}${atLatest ? '' : ' · time travelling'}`
  }

  #visibleActions(store: PanelStore): Array<ActionMeta> {
    if (!this.#filter) return store.actions
    return store.actions.filter((a) => a.name.toLowerCase().includes(this.#filter))
  }

  #renderTimeline(store: PanelStore): void {
    const t = this.#el.timeline
    const visible = this.#visibleActions(store)
    const first = store.actions[0]?.ts ?? 0
    const selected = this.#selectedAction ?? store.currentId
    const currentIndex = store.actions.findIndex((a) => a.id === store.currentId)
    const futureFrom = store.actions[currentIndex + 1]?.id ?? Infinity

    const head = store.dropped
      ? `<li class="zi-dropped">${store.dropped} older action${store.dropped === 1 ? '' : 's'} dropped (maxHistory ${store.maxHistory})</li>`
      : ''
    t.innerHTML =
      head +
      visible
        .map((a) => {
          const classes = ['zi-row']
          if (a.id === store.currentId) classes.push('zi-current')
          if (a.id === selected) classes.push('zi-selected')
          if (a.id >= futureFrom) classes.push('zi-future')
          const tag = a.source === 'app' ? '' : `<span class="zi-tag">${a.source}</span>`
          return `<li class="${classes.join(' ')}" data-id="${a.id}" title="${escapeHtml(formatTime(a.ts))}">
            <span class="zi-id">#${a.id}</span>
            <span class="zi-name">${escapeHtml(a.name)}${tag}</span>
            <span class="zi-time">${a.id === store.actions[0]?.id ? formatTime(a.ts).slice(0, 8) : formatDelta(a.ts - first)}</span>
            <button class="zi-jump" title="Jump to this state" aria-label="Jump to #${a.id}">⤺</button>
          </li>`
        })
        .join('') +
      (visible.length === 0 ? '<li class="zi-dropped">No matching actions</li>' : '')

    if (this.#stickToBottom && this.#selectedAction === null) t.scrollTop = t.scrollHeight
    else t.querySelector('.zi-selected')?.scrollIntoView?.({ block: 'nearest' })
  }

  #renderDetail(store: PanelStore): void {
    const el = this.#el
    const id = this.#selectedAction ?? store.currentId
    const action = store.actions.find((a) => a.id === id)
    for (const tab of el.tabs.querySelectorAll<HTMLElement>('[data-tab]')) {
      tab.classList.toggle('zi-active', tab.dataset.tab === this.#tab)
      tab.setAttribute('aria-selected', String(tab.dataset.tab === this.#tab))
    }
    if (!action) {
      el.title.textContent = ''
      el.sub.textContent = ''
      el.jump.disabled = true
      el.body.innerHTML = '<p class="zi-note">Select an action.</p>'
      return
    }
    el.title.textContent = `#${action.id} ${action.name}`
    el.sub.textContent = formatTime(action.ts) + (action.id === store.currentId ? ' · current' : '')
    el.jump.disabled = action.id === store.currentId

    const scroll = el.body.scrollTop
    if (this.#tab === 'state') el.body.innerHTML = this.#stateHtml(store, action)
    else if (this.#tab === 'diff') el.body.innerHTML = this.#diffHtml(action)
    else el.body.innerHTML = this.#tree(actionInfo(action), `action\u0000${action.id}`)
    el.body.scrollTop = scroll
  }

  #stateHtml(store: PanelStore, action: ActionMeta): string {
    const k = key(store.storeId, action.id)
    let state: unknown
    if (action.id === store.currentId) state = store.state
    else if (this.#snapshots.has(k)) state = this.#snapshots.get(k)
    else {
      if (!this.#requested.has(k)) {
        this.#requested.add(k)
        this.#command({ type: 'snapshot', id: action.id })
      }
      return '<p class="zi-note">Loading snapshot…</p>'
    }
    return this.#tree(state, `state\u0000${store.storeId}`)
  }

  #diffHtml(action: ActionMeta): string {
    if (action.source === 'init') return '<p class="zi-note">Initial state. Nothing to compare with.</p>'
    const changes = action.changes ?? []
    if (changes.length === 0) {
      return action.changes
        ? '<p class="zi-note">No changes: this action set the same values (a re-render may still have happened).</p>'
        : '<p class="zi-note">Diffs are disabled for this store.</p>'
    }
    const items = changes
      .filter((c) => this.#showFunctions || !isFnChange(c.from, c.to))
      .map((c) => {
        const values =
          c.kind === 'added'
            ? inline(c.to)
            : c.kind === 'removed'
              ? `<span class="zi-from">${inline(c.from)}</span>`
              : `<span class="zi-from">${inline(c.from)}</span><span class="zi-arrow">→</span>${inline(c.to)}`
        return `<li class="zi-change">
          <span class="zi-badge zi-${c.kind}">${c.kind}</span>
          <div><div class="zi-change-path">${escapeHtml(formatPath(c.path))}</div><div class="zi-change-values">${values}</div></div>
        </li>`
      })
      .join('')
    const more = action.changesTruncated ? '<p class="zi-note">Diff truncated after 200 changes.</p>' : ''
    return `<ul class="zi-changes">${items}</ul>${more}`
  }

  #isOpen(path: string, depth: number): boolean {
    return this.#toggles.get(path) ?? depth < DEFAULT_OPEN_DEPTH
  }

  #tree(value: unknown, rootPath: string): string {
    const kind = nodeKind(value)
    if (kind === 'leaf') return `<div>${inline(value, 400)}</div>`
    const children = childrenOf(value, this.#showFunctions)
    if (children.length === 0) return `<div>${summary(value, this.#showFunctions)}</div>`
    return `<ul class="zi-tree">${children.map((c) => this.#node(c.keyHtml, c.value, `${rootPath}/${c.key}`, 0)).join('')}</ul>`
  }

  #node(keyHtml: string, value: unknown, path: string, depth: number): string {
    const kind = nodeKind(value)
    if (kind === 'leaf') {
      return `<li class="zi-node"><div class="zi-line"><span class="zi-toggle-spacer"></span>${keyHtml}${inline(value)}</div></li>`
    }
    const children = childrenOf(value, this.#showFunctions)
    const open = children.length > 0 && this.#isOpen(path, depth)
    const toggle =
      children.length > 0
        ? `<button class="zi-toggle" data-toggle="${escapeHtml(path)}" data-depth="${depth}" aria-expanded="${open}">${open ? '▼' : '▶'}</button>`
        : '<span class="zi-toggle-spacer"></span>'
    const body = open
      ? `<ul class="zi-tree">${children.map((c) => this.#node(c.keyHtml, c.value, `${path}/${c.key}`, depth + 1)).join('')}</ul>`
      : ''
    const label = open ? summary(value, this.#showFunctions) : inline(value)
    return `<li class="zi-node"><div class="zi-line">${toggle}${keyHtml}${label}</div>${body}</li>`
  }
}

function key(storeId: string, id: number): string {
  return `${storeId}\u0000${id}`
}

function isFnChange(from: unknown, to: unknown): boolean {
  const isFn = (v: unknown) => typeof v === 'object' && v !== null && (v as { $t?: string }).$t === 'function'
  return (from === undefined || isFn(from)) && (to === undefined || isFn(to))
}

function actionInfo(action: ActionMeta): Record<string, unknown> {
  const info: Record<string, unknown> = {
    id: action.id,
    name: action.name,
    source: action.source,
    time: new Date(action.ts).toISOString(),
    changes: action.changes?.length ?? 0,
  }
  if (action.payload !== undefined) info.payload = action.payload
  return info
}

function isSessionExport(data: unknown): data is SessionExport {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as SessionExport).format === 'zustand-inspector-session' &&
    Array.isArray((data as SessionExport).entries)
  )
}

function downloadJson(data: SessionExport): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date(data.exportedAt).toISOString().replace(/[:.]/g, '-')
  a.href = url
  a.download = `${data.name}-${stamp}.zustand.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function requestFrame(cb: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb)
  return setTimeout(cb, 16) as unknown as number
}

function ensureStyles(host: HTMLElement): void {
  const rootNode = host.getRootNode() as Document | ShadowRoot
  const container = rootNode instanceof Document ? rootNode.head : rootNode
  if (!container || container.querySelector?.(`#${STYLE_ID}`)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = css
  container.appendChild(style)
}

/** Mount the panel anywhere (a plain div, a Vite DevTools dock, an extension page). */
export function mountInspector(host: HTMLElement, options: PanelOptions = {}): PanelView {
  return new PanelView(host, options)
}
