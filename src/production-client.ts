import { EventClient } from '@tanstack/devtools-event-client/production'
import type { ZustandInspectorEventClientOptions } from './client'
import { PLUGIN_ID, type InspectorEvents } from './protocol'

/** The always-on client, from `@tanstack/devtools-event-client/production`. */
export class ZustandInspectorProductionEventClient extends EventClient<InspectorEvents> {
  constructor(options: ZustandInspectorEventClientOptions = {}) {
    super({ pluginId: PLUGIN_ID, debug: options.debug ?? false })
  }
}
