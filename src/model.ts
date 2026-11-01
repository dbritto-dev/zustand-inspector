import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Path } from './analysis'
import type { ActionMeta, Command, InspectorEvents, SessionExport, StoreInfo } from './protocol'
import { envelope, isOwnMessage } from './session'
import { getDefaultTransport, type Transport } from './transport'

/**
 * Panel-side state, independent of any UI framework. It listens to the
 * transport, keeps what the panel needs to render, and sends commands back.
 * The Astryx (React) panel reads it with `useStore`; other UIs can subscribe.
 */

export type PanelTab = 'state' | 'diff' | 'action'

/** Which actions the list shows, by cost. */
export type CostFilter = 'all' | 'slow' | 'wasted'

export interface PanelStoreData {
  storeId: string
  name: string
  actions: Array<ActionMeta>
  currentId: number
  paused: boolean
  maxHistory: number
  dropped: number
  /** Serialized state at `currentId`. */
  state: unknown
}

export interface PanelState {
  stores: Record<string, PanelStoreData>
  order: Array<string>
  selectedStore: string | null
  /** `null` follows the store's current action. */
  selectedAction: number | null
  tab: PanelTab
  filter: string
  showFunctions: boolean
  /** Serialized snapshots by `${storeId}\0${actionId}`. */
  snapshots: Record<string, unknown>
  /** Path selected in the state tree: its history shows above the tree. */
  selectedPath: Path | null
  /** Pinned path: the action list, state and diff narrow to it. */
  pinnedPath: Path | null
  /** Range comparison: diff from this action to the selected one. */
  compareFrom: number | null
  /** Compare mode: which end of the comparison the next click picks. */
  comparePick: 'from' | 'to' | null
  /** Selected async group (see `groupAsyncActions`): its whole call is diffed. */
  selectedGroup: string | null
  costFilter: CostFilter
  /** Search inside the state tree (keys and values). */
  stateSearch: string
}

export interface PanelModel {
  store: StoreApi<PanelState>
  /** Send a command for the selected store. */
  command(command: Command): void
  selectStore(storeId: string): void
  selectAction(id: number | null): void
  setTab(tab: PanelTab): void
  setFilter(filter: string): void
  setShowFunctions(show: boolean): void
  selectPath(path: Path | null): void
  pinPath(path: Path | null): void
  /** Select `id` and compare it with the action selected before (shift-click). */
  selectRange(id: number): void
  clearCompare(): void
  /** Enter compare mode: the next click picks the initial state, the one after it the final state. */
  startCompare(): void
  /** Use `id` for the end of the comparison being picked. */
  pickCompare(id: number): void
  /** Select an async group: diff from the state before it started (`fromId`) to its last action (`toId`). */
  selectGroup(groupId: string, fromId: number, toId: number): void
  setCostFilter(filter: CostFilter): void
  setStateSearch(query: string): void
  /** Ask the page for a snapshot once; returns it when already known. */
  snapshot(storeId: string, id: number): unknown | undefined
  /** Called with each session export the page sends back. */
  onExport(cb: (data: SessionExport) => void): () => void
  dispose(): void
}

export function snapshotKey(storeId: string, id: number): string {
  return `${storeId}\u0000${id}`
}

export function createPanelModel(transport: Transport = getDefaultTransport()): PanelModel {
  const store = createStore<PanelState>()(() => ({
    stores: {},
    order: [],
    selectedStore: null,
    selectedAction: null,
    tab: 'state',
    filter: '',
    showFunctions: false,
    snapshots: {},
    selectedPath: null,
    pinnedPath: null,
    compareFrom: null,
    comparePick: null,
    selectedGroup: null,
    costFilter: 'all',
    stateSearch: '',
  }))
  const requested = new Set<string>()
  const exportListeners = new Set<(data: SessionExport) => void>()
  const disposers: Array<() => void> = []
  let disposed = false

  const on = <K extends keyof InspectorEvents>(type: K, cb: (payload: InspectorEvents[K]) => void) => {
    disposers.push(
      transport.on(type, (payload) => {
        if (!disposed && isOwnMessage(payload)) cb(payload)
      }),
    )
  }

  const updateStore = (storeId: string, patch: (s: PanelStoreData) => Partial<PanelStoreData>) => {
    const current = store.getState().stores[storeId]
    if (!current) return false
    store.setState((s) => ({ stores: { ...s.stores, [storeId]: { ...current, ...patch(current) } } }))
    return true
  }

  const upsert = (info: StoreInfo) => {
    store.setState((s) => {
      const isNew = !s.stores[info.storeId]
      // A full description replaces history (register, reset, commit, HMR): drop stale snapshots.
      const snapshots: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(s.snapshots)) {
        if (!k.startsWith(`${info.storeId}\u0000`)) snapshots[k] = v
      }
      snapshots[snapshotKey(info.storeId, info.currentId)] = info.state
      for (const k of [...requested]) if (k.startsWith(`${info.storeId}\u0000`)) requested.delete(k)
      const selectedStore = s.selectedStore ?? info.storeId
      const keepAction =
        selectedStore !== info.storeId ||
        s.selectedAction === null ||
        info.actions.some((a) => a.id === s.selectedAction)
      return {
        stores: {
          ...s.stores,
          [info.storeId]: {
            storeId: info.storeId,
            name: info.name,
            actions: [...info.actions],
            currentId: info.currentId,
            paused: info.paused,
            maxHistory: info.maxHistory,
            dropped: info.dropped,
            state: info.state,
          },
        },
        order: isNew ? [...s.order, info.storeId] : s.order,
        selectedStore,
        selectedAction: keepAction ? s.selectedAction : null,
        ...(selectedStore === info.storeId && s.compareFrom !== null && !info.actions.some((a) => a.id === s.compareFrom)
          ? { compareFrom: null, comparePick: null, selectedGroup: null }
          : {}),
        snapshots,
      }
    })
  }

  on('store', upsert)
  on('action', (msg) => {
    const branch = msg.action.branch
    const ok = updateStore(msg.storeId, (s) => {
      // A branch discards the actions after the state it started from.
      const kept = branch ? s.actions.filter((a) => a.id <= branch.fromId) : s.actions
      const actions = [...kept, msg.action]
      const overflow = actions.length - s.maxHistory
      if (overflow > 0) actions.splice(0, overflow)
      return { actions, currentId: msg.currentId, dropped: msg.dropped, state: msg.state }
    })
    if (ok) {
      store.setState((s) => {
        const keepSelection =
          !branch || s.selectedStore !== msg.storeId || s.selectedAction === null || s.selectedAction <= branch.fromId
        return {
          selectedAction: keepSelection ? s.selectedAction : null,
          ...(branch && s.selectedStore === msg.storeId && s.compareFrom !== null && s.compareFrom > branch.fromId
            ? { compareFrom: null, comparePick: null, selectedGroup: null }
            : {}),
          snapshots: { ...s.snapshots, [snapshotKey(msg.storeId, msg.currentId)]: msg.state },
        }
      })
    }
  })
  on('jumped', (msg) => {
    const ok = updateStore(msg.storeId, () => ({ currentId: msg.currentId, state: msg.state }))
    if (ok) {
      store.setState((s) => ({
        snapshots: { ...s.snapshots, [snapshotKey(msg.storeId, msg.currentId)]: msg.state },
      }))
    }
  })
  on('status', (msg) => updateStore(msg.storeId, () => ({ paused: msg.paused })))
  on('snapshot', (msg) => {
    const k = snapshotKey(msg.storeId, msg.id)
    requested.delete(k)
    store.setState((s) => ({ snapshots: { ...s.snapshots, [k]: msg.state } }))
  })
  on('export', (msg) => exportListeners.forEach((cb) => cb(msg.data)))
  on('removed', (msg) => {
    store.setState((s) => {
      const { [msg.storeId]: _removed, ...stores } = s.stores
      const order = s.order.filter((id) => id !== msg.storeId)
      const reselect = s.selectedStore === msg.storeId
      return {
        stores,
        order,
        selectedStore: reselect ? (order[0] ?? null) : s.selectedStore,
        selectedAction: reselect ? null : s.selectedAction,
      }
    })
  })

  const send = (storeId: string, command: Command) =>
    transport.send('command', { ...envelope(), storeId, command })

  const model: PanelModel = {
    store,
    command(command) {
      const { selectedStore } = store.getState()
      if (!selectedStore) return
      if (command.type === 'reset' || command.type === 'commit') {
        store.setState({ selectedAction: null, compareFrom: null, comparePick: null, selectedGroup: null })
      }
      send(selectedStore, command)
    },
    selectStore(storeId) {
      // Paths and ranges belong to one store's shape and history.
      store.setState({
        selectedStore: storeId,
        selectedAction: null,
        selectedPath: null,
        pinnedPath: null,
        compareFrom: null,
        comparePick: null,
        selectedGroup: null,
        stateSearch: '',
      })
    },
    selectAction(id) {
      const s = store.getState()
      const data = s.selectedStore ? s.stores[s.selectedStore] : undefined
      // Selecting the latest action while it is current means "follow live".
      const follow = data && id === data.currentId && id === data.actions.at(-1)?.id
      store.setState({ selectedAction: follow ? null : id, compareFrom: null, comparePick: null, selectedGroup: null })
    },
    selectRange(id) {
      const s = store.getState()
      const data = s.selectedStore ? s.stores[s.selectedStore] : undefined
      if (!data) return
      const anchor = s.selectedAction ?? data.currentId
      if (anchor === id) return
      store.setState({ compareFrom: anchor, selectedAction: id, comparePick: null, selectedGroup: null, tab: 'diff' })
    },
    clearCompare() {
      store.setState({ compareFrom: null, comparePick: null, selectedGroup: null })
    },
    startCompare() {
      store.setState({ comparePick: 'from', compareFrom: null, selectedGroup: null })
    },
    pickCompare(id) {
      const s = store.getState()
      if (s.comparePick === 'from') {
        store.setState({ compareFrom: id, comparePick: 'to', selectedGroup: null })
      } else if (s.comparePick === 'to' && id !== s.compareFrom) {
        store.setState({ selectedAction: id, comparePick: null, tab: 'diff' })
      }
    },
    selectGroup(groupId, fromId, toId) {
      store.setState({
        selectedGroup: groupId,
        compareFrom: fromId === toId ? null : fromId,
        selectedAction: toId,
        comparePick: null,
        tab: 'diff',
      })
    },
    selectPath(selectedPath) {
      store.setState({ selectedPath })
    },
    pinPath(pinnedPath) {
      store.setState({ pinnedPath, selectedPath: pinnedPath ?? store.getState().selectedPath })
    },
    setCostFilter(costFilter) {
      store.setState({ costFilter })
    },
    setStateSearch(stateSearch) {
      store.setState({ stateSearch })
    },
    setTab(tab) {
      store.setState({ tab })
    },
    setFilter(filter) {
      store.setState({ filter })
    },
    setShowFunctions(showFunctions) {
      store.setState({ showFunctions })
    },
    snapshot(storeId, id) {
      const k = snapshotKey(storeId, id)
      const known = store.getState().snapshots
      if (k in known) return known[k]
      if (!requested.has(k)) {
        requested.add(k)
        send(storeId, { type: 'snapshot', id })
      }
      return undefined
    },
    onExport(cb) {
      exportListeners.add(cb)
      return () => exportListeners.delete(cb)
    },
    dispose() {
      if (disposed) return
      disposed = true
      disposers.forEach((d) => d())
      exportListeners.clear()
    },
  }

  // Late-mount sync: every recorder answers with a full `store` event.
  transport.reconnect?.()
  transport.send('hello', envelope())
  return model
}
