import { useWidgetScope } from "@ksp-gonogo/ui-kit";
import { plantSlot, SlotStub } from "./stub";

function PowerSystemsSectionStub() {
  const scope = useWidgetScope("power-systems");
  return (
    <SlotStub slot="power-systems.sections">
      resource: {scope?.resource ?? "no scope"}
    </SlotStub>
  );
}

plantSlot("power-systems.sections", PowerSystemsSectionStub);
