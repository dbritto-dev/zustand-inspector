import { TanStackDevtoolsCore } from '@tanstack/devtools'
import { zustandInspectorDevtoolsPlugin } from '../../src'
import { counterStore, themeStore, todosStore, votesStore } from '../stores'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = /* html */ `
  <section class="card">
    <h2>Counter <small>immer · subscribeWithSelector</small></h2>
    <div class="row">
      <button data-action="dec" aria-label="Decrement">−</button>
      <output id="count"></output>
      <button data-action="inc" aria-label="Increment">+</button>
      <button data-action="slow" title="Wakes a listener that takes about 25 ms">Slow +1</button>
      <label class="row">step <input id="step" type="number" min="1" value="1" /></label>
    </div>
    <p class="note">"increment" mutates an immer draft and is named from the calling function. "Slow +1" wakes a 25 ms listener.</p>
  </section>
  <section class="card">
    <h2>Votes <small>redux()</small></h2>
    <div class="row">
      <button data-vote="zustand">Zustand <span class="tags" id="v-zustand"></span></button>
      <button data-vote="jotai">Jotai <span class="tags" id="v-jotai"></span></button>
      <button data-vote="valtio">Valtio <span class="tags" id="v-valtio"></span></button>
      <button data-action="votes-reset">Reset</button>
    </div>
    <p class="note">Each click dispatches an action through a reducer. In the panel, open Middlewares → redux to dispatch one yourself.</p>
  </section>
  <section class="card">
    <h2>Todos <small id="status"></small></h2>
    <form id="add" class="row"><input id="title" placeholder="New todo" aria-label="New todo" /><button>Add</button></form>
    <div class="row">
      <button data-action="load">Load async</button>
      <button data-action="load-fail" title="Rejects after 400 ms">Load (fails)</button>
      <button data-action="tag">Add tag</button>
      <button data-action="refresh" title="Copies the todos Map without changing anything">Refresh</button>
      <span class="tags" id="tags"></span>
    </div>
    <ul class="todos" id="todos"></ul>
    <p class="note">Map, Set and Date state; session.accessToken is redacted. "Load" is async: its pending and fulfilled or rejected actions group into one row.</p>
  </section>
  <section class="card" id="theme-card">
    <h2>Theme <small>inspectStore()</small></h2>
    <div class="row">
      <button data-action="theme">Toggle mode</button>
      <span class="pill" id="mode"></span>
    </div>
    <p class="note">A store created without the inspector middleware, with <code>persist</code>: the mode survives a reload. In the panel, open Middlewares → persist to see the storage.</p>
  </section>
`

const $ = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!

function renderCounter() {
  const { count, step } = counterStore.getState()
  $('#count').textContent = String(count)
  const input = $<HTMLInputElement>('#step')
  if (document.activeElement !== input) input.value = String(step)
}

function renderTodos() {
  const { todos, tags, status } = todosStore.getState()
  $('#status').textContent = status
  $('#tags').textContent = [...tags].map((t) => `#${t}`).join(' ')
  $('#todos').innerHTML = [...todos.values()]
    .map(
      (t) =>
        `<li><label><input type="checkbox" data-id="${t.id}" ${t.done ? 'checked' : ''}/> ${t.title.replace(/</g, '&lt;')}</label></li>`,
    )
    .join('')
}

function renderVotes() {
  const votes = votesStore.getState()
  for (const option of ['zustand', 'jotai', 'valtio'] as const) $(`#v-${option}`).textContent = String(votes[option])
}

function renderTheme() {
  const { mode } = themeStore.getState()
  $('#mode').textContent = `mode: ${mode}`
  $('#theme-card').dataset.mode = mode
}

// A selector subscription (subscribeWithSelector): runs only when count or step change.
counterStore.subscribe((s) => [s.count, s.step] as const, renderCounter, {
  equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1],
})
// An expensive listener, so "Slow +1" shows up as a slow action.
counterStore.subscribe((state) => {
  if (!state.heavy) return
  const until = performance.now() + 25
  while (performance.now() < until) {
    // busy work standing in for an expensive render
  }
})
todosStore.subscribe(renderTodos)
themeStore.subscribe(renderTheme)
votesStore.subscribe(renderVotes)
renderCounter()
renderVotes()
renderTodos()
renderTheme()

let tagCount = 0
app.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action
  if (action === 'inc') counterStore.getState().increment()
  if (action === 'dec') counterStore.getState().decrement()
  if (action === 'load') void todosStore.getState().load()
  if (action === 'load-fail') void todosStore.getState().load(true)
  if (action === 'tag') todosStore.getState().tag(`tag-${++tagCount}`)
  if (action === 'slow') counterStore.getState().incrementSlow()
  if (action === 'refresh') todosStore.getState().refresh()
  if (action === 'theme') themeStore.setState((s) => ({ mode: s.mode === 'dark' ? 'light' : 'dark' }))
  if (action === 'votes-reset') votesStore.dispatch({ type: 'reset' })
  const vote = (e.target as HTMLElement).closest<HTMLElement>('[data-vote]')?.dataset.vote
  if (vote === 'zustand' || vote === 'jotai' || vote === 'valtio') votesStore.dispatch({ type: 'vote', option: vote })
})
$('#step').addEventListener('change', (e) => {
  counterStore.getState().setStep(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))
})
$('#add').addEventListener('submit', (e) => {
  e.preventDefault()
  const input = $<HTMLInputElement>('#title')
  if (input.value.trim()) todosStore.getState().add(input.value.trim())
  input.value = ''
})
$('#todos').addEventListener('change', (e) => {
  const id = (e.target as HTMLInputElement).dataset.id
  if (id) todosStore.getState().toggle(id)
})

// A little history so the timeline is not empty on first open.
counterStore.getState().increment()
counterStore.getState().increment()
todosStore.getState().add('Try time travel')

function prefersDark(): boolean {
  const attr = document.documentElement.dataset.theme
  if (attr === 'dark' || attr === 'light') return attr === 'dark'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

const host = document.createElement('div')
document.body.appendChild(host)
new TanStackDevtoolsCore({
  config: { defaultOpen: true, theme: prefersDark() ? 'dark' : 'light' },
  plugins: [zustandInspectorDevtoolsPlugin({ defaultOpen: true })],
}).mount(host)

// The strip under the TanStack header lists *closed* plugins. Ours is the only
// one and it starts open, so the strip would sit there empty. TanStack folds it
// only when it *becomes* empty, so fold it once here when it starts empty.
function foldEmptyPluginStrip(triesLeft = 60) {
  const strip = document.querySelector('[data-testid="plugins-strip"]')
  const toggle = document.querySelector<HTMLButtonElement>('[data-testid="workbench-collapse-toggle"]')
  if (strip && toggle) {
    if (strip.children.length === 0 && toggle.getAttribute('aria-expanded') === 'true') toggle.click()
    return
  }
  if (triesLeft > 0) requestAnimationFrame(() => foldEmptyPluginStrip(triesLeft - 1))
}
foldEmptyPluginStrip()
