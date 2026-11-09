import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import { BAND_RANK } from "./bands";
import { ThermalStatusView } from "./ThermalStatusView";
import { thermalTopics, useThermal } from "./useThermal";
import { useThermalEssentials } from "./useThermalEssentials";

type ThermalStatusConfig = Record<string, never>;

function ThermalStatusComponent({
  h,
}: Readonly<ComponentProps<ThermalStatusConfig>>) {
  const { noData, worstBand, hottest, engine, engineIsHottestPart, shield } =
    useThermal();

  // Selective rendering: the badge is always shown; rows drop from the bottom (heat shield first, then engine, then hottest-part) as height shrinks. An engine that sets the badge keeps its row, so the badge never names a cause the body does not show.
  const rows = h ?? 7;
  const engineSetsBadge = BAND_RANK[engine.band] > BAND_RANK[hottest.band];
  return (
    <ThermalStatusView
      noData={noData}
      worstBand={worstBand}
      hottest={rows >= 5 ? hottest : null}
      engine={
        !engineIsHottestPart && (rows >= 6 || engineSetsBadge) ? engine : null
      }
      shield={rows >= 7 && shield !== undefined ? shield : null}
    />
  );
}

registerComponent<ThermalStatusConfig>({
  id: "thermal-status",
  name: "Thermal",
  description:
    "Temperatures of your hottest part, hottest engine and heat shield.",
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
