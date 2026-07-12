import "@testing-library/jest-dom";

// jsdom omits ResizeObserver, which ScrollArea/Tabs construct at mount to track
// overflow. A no-op stub keeps those components mountable in tests; the glow
// indicators it would drive aren't asserted here.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
