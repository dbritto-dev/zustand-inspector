import { TanStackDevtools } from '@tanstack/react-devtools'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from 'zustand'
import { zustandInspectorDevtoolsPlugin } from '../../src/react'
import { counterStore, todosStore, votesStore } from '../stores'

// The same vanilla stores as the playground, read with zustand's React hook,
// and the inspector registered through @tanstack/react-devtools.

function Counter() {
  const count = useStore(counterStore, (s) => s.count)
  const increment = useStore(counterStore, (s) => s.increment)
  const decrement = useStore(counterStore, (s) => s.decrement)
  return (
    <section>
      <strong>Counter</strong>
      <div className="row">
        <button data-action="dec" onClick={decrement}>
          −
        </button>
        <output id="count">{count}</output>
        <button data-action="inc" onClick={increment}>
          +
        </button>
      </div>
    </section>
  )
}

function Todos() {
  const todos = useStore(todosStore, (s) => s.todos)
  const status = useStore(todosStore, (s) => s.status)
  return (
    <section>
      <strong>Todos ({status})</strong>
      <div className="row">
        <button data-action="load" onClick={() => void todosStore.getState().load()}>
          Load async
        </button>
        <button data-action="add" onClick={() => todosStore.getState().add(`Todo ${todos.size + 1}`)}>
          Add
        </button>
      </div>
      <ul>
        {[...todos.values()].map((t) => (
          <li key={t.id}>{t.title}</li>
        ))}
      </ul>
    </section>
  )
}

function Votes() {
  const votes = useStore(votesStore, (s) => s)
  return (
    <section>
      <strong>Votes</strong>
      <div className="row">
        {(['zustand', 'jotai', 'valtio'] as const).map((option) => (
          <button key={option} data-vote={option} onClick={() => votesStore.dispatch({ type: 'vote', option })}>
            {option} {votes[option]}
          </button>
        ))}
      </div>
    </section>
  )
}

function App() {
  return (
    <main>
      <h1>Zustand Inspector in React</h1>
      <Counter />
      <Todos />
      <Votes />
      <TanStackDevtools config={{ defaultOpen: true }} plugins={[zustandInspectorDevtoolsPlugin()]} />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
