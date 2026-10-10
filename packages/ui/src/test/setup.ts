import "@testing-library/jest-dom";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";

// jsdom omits ResizeObserver, which ScrollArea and Tabs construct at mount.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Quantities default to the reader's locale; pin it so snapshots match across machines.
setQuantityLocale("en-GB");

// The act-warning gate's post-body wait, imported only when the gate asks for it so
// an ordinary run never loads the testing barrel. Last, so its afterEach is ordered
// ahead of Testing Library's cleanup; see installActGateStretch.
if (process.env.GONOGO_ACT_GATE_STRETCH_FRAMES) {
  const { installActGateStretch } = await import(
    "@ksp-gonogo/sitrep-sdk/testing"
  );
  await installActGateStretch();
}
