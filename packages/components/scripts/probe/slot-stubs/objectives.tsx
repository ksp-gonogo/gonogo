import { plantSlot } from "./stub";

/** One pending objective, drawn through the host's own `Section` as every source is. */
plantSlot("objectives.source", ({ Section }) => (
  <Section
    items={[
      {
        id: "planted-slot-objective",
        title: "objectives.source",
        state: "pending",
        source: "planted",
      },
    ]}
  />
));
