// jsdom omits ResizeObserver, which the ScrollArea/Tabs primitives from
// @gonogo/ui construct at mount to track overflow. A no-op stub keeps any
// component that renders them (e.g. SerialDevicesMenu) mountable in tests;
// the overflow affordances it would drive aren't asserted here.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
