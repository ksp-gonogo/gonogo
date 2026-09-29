import { plantSlot, SlotStub } from "./stub";

/** A list item, because the host renders this slot inside its instrument `<ul>`. */
plantSlot("experiments.instrument", ({ instrument }) => (
  <li>
    <SlotStub slot="experiments.instrument">{instrument.partTitle}</SlotStub>
  </li>
));

plantSlot("experiments.actions");
