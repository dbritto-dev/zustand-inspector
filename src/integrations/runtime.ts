import type { StoreApi } from 'zustand/vanilla'
import type { Command, IntegrationInfo } from '../protocol'
import type { StoreRecorder } from '../recorder'
import type { IntegrationContext, InspectorIntegration } from './types'

interface Connection {
  integration: InspectorIntegration
  target: unknown
  cleanup?: () => void
}

/**
 * Connects a store's integrations to its recorder: publishes what they show,
 * runs the panel's commands, and names the writes they make.
 */
export class IntegrationRuntime {
  #api: StoreApi<any>
  #recorder: StoreRecorder<any>
  #integrations: ReadonlyArray<InspectorIntegration>
  #connections: Array<Connection> = []
  #labels: Array<{ name: string; via: string }> = []
  #scheduled = false
  #lastSent = ''
  #disposers: Array<() => void> = []

  constructor(api: StoreApi<any>, recorder: StoreRecorder<any>, integrations: ReadonlyArray<InspectorIntegration>) {
    this.#api = api
    this.#recorder = recorder
    this.#integrations = integrations
    this.#disposers.push(
      recorder.onCommand('integration', (command) => void this.#run(command)),
      recorder.onCommand('integration:inspect', (command) => {
        if (command.type === 'integration:inspect') void this.#inspect(command.id)
      }),
    )
  }

  /** Detect integrations not connected yet. Safe to call again (a middleware may attach later). */
  connect(): void {
    for (const integration of this.#integrations) {
      if (this.#connections.some((c) => c.integration.id === integration.id)) continue
      let target: unknown
      try {
        target = integration.detect(this.#api)
      } catch {
        continue
      }
      if (target === undefined || target === null || target === false) continue
      const connection: Connection = { integration, target }
      this.#connections.push(connection)
      try {
        const cleanup = integration.setup?.(target, this.#context(integration.id))
        if (cleanup) connection.cleanup = cleanup
      } catch (error) {
        warn(error)
      }
    }
    this.publish()
  }

  /** The name for an unnamed `set()` right now, if an integration is writing. */
  label(): { name: string; via: string } | undefined {
    const active = this.#labels.at(-1)
    if (active) return active
    for (const { integration, target } of this.#connections) {
      const name = safe(() => integration.writing?.(target))
      if (name) return { name, via: integration.id }
    }
    return undefined
  }

  /** Send the integrations to the panel if what they show changed. */
  publish(): void {
    const infos = this.#connections.map((c) => this.#describe(c))
    const key = JSON.stringify(infos)
    if (key === this.#lastSent) return
    this.#lastSent = key
    this.#recorder.setIntegrations(infos)
  }

  /** Batch updates to one publish per task. */
  schedulePublish(): void {
    if (this.#scheduled) return
    this.#scheduled = true
    queueMicrotask(() => {
      this.#scheduled = false
      this.publish()
    })
  }

  dispose(): void {
    for (const c of this.#connections) safe(() => c.cleanup?.())
    this.#connections = []
    this.#disposers.forEach((d) => d())
    this.#disposers = []
  }

  #context(via: string): IntegrationContext {
    return {
      update: () => this.schedulePublish(),
      label: (name, fn) => {
        this.#labels.push({ name, via })
        try {
          return fn()
        } finally {
          this.#labels.pop()
        }
      },
      nextActionId: () => this.#recorder.currentId + 1,
    }
  }

  #describe({ integration, target }: Connection): IntegrationInfo {
    const state = this.#api.getState()
    const info: IntegrationInfo = { id: integration.id, label: integration.label }
    if (integration.icon) info.icon = integration.icon
    const description =
      typeof integration.description === 'function'
        ? safe(() => (integration.description as (t: unknown) => string)(target))
        : integration.description
    if (description) info.description = description
    const status = safe(() => integration.status?.(target, state))
    if (status) info.status = status
    const facts = safe(() => integration.facts?.(target, state))
    if (facts?.length) {
      info.facts = facts.map((f) => ({ label: f.label, value: this.#recorder.serializeValue(f.value) }))
    }
    if (integration.inspect) info.inspectable = true
    const commands = safe(() => integration.commands?.(target, state))
    if (commands?.length) {
      info.commands = commands.map(({ run: _run, writes: _writes, disabled, ...rest }) => ({
        ...rest,
        ...(disabled ? { disabled } : {}),
      }))
    }
    return info
  }

  async #inspect(id: string): Promise<void> {
    const connection = this.#connections.find((c) => c.integration.id === id)
    if (!connection?.integration.inspect) return
    const serialize = (v: unknown) => this.#recorder.serializeValue(v)
    try {
      const result = await connection.integration.inspect(connection.target, this.#api.getState())
      this.#recorder.sendInspected(id, {
        ...result,
        ...('value' in result ? { value: serialize(result.value) } : {}),
        ...(result.compare ? { compare: { with: serialize(result.compare.with), label: result.compare.label } } : {}),
      })
    } catch (error) {
      this.#recorder.sendInspected(id, undefined, message(error))
    }
  }

  async #run(command: Command): Promise<void> {
    if (command.type !== 'integration') return
    const connection = this.#connections.find((c) => c.integration.id === command.id)
    if (!connection) return
    const { integration, target } = connection
    const definition = safe(() => integration.commands?.(target, this.#api.getState()))?.find(
      (c) => c.id === command.command,
    )
    if (!definition || definition.disabled) return
    let error: string | undefined
    try {
      const run = () => definition.run(target, command.input)
      await (definition.writes ? this.#context(integration.id).label(definition.writes, run) : run())
    } catch (e) {
      error = message(e)
    }
    this.#recorder.sendIntegrationResult(integration.id, command.command, error)
    this.publish()
    if (integration.inspect) await this.#inspect(integration.id)
  }
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch (error) {
    warn(error)
    return undefined
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function warn(error: unknown): void {
  if (typeof console !== 'undefined') console.warn('[zustand-inspector] integration failed:', error)
}
