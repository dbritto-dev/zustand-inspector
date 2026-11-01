import { TanStackDevtoolsCore } from '@tanstack/devtools'
import { zustandInspectorAstryxPlugin } from '../src/astryx'
import { counterStore, themeStore, todosStore } from '../demo/stores'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = /* html */ `
  <section class="card">
    <h2>Counter <small>inspector()</small></h2>
    <div class="row">
      <button data-action="dec" aria-label="Decrement">−</button>
      <output id="count"></output>
      <button data-action="inc" aria-label="Increment">+</button>
      <button data-action="slow" title="Wakes a listener that takes about 25 ms">Slow +1</button>
      <label class="row">step <input id="step" type="number" min="1" value="1" /></label>
    </div>
    <p class="note">"increment" is named from the calling function. "Slow +1" wakes a 25 ms listener.</p>
  </section>
  <section class="card">
    <h2>Todos <small id="status"></small></h2>
    <form id="add" class="row"><input id="title" placeholder="New todo" aria-label="New todo" /><button>Add</button></form>
    <div class="row">
      <button data-action="load">Load async</button>
      <button data-action="tag">Add tag</button>
      <button data-action="refresh" title="Copies the todos Map without changing anything">Refresh</button>
      <span class="tags" id="tags"></span>
    </div>
    <ul class="todos" id="todos"></ul>
    <p class="note">Map, Set and Date state; session.accessToken is redacted. "Refresh" copies the Map without changing it.</p>
  </section>
  <section class="card" id="theme-card">
    <h2>Theme <small>inspectStore()</small></h2>
    <div class="row">
      <button data-action="theme">Toggle mode</button>
      <span class="pill" id="mode"></span>
    </div>
    <p class="note">A store created without the middleware. Changes are recorded as setState, and time travel still works.</p>
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

function renderTheme() {
  const { mode } = themeStore.getState()
  $('#mode').textContent = `mode: ${mode}`
  $('#theme-card').dataset.mode = mode
}

counterStore.subscribe(renderCounter)
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
renderCounter()
renderTodos()
renderTheme()

let tagCount = 0
app.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action
  if (action === 'inc') counterStore.getState().increment()
  if (action === 'dec') counterStore.getState().decrement()
  if (action === 'load') void todosStore.getState().load()
  if (action === 'tag') todosStore.getState().tag(`tag-${++tagCount}`)
  if (action === 'slow') counterStore.getState().incrementSlow()
  if (action === 'refresh') todosStore.getState().refresh()
  if (action === 'theme') themeStore.setState((s) => ({ mode: s.mode === 'dark' ? 'light' : 'dark' }))
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
  plugins: [zustandInspectorAstryxPlugin({ defaultOpen: true })],
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
