import { plantSlot, SlotStub } from "./stub";

plantSlot("astronaut-complex.crew", ({ kerbalName, isApplicant }) => (
  <SlotStub slot="astronaut-complex.crew">
    {kerbalName}
    {isApplicant ? " (applicant)" : ""}
  </SlotStub>
));

plantSlot("astronaut-complex.crew-badge", ({ kerbalName }) => (
  <span
    data-slot-stub="astronaut-complex.crew-badge"
    style={{
      border: "1px dashed var(--color-status-info-fg)",
      borderRadius: 4,
      padding: "0 6px",
      color: "var(--color-status-info-fg)",
      fontSize: 11,
      whiteSpace: "nowrap",
    }}
  >
    badge: {kerbalName.split(" ")[0]}
  </span>
));

plantSlot("astronaut-complex.training");
