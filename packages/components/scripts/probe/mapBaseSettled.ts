const PENDING = "canvas[data-map-base='pending']";

/**
 * Resolves once no map base canvas under `root` is still waiting for its first
 * paint, which a canvas marks by changing `data-map-base` after it draws the
 * body's picture, or the plain wash when there is none. A page with no map
 * resolves at once. Rejects after `timeoutMs` so a map that never paints fails
 * the render instead of being captured blank.
 */
export function mapBaseSettled(
  root: HTMLElement,
  timeoutMs = 10_000,
): Promise<void> {
  if (!root.querySelector(PENDING)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const watcher = new MutationObserver(() => {
      if (root.querySelector(PENDING)) return;
      watcher.disconnect();
      clearTimeout(giveUp);
      resolve();
    });
    const giveUp = setTimeout(() => {
      watcher.disconnect();
      reject(
        new Error("Probe: a map base canvas never finished its first paint"),
      );
    }, timeoutMs);
    watcher.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-map-base"],
    });
  });
}
