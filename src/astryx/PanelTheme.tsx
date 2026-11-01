import { ThemeContext, registerTheme, type DefinedTheme } from '@astryxdesign/core/theme'
import { VStack } from '@astryxdesign/core/VStack'
import { useMemo, type ReactNode } from 'react'

/**
 * Astryx's `<Theme>` syncs `data-theme` / `data-astryx-theme` onto the host
 * page's `<html>` when it is the root theme, which would flip the app's own
 * light/dark mode. Devtools must never touch the page, so this provides the
 * same context and scoped theme root without the root sync. The color scheme,
 * text color and font come from the `[data-zi-root]` rule in css.ts.
 */
export function PanelTheme({
  theme,
  mode,
  children,
}: {
  theme: DefinedTheme
  mode: 'light' | 'dark'
  children: ReactNode
}) {
  registerTheme(theme)
  const value = useMemo(() => ({ theme, mode }), [theme, mode])
  return (
    <ThemeContext value={value}>
      <VStack height="100%" data-zi-root="" data-astryx-theme={theme.name} data-theme={mode}>
        {children}
      </VStack>
    </ThemeContext>
  )
}
