const listeners = new Set<(tabId?: string) => void>();

/**
 * Asks the mounted Settings button to open the settings dialog now, on the
 * named tab such as "uplinks" or on its default tab. Useful for a message that
 * points the operator at a settings page and should take them there. A no-op
 * when no Settings button is mounted.
 */
export function requestSettings(tabId?: string): void {
  for (const listener of [...listeners]) listener(tabId);
}

/** Subscribes the Settings button to {@link requestSettings}; returns the unsubscribe. */
export function onSettingsRequested(
  listener: (tabId?: string) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
