import { persist, redux, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { createStore } from 'zustand/vanilla'
import { inspectStore, inspector } from '../src'

export type CounterState = {
  count: number
  step: number
  increment: () => void
  decrement: () => void
  setStep: (step: number) => void
  /** Like increment, but wakes an expensive listener (see the showcase). */
  incrementSlow: () => void
  heavy: boolean
}

// Action names come from the third `set` argument, or are inferred from the caller.
// immer lets actions mutate a draft; subscribeWithSelector lets the page listen
// to one slice (see the showcase). The panel shows both.
export const counterStore = createStore<CounterState>()(
  inspector(
    subscribeWithSelector(
      immer((set) => ({
        count: 0,
        step: 1,
        heavy: false,
        // name inferred: "increment"
        increment: () =>
          set((s) => {
            s.count += s.step
            s.heavy = false
          }),
        decrement: () => set((s) => ({ count: s.count - s.step }), false, 'decrement'),
        setStep: (step) => set({ step }, false, { type: 'setStep', step }),
        incrementSlow: () => set((s) => ({ count: s.count + s.step, heavy: true }), false, 'incrementSlow'),
      })),
    ),
    { name: 'counter' },
  ),
)

export type Vote = { type: 'vote'; option: 'zustand' | 'jotai' | 'valtio' } | { type: 'reset' }
export type VotesState = { zustand: number; jotai: number; valtio: number }

const initialVotes: VotesState = { zustand: 0, jotai: 0, valtio: 0 }

// The redux middleware: actions are dispatched, and the reducer computes the state.
export const votesStore = createStore(
  inspector(
    redux(
      (state: VotesState, action: Vote): VotesState =>
        action.type === 'reset' ? initialVotes : { ...state, [action.option]: state[action.option] + 1 },
      initialVotes,
    ),
    { name: 'votes' },
  ),
)

export type Todo = { id: string; title: string; done: boolean; createdAt: Date }

export type TodosState = {
  todos: Map<string, Todo>
  tags: Set<string>
  status: 'idle' | 'loading' | 'ready' | 'error'
  session: { user: string; accessToken: string }
  add: (title: string) => void
  toggle: (id: string) => void
  tag: (tag: string) => void
  /** Copies the Map without changing anything: a wasted update on purpose. */
  refresh: () => void
  /** Async: recorded as todos/load:pending, then :fulfilled or :rejected (pass `fail`). */
  load: (fail?: boolean) => Promise<void>
}

let nextId = 1
let nextRequest = 1

export const todosStore = createStore<TodosState>()(
  inspector(
    (set, get) => ({
      todos: new Map(),
      tags: new Set(['inbox']),
      status: 'idle',
      // `accessToken` is redacted in the page before anything is sent to the panel.
      session: { user: 'danilo', accessToken: 'eyJhbGciOi.super.secret' },
      add: (title) =>
        set(
          (s) => {
            const id = String(nextId++)
            const todos = new Map(s.todos)
            todos.set(id, { id, title, done: false, createdAt: new Date() })
            return { todos }
          },
          false,
          { type: 'todos/add', title },
        ),
      toggle: (id) =>
        set(
          (s) => {
            const todo = s.todos.get(id)
            if (!todo) return s
            const todos = new Map(s.todos)
            todos.set(id, { ...todo, done: !todo.done })
            return { todos }
          },
          false,
          { type: 'todos/toggle', id },
        ),
      tag: (tag) => set((s) => ({ tags: new Set(s.tags).add(tag) }), false, 'tags/add'),
      refresh: () => set((s) => ({ todos: new Map(s.todos) }), false, 'todos/refresh'),
      // Async calls follow Redux Toolkit's phase names, so the panel groups them.
      // The requestId pairs the phases when two loads overlap.
      load: async (fail = false) => {
        const requestId = String(nextRequest++)
        set({ status: 'loading' }, false, { type: 'todos/load:pending', requestId })
        await new Promise((r) => setTimeout(r, 400))
        if (fail) {
          const error = new Error('Network request failed')
          set({ status: 'error' }, false, { type: 'todos/load:rejected', requestId, error })
          return
        }
        const todos = new Map(get().todos)
        for (const title of ['Read the TanStack plugin docs', 'Ship the Zustand inspector']) {
          const id = String(nextId++)
          todos.set(id, { id, title, done: false, createdAt: new Date() })
        }
        set({ todos, status: 'ready' }, false, { type: 'todos/load:fulfilled', requestId })
      },
    }),
    { name: 'todos', maxHistory: 200 },
  ),
)

// A store created without the inspector middleware can still be inspected (no
// action names). It uses `persist`, which the inspector picks up: the mode
// survives a reload and rehydration is recorded as `persist/rehydrate`.
export const themeStore = createStore<{ mode: 'light' | 'dark' }>()(
  persist(() => ({ mode: 'dark' as 'light' | 'dark' }), { name: 'zustand-inspector-playground:theme' }),
)
inspectStore(themeStore, { name: 'theme' })
