import { globals } from './session'

/**
 * Same rule as TanStack's `@tanstack/devtools-event-client`: the devtools are
 * on when `process.env.NODE_ENV === 'development'` (the consumer's bundler
 * replaces it), and off otherwise, including when it is unset. The
 * `zustand-inspector/production` entry turns them on regardless.
 */
export function isDevelopment(): boolean {
  try {
    return process.env.NODE_ENV === 'development'
  } catch {
    return false
  }
}

/** Set by the `/production` entries: record and show the devtools in any build. */
export function markAlwaysOn(): void {
  globals().alwaysOn = true
}

export function devtoolsEnabled(): boolean {
  return globals().alwaysOn === true || isDevelopment()
}
