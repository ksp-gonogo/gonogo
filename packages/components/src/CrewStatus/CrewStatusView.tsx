import type { ComponentProps } from "@ksp-gonogo/core";
import { AugmentSlot, useContributions } from "@ksp-gonogo/core";
import { stillTrue, type Tone, VesselType } from "@ksp-gonogo/sitrep-sdk";
import {
  Panel,
  ReadoutCaption,
  Section,
  useElementSize,
  useSlotBound,
} from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import {
  AVATAR_MEASURE_SEED,
  avatarCellSizePx,
  renderRoster,
} from "./CrewRoster";
import type { CrewStatusConfig } from "./config";
import { toCrewNames } from "./crewNames";
import { ROW_CARD_TONE } from "./slots";
import { EvaSuitReadout, suitTank } from "./suitResources";
import { crewStatusTopics } from "./topics";

export function CrewStatusComponent(
  _props: Readonly<ComponentProps<CrewStatusConfig>>,
) {
  // A held roster is still the crew: nobody leaves the capsule because the link dropped.
  const crewReading = crewStatusTopics.useTelemetry("vessel.crew");
  const crew = stillTrue(crewReading, undefined);
  const crewRaw = crew?.crew;
  const crewCount = crew?.count;
  const crewCapacity = crew?.capacity;
  // Whether the crew is outside is a fact about the craft, so it holds while the link is quiet exactly as the roster beside it does.
  const identity = stillTrue(
    crewStatusTopics.useTelemetry("vessel.identity"),
    undefined,
  );
  const isEVA =
    identity === undefined ? undefined : identity.vesselType === VesselType.EVA;

  // Suit resources are not kept like the roster: they only fall, so a held figure is drawn marked, never as current.
  const resourcesReading = crewStatusTopics.useTelemetry("vessel.resources");
  const suitOxygen = isEVA ? suitTank(resourcesReading, "Oxygen") : undefined;
  const suitElectricCharge = isEVA
    ? suitTank(resourcesReading, "ElectricCharge")
    : undefined;

  const { ref: rosterWidthRef, size: rosterSize } =
    useElementSize<HTMLDivElement>(AVATAR_MEASURE_SEED);
  const avatarSizePx = avatarCellSizePx(rosterSize.w);

  const rowToneContributions = useContributions("crew-status.row-tone");
  const rowToneByName = useMemo(() => {
    const map = new Map<string, Tone>();
    for (const entry of rowToneContributions) {
      if (!map.has(entry.crewName)) {
        map.set(entry.crewName, ROW_CARD_TONE[entry.tone]);
      }
    }
    return map;
  }, [rowToneContributions]);

  // Read here as well as in `WidgetMeters` so the EVA solo-row check can see this kerbal's meters.
  const meterContributions = useContributions("meters");

  const names = toCrewNames(crewRaw);
  const known =
    crewCount !== undefined || crewCapacity !== undefined || names.length > 0;

  // The headcount lives in the header badge; this line carries only the EVA marker.
  const crewSummary = known && isEVA === true ? "EVA" : "";

  // On EVA the header names the kerbal; with no single resolved name yet it falls back to a bare "EVA".
  const evaKerbalName =
    known && isEVA === true && names.length === 1 ? names[0] : undefined;

  const avatarBound = useSlotBound("crew-status.avatar");
  const rowBadgesBound = useSlotBound("crew-status.row-badges");

  // A Card showing only the name the header already carries is an empty box, so it is dropped unless something else is bound to that row.
  const evaRowHasBoundContent =
    evaKerbalName !== undefined &&
    (avatarBound ||
      rowBadgesBound ||
      rowToneByName.has(evaKerbalName) ||
      meterContributions.some((entry) => entry.row === evaKerbalName));

  return (
    <Panel
      panelTitle="CREW"
      sections={
        <Section>
          <AugmentSlot name="crew-status.summary" props={{}} />
          {evaKerbalName ? (
            <ReadoutCaption>{evaKerbalName} · EVA</ReadoutCaption>
          ) : (
            crewSummary && <ReadoutCaption>{crewSummary}</ReadoutCaption>
          )}
          <EvaSuitReadout
            oxygen={suitOxygen}
            electricCharge={suitElectricCharge}
          />
          <div ref={rosterWidthRef}>
            {renderRoster({
              known,
              crewCount: crewCount?.magnitude,
              names,
              avatarSizePx,
              avatarBound,
              rowToneByName,
              omitCardFor:
                evaKerbalName !== undefined && !evaRowHasBoundContent
                  ? evaKerbalName
                  : undefined,
              suppressNameFor: evaRowHasBoundContent
                ? evaKerbalName
                : undefined,
            })}
          </div>
        </Section>
      }
    />
  );
}
