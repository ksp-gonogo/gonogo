import { plantSlot, SlotStub } from "./stub";

plantSlot("launch-director.preflight", ({ selectedSite }) => (
  <SlotStub slot="launch-director.preflight">site: {selectedSite}</SlotStub>
));

/** An inline badge under the pad's row, the size a per-pad note takes. */
plantSlot("launch-director.pad", ({ displayName, occupantName }) => (
  <span
    data-slot-stub="launch-director.pad"
    style={{
      display: "inline-block",
      border: "1px dashed var(--color-status-info-fg)",
      borderRadius: 4,
      padding: "0 6px",
      color: "var(--color-status-info-fg)",
    }}
  >
    launch-director.pad: {occupantName ?? displayName}
  </span>
));
