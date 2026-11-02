import { EventClient } from '@tanstack/devtools-event-client'
import { PLUGIN_ID, type InspectorEvents } from './protocol'

export interface ZustandInspectorEventClientOptions {
  debug?: boolean
}

/**
 * The inspector's EventClient. Event names are suffixes (`store`, `action`…);
 * the client prefixes them with the plugin id, `zustand-inspector`.
 *
 * This is the root import of `@tanstack/devtools-event-client`, which does
 * nothing outside development. `zustand-inspector/production` swaps in the
 * client from `@tanstack/devtools-event-client/production`.
 */
export class ZustandInspectorEventClient extends EventClient<InspectorEvents> {
  constructor(options: ZustandInspectorEventClientOptions = {}) {
    super({ pluginId: PLUGIN_ID, debug: options.debug ?? false })
  }
}

export type EventClientClass = new (options?: ZustandInspectorEventClientOptions) => {
  emit: ZustandInspectorEventClient['emit']
  on: ZustandInspectorEventClient['on']
}
