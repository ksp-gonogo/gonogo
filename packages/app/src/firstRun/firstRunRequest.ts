const listeners = new Set<() => void>();

/**
 * Asks the mounted `FirstRunSetupHost` to open the setup flow now, whether or
 * not it has been seen. A no-op when no host is mounted, which is the case on a
 * station.
 */
export function requestFirstRunSetup(): void {
  for (const listener of [...listeners]) listener();
}

/** Subscribes the host to {@link requestFirstRunSetup}; returns the unsubscribe. */
export function onFirstRunSetupRequested(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
