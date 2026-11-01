import resetCss from '@astryxdesign/core/reset.css?inline'
import astryxCss from '@astryxdesign/core/astryx.css?inline'
import neutralThemeCss from '@astryxdesign/theme-neutral/theme.css?inline'

/**
 * The panel renders inside a shadow root, so Astryx's page-level CSS is
 * adapted once here:
 * - `:root` token defaults become `:host` defaults (`:root` never matches in a shadow tree);
 * - the theme's `color-scheme` rules for `:root` / `html[data-theme]` are dropped,
 *   since the panel sets its own scheme and must never touch the host page.
 * The reset stays as is: inside a shadow root it can only reach the panel.
 *
 * Build note: these strings rely on CSS `light-dark()`. A bundler whose CSS
 * target predates it (Chrome 123 / Safari 17.5 / Firefox 120) rewrites every
 * theme color into a fallback that only works in dark mode, so builds must set
 * `build.cssTarget` to at least those versions.
 */
export function astryxShadowCss(themeCss: string = neutralThemeCss): Array<string> {
  return [resetCss, astryxCss.replaceAll(':root,', ':host,'), stripRootScheme(themeCss), hostCss]
}

export function stripRootScheme(css: string): string {
  return css
    .replace(/^\s*:root\s*\{\s*color-scheme:[^}]*\}\s*$/gm, '')
    .replace(/^\s*html\[data-theme="(light|dark)"\]\s*\{\s*color-scheme:[^}]*\}\s*$/gm, '')
}

/**
 * The only rules the panel adds, all tokens:
 * - the shadow host fills the devtools pane;
 * - the theme root gets what `<Theme>`'s wrapper sets (scheme, text color, font);
 * - `data-zi-tone` colors serialized values with the theme's syntax tokens.
 */
const hostCss = /* css */ `
:host { display: block; height: 100%; }
[data-zi-root] { color: var(--color-text-primary); font-family: var(--font-family-body); background: var(--color-background-surface); }
[data-zi-root][data-theme="light"] { color-scheme: light; }
[data-zi-root][data-theme="dark"] { color-scheme: dark; }
[data-zi-tone="string"] { color: var(--color-syntax-string); }
[data-zi-tone="number"] { color: var(--color-syntax-number); }
[data-zi-tone="constant"] { color: var(--color-syntax-constant); }
[data-zi-tone="function"] { color: var(--color-syntax-function); }
[data-zi-tone="type"] { color: var(--color-syntax-type); }
[data-zi-tone="property"] { color: var(--color-syntax-property); }
[data-zi-tone="muted"] { color: var(--color-text-secondary); }
[data-zi-tone="warning"] { color: var(--color-text-warning); font-style: italic; }
[data-zi-tone="error"] { color: var(--color-text-error); }
`
