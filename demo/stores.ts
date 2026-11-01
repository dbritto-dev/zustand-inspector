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
export const counterStore = createStore<CounterState>()(
  inspector(
    (set) => ({
      count: 0,
      step: 1,
      heavy: false,
      increment: () => set((s) => ({ count: s.count + s.step, heavy: false })), // name inferred: "increment"
      decrement: () => set((s) => ({ count: s.count - s.step }), false, 'decrement'),
      setStep: (step) => set({ step }, false, { type: 'setStep', step }),
      incrementSlow: () => set((s) => ({ count: s.count + s.step, heavy: true }), false, 'incrementSlow'),
    }),
    { name: 'counter' },
  ),
)

export type Todo = { id: string; title: string; done: boolean; createdAt: Date }

export type TodosState = {
  todos: Map<string, Todo>
  tags: Set<string>
  status: 'idle' | 'loading' | 'ready'
  session: { user: string; accessToken: string }
  add: (title: string) => void
  toggle: (id: string) => void
  tag: (tag: string) => void
  /** Copies the Map without changing anything: a wasted update on purpose. */
  refresh: () => void
  load: () => Promise<void>
}

let nextId = 1

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
      load: async () => {
        set({ status: 'loading' }, false, 'todos/load:pending')
        await new Promise((r) => setTimeout(r, 400))
        const todos = new Map(get().todos)
        for (const title of ['Read the TanStack plugin docs', 'Ship the Zustand inspector']) {
          const id = String(nextId++)
          todos.set(id, { id, title, done: false, createdAt: new Date() })
        }
        set({ todos, status: 'ready' }, false, 'todos/load:fulfilled')
      },
    }),
    { name: 'todos', maxHistory: 200 },
  ),
)

// A store created without the middleware can still be inspected (no action names).
export const themeStore = createStore<{ mode: 'light' | 'dark' }>()(() => ({ mode: 'dark' }))
inspectStore(themeStore, { name: 'theme' })
