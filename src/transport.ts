import { ZustandInspectorEventClient, type EventClientClass } from './client'
import type { InspectorEvents, InspectorEventName } from './protocol'
import { globals } from './session'

/**
 * The recorder and the panel only depend on this interface, so the same core
 * can later run over postMessage (browser extension), WebSocket (React Native,
 * Node) or a Vite DevTools dock. Preact Signals' devtools uses the same split.
 */
export interface Transport {
  send<K extends InspectorEventName>(type: K, payload: InspectorEvents[K]): void
  on<K extends InspectorEventName>(
    type: K,
    cb: (payload: InspectorEvents[K]) => void,
  ): () => void
  /**
   * Re-open the outgoing channel. TanStack's EventClient stops emitting for good
   * if the devtools bus is not mounted within ~5 retries, so panels call this
   * when they mount.
   */
  reconnect?(): void
}

export interface EventClientTransportOptions {
  debug?: boolean
  /** The EventClient class to use. Defaults to the page's (see `useEventClient`). */
  client?: EventClientClass
}

/** Make the page's default transport use this EventClient class (the `/production` entries do). */
export function useEventClient(client: EventClientClass): void {
  globals().eventClient = client
}

/** Transport over the TanStack Devtools event bus (in-page, plus the Vite server bus if enabled). */
export function createEventClientTransport(
  options: EventClientTransportOptions = {},
): Transport {
  const Client = options.client ?? (globals().eventClient as EventClientClass | undefined) ?? ZustandInspectorEventClient
  const make = () => new Client({ debug: options.debug ?? false })
  // `on` subscribes directly on the global event target and keeps working even
  // when emitting has given up, so one listening client is enough.
  const listener = make()
  let emitter = make()
  let sending = 0
  return {
    send(type, payload) {
      sending++
      try {
        emitter.emit(type, payload)
      } finally {
        sending--
      }
    },
    on(type, cb) {
      return listener.on(type, (event) => cb(event.payload as InspectorEvents[typeof type]))
    },
    reconnect() {
      // Never swap clients while one is mid-emit: EventClient flushes its queue
      // before detaching its connect listener, so a nested handshake would replay it.
      if (sending > 0) return
      emitter = make()
    },
  }
}

/** Synchronous in-memory transport. Useful for tests and for hosting the panel without TanStack. */
export function createMemoryTransport(): Transport {
  const target = new EventTarget()
  return {
    send(type, payload) {
      target.dispatchEvent(new CustomEvent(type, { detail: payload }))
    },
    on(type, cb) {
      const handler = (e: Event) =>
        cb((e as CustomEvent).detail as InspectorEvents[typeof type])
      target.addEventListener(type, handler)
      return () => target.removeEventListener(type, handler)
    },
  }
}

/** One shared transport per page, so the recorder and the panel meet on it. */
export function getDefaultTransport(): Transport {
  const g = globals()
  return ((g.transport as Transport | undefined) ??= createEventClientTransport())
}

export function setDefaultTransport(transport: Transport): void {
  globals().transport = transport
}
