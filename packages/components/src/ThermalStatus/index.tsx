import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import type { Band } from "./bands";
import { ThermalStatusView } from "./ThermalStatusView";
import { thermalTopics, useThermal } from "./useThermal";
import { useThermalEssentials } from "./useThermalEssentials";

type ThermalStatusConfig = Record<string, never>;

function ThermalStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<ThermalStatusConfig>>) {
  const { noData, worstBand, engineOverheat, hottest, engine, shield } =
    useThermal();

  // Selective rendering: pill is always shown; rows drop from the bottom (heat shield first, then engine, then hottest-part) as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 7;
  // The inline alert fires from hot, the band that still leaves time to act.
  const anyHotOrAbove = worstBand === "hot" || worstBand === "critical";

  return (
    <ThermalStatusView
      noData={noData}
      worstBand={worstBand}
      alertNote={
        anyHotOrAbove && cols >= 6
          ? alertNote(worstBand, engineOverheat === true)
          : null
      }
      hottest={rows >= 5 ? hottest : null}
      engine={rows >= 6 ? engine : null}
      shield={rows >= 7 && shield !== undefined ? shield : null}
    />
  );
}

function alertNote(worstBand: Band, engineOverheating: boolean): string {
  if (engineOverheating) return "Engine overheating (>90% max)";
  if (worstBand === "critical") return "Part at max temperature";
  return "Part approaching max temperature";
}

registerComponent<ThermalStatusConfig>({
  id: "thermal-status",
  name: "Thermal",
  description:
    "Aggregate thermal readouts: hottest part, hottest engine, heat shield temperature and flux. Alerts when any part or engine approaches its limit.",
  tags: ["telemetry", "thermal"],
  defaultSize: { w: 8, h: 7 },
  minSize: { w: 3, h: 4 },
  component: ThermalStatusComponent,
  tiny: {
    title: "THERMAL",
    // Below four columns and five rows the body is the band pill alone, or its hottest part clipped.
    bodyMinSize: { w: 4, h: 5 },
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
