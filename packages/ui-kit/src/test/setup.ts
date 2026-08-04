import "@testing-library/jest-dom";
import { setQuantityLocale } from "../units";

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

// Pin the locale every quantity is written in. It defaults to the READER's
// locale, which is right for an operator and wrong for a snapshot: a render on
// a French machine has to match one on an American CI runner.
setQuantityLocale("en-GB");
