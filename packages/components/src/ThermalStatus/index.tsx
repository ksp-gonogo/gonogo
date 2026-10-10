import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import { ThermalStatusView } from "./ThermalStatusView";
import { thermalTopics, useThermal } from "./useThermal";
import { useThermalEssentials } from "./useThermalEssentials";

type ThermalStatusConfig = Record<string, never>;

function ThermalStatusComponent({
  h,
}: Readonly<ComponentProps<ThermalStatusConfig>>) {
  const { noData, worstBand, hottest, engine, shield } = useThermal();

  // Selective rendering: the badge is always shown; rows drop from the bottom (heat shield first, then engine, then hottest-part) as height shrinks.
  const rows = h ?? 7;
  return (
    <ThermalStatusView
      noData={noData}
      worstBand={worstBand}
      hottest={rows >= 5 ? hottest : null}
      engine={rows >= 6 ? engine : null}
      shield={rows >= 7 && shield !== undefined ? shield : null}
    />
  );
}

registerComponent<ThermalStatusConfig>({
  id: "thermal-status",
  name: "Thermal",
  description:
    "Your vessel's temperatures: the hottest part, the hottest engine, and the heat shield's temperature and heat flux. Each reads nominal below 75% of its limit, warm from 75%, hot from 90% and critical from 97%, and an engine the game flags as overheating reads critical.",
  tags: ["telemetry", "thermal"],
  defaultSize: { w: 8, h: 7 },
  // Below four columns and five rows the body is the band pill alone, or its hottest part clipped.
  minSize: { w: 4, h: 5 },
  component: ThermalStatusComponent,
  tiny: {
    title: "THERMAL",
    useEssentials: useThermalEssentials,
  },
  channels: thermalTopics.channels,
  fields: thermalTopics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { ThermalStatusComponent };
