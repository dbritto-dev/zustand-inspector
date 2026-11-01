import type { StoreApi } from 'zustand/vanilla'

/**
 * Integrations teach the inspector about a store's other middlewares: what to
 * show about them, what the panel can ask them to do, and how to name the
 * `set()` calls they make. Experimental: the shape may still change.
 */

export type IntegrationIcon = 'storage' | 'dispatch' | 'subscriptions' | 'plug'

export interface IntegrationStatus {
  tone: 'success' | 'warning' | 'error' | 'info'
  text: string
}

export interface IntegrationFact {
  label: string
  value: unknown
}

/** One row of an inspected list, e.g. a subscription. */
export interface InspectRow {
  title: string
  detail?: string
  meta?: string
}

/** What `inspect` returns: a value shown as a tree, or rows shown as a list. */
export interface InspectResult {
  title?: string
  value?: unknown
  rows?: Array<InspectRow>
  /** Shown instead of the value when there is nothing (`value` null or no rows). */
  empty?: string
  /** Diff `value` against another value, e.g. stored vs. current state. */
  compare?: { with: unknown; label: string }
  note?: string
}

export interface IntegrationCommand<A> {
  id: string
  label: string
  description?: string
  tone?: 'primary' | 'default' | 'destructive'
  /** A reason the command can't run right now. */
  disabled?: string | false
  /** Ask the panel for a JSON value first (e.g. the action to dispatch). */
  input?: { kind: 'json'; label: string; placeholder?: string }
  /** Name for the `set()` calls the command makes, if they carry no name of their own. */
  writes?: string
  run(target: A, input?: unknown): void | Promise<void>
}

export interface IntegrationContext {
  /** Status, facts or commands changed: send them to the panel again (batched). */
  update(): void
  /** Run `fn`; every `set()` it makes without a name is recorded as `name`. */
  label<R>(name: string, fn: () => R): R
  /** The id the next recorded action will get. */
  nextActionId(): number
}

export interface InspectorIntegration<A = any> {
  id: string
  label: string
  icon?: IntegrationIcon
  description?: string | ((target: A) => string)
  /** Find the middleware on the store; return what the other hooks receive. */
  detect(api: StoreApi<any>): A | undefined | null | false
  /** Subscribe to the middleware, wrap what needs wrapping. Return a cleanup. */
  setup?(target: A, ctx: IntegrationContext): (() => void) | void
  status?(target: A, state: unknown): IntegrationStatus | undefined
  facts?(target: A, state: unknown): Array<IntegrationFact>
  inspect?(target: A, state: unknown): InspectResult | Promise<InspectResult>
  commands?(target: A, state: unknown): Array<IntegrationCommand<A>>
  /** While this returns a name, unnamed `set()` calls are recorded under it. */
  writing?(target: A): string | undefined
}
