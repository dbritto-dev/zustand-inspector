import type { DefinedTheme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import { createRoot } from 'react-dom/client'
import type { AsyncConvention } from '../analysis'
import { createPanelModel, type PanelModel } from '../model'
import type { Transport } from '../transport'
import { astryxShadowCss } from './css'
import { InspectorPanel } from './InspectorPanel'
import { PanelTheme } from './PanelTheme'

export type ColorMode = 'light' | 'dark'

export interface AstryxInspectorOptions {
  transport?: Transport
  /** Light or dark. TanStack Devtools passes its own setting. */
  mode?: ColorMode
  /**
   * Another built Astryx theme and its CSS (from `astryx theme build`), so the
   * devtools can match the app. Defaults to the neutral theme.
   */
  astryxTheme?: { theme: DefinedTheme; css: string }
  /** Load the theme's web font (Figtree for neutral) from Google Fonts. Default false: system fonts. */
  loadFonts?: boolean
  /**
   * How async calls are read from action names. Defaults to Redux Toolkit's
   * phases (`name:pending` → `name:fulfilled` / `name:rejected`); `false` turns
   * grouping off.
   */
  asyncConvention?: AsyncConvention | false
}

export interface AstryxInspectorHandle {
  model: PanelModel
  setMode(mode: ColorMode): void
  unmount(): void
}

const FONT_LINK_ID = 'zustand-inspector-astryx-fonts'
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta'])

/**
 * Mount the Astryx panel into any element. It renders in a shadow root so
 * Astryx's reset and the app's own CSS never meet.
 */
export function mountAstryxInspector(
  host: HTMLElement,
  options: AstryxInspectorOptions = {},
): AstryxInspectorHandle {
  const shadowHost = document.createElement('div')
  shadowHost.style.height = '100%'
  host.appendChild(shadowHost)
  const shadow = shadowHost.attachShadow({ mode: 'open' })

  for (const css of astryxShadowCss(options.astryxTheme?.css)) {
    const style = document.createElement('style')
    style.textContent = css
    shadow.appendChild(style)
  }
  if (options.loadFonts && !document.getElementById(FONT_LINK_ID)) {
    // @font-face does not work inside a shadow root, so fonts load at page level.
    const link = document.createElement('link')
    link.id = FONT_LINK_ID
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap'
    document.head.appendChild(link)
  }

  const mountPoint = document.createElement('div')
  mountPoint.style.height = '100%'
  shadow.appendChild(mountPoint)

  const model = createPanelModel(options.transport)
  const root = createRoot(mountPoint)
  const theme = options.astryxTheme?.theme ?? neutralTheme
  let mode: ColorMode = options.mode ?? 'dark'
  let width = 0
  let mounted = true

  const render = () =>
    root.render(
      <PanelTheme theme={theme} mode={mode}>
        <InspectorPanel model={model} width={width} asyncConvention={options.asyncConvention} />
      </PanelTheme>,
    )
  render()

  // The pane's own width drives the responsive contract (devtools panes are
  // resized and split independently of the viewport, so media queries do not fit).
  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(([entry]) => {
          const next = Math.round(entry?.contentRect.width ?? 0)
          if (mounted && next > 0 && next !== width) {
            width = next
            render()
          }
        })
      : null
  observer?.observe(mountPoint)

  // Pressing a modifier on its own (Shift for a range compare) makes the browser
  // treat the focus as keyboard focus and draw the focus ring around the row you
  // just clicked. Hide the ring for a lone modifier; the next real key shows it.
  const onKeyDown = (e: KeyboardEvent) => {
    if (MODIFIERS.has(e.key)) mountPoint.setAttribute('data-zi-quiet-focus', '')
    else mountPoint.removeAttribute('data-zi-quiet-focus')
  }
  window.addEventListener('keydown', onKeyDown, true)

  return {
    model,
    setMode(next) {
      if (!mounted || next === mode) return
      mode = next
      render()
    },
    unmount() {
      if (!mounted) return
      mounted = false
      observer?.disconnect()
      window.removeEventListener('keydown', onKeyDown, true)
      root.unmount()
      model.dispose()
      shadowHost.remove()
    },
  }
}
