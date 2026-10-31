import { counterStore, themeStore, todosStore } from './stores'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = /* html */ `
  <h1>Zustand Inspector demo</h1>
  <p class="lead">Vanilla stores, no React. Open the <strong>Zustand</strong> tab in TanStack Devtools.</p>
  <section>
    <h2>Counter</h2>
    <div class="row">
      <button data-action="dec">−</button>
      <output id="count"></output>
      <button data-action="inc">+</button>
      <label>step <input id="step" type="number" min="1" value="1" /></label>
    </div>
  </section>
  <section>
    <h2>Todos <small id="status"></small></h2>
    <form id="add" class="row"><input id="title" placeholder="New todo" /><button>Add</button></form>
    <div class="row">
      <button data-action="load">Load async</button>
      <button data-action="tag">Add tag</button>
      <span id="tags"></span>
    </div>
    <ul id="todos"></ul>
  </section>
  <section>
    <h2>Theme <small>(store without middleware)</small></h2>
    <button data-action="theme">Toggle theme</button>
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
  document.documentElement.dataset.theme = themeStore.getState().mode
}

counterStore.subscribe(renderCounter)
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

// Devtools are dev-only: dynamic imports keep the shell and panel out of production bundles.
if (import.meta.env.DEV) {
  // `?devtoolsDelay=3000` mounts the devtools late, after TanStack's client gave up connecting.
  const delay = Number(new URLSearchParams(location.search).get('devtoolsDelay') ?? 0)
  if (delay > 0) await new Promise((r) => setTimeout(r, delay))
  const [{ TanStackDevtoolsCore }, { zustandInspectorPlugin }] = await Promise.all([
    import('@tanstack/devtools'),
    import('../src/panel'),
  ])
  const host = document.createElement('div')
  document.body.appendChild(host)
  new TanStackDevtoolsCore({
    config: { defaultOpen: true },
    plugins: [zustandInspectorPlugin({ defaultOpen: true })],
  }).mount(host)
}
