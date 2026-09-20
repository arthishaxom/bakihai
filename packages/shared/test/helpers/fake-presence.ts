import type { PresenceSignals } from '../../src/sync/provider'

/** A page the test drives: it decides when the browser is online and visible. */
export interface FakePresence {
  /** Pass to `BookSyncProvider` as `presence`. */
  signals: PresenceSignals
  /** Fires the browser's `online` event. */
  comeOnline(): void
  /** Fires the browser's `visibilitychange` event with the page visible. */
  becomeVisible(): void
  /** Sets what `isVisible()` reports, without firing an event. */
  setVisible(visible: boolean): void
}

export function createFakePresence(): FakePresence {
  const onlineListeners = new Set<() => void>()
  const visibleListeners = new Set<() => void>()
  let shown = true

  return {
    signals: {
      isVisible: () => shown,
      onOnline(listener) {
        onlineListeners.add(listener)

        return () => {
          onlineListeners.delete(listener)
        }
      },
      onVisible(listener) {
        visibleListeners.add(listener)

        return () => {
          visibleListeners.delete(listener)
        }
      },
    },
    comeOnline() {
      for (const listener of onlineListeners) {
        listener()
      }
    },
    becomeVisible() {
      shown = true

      for (const listener of visibleListeners) {
        listener()
      }
    },
    setVisible(visible) {
      shown = visible
    },
  }
}
