import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getAugmentsForSlot,
  useContributions,
} from "@ksp-gonogo/core";
import { stillTrue, VesselType } from "@ksp-gonogo/sitrep-sdk";
import {
  BigReadout,
  EmptyState,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  type ReadoutTone,
  Section,
  Unit,
  useElementSize,
} from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import {
  AVATAR_MEASURE_SEED,
  avatarCellSizePx,
  renderRoster,
} from "./CrewRoster";
import type { CrewStatusConfig } from "./config";
import { toCrewNames } from "./crewNames";
import { ROW_TONE_BY_SEVERITY } from "./slots";
import { EvaSuitReadout, suitTank } from "./suitResources";
import { crewStatusTopics } from "./topics";

/** Caps the tiny-mode hero readout so the number and its caption both fit a 3x3 panel. Fluid on purpose, so it sits off the type scale. */
const TINY_READOUT_STYLE = {
  fontSize: "clamp(20px, 4vw, 30px)",
  minHeight: 0,
} as const;

export function CrewStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<CrewStatusConfig>>) {
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

  // Suit resources are never held like the roster: they only fall, so a stale figure is drawn marked, never as current.
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
    const map = new Map<string, ReadoutTone>();
    for (const entry of rowToneContributions) {
      if (!map.has(entry.crewName)) {
        map.set(entry.crewName, ROW_TONE_BY_SEVERITY[entry.severity]);
      }
    }
    return map;
  }, [rowToneContributions]);

  // Read here as well as in `WidgetMeters` so the EVA solo-row check can see this kerbal's meters.
  const meterContributions = useContributions("meters");

  const names = toCrewNames(crewRaw);
  const known =
    crewCount !== undefined || crewCapacity !== undefined || names.length > 0;

  const cols = w ?? 6;
  const rows = h ?? 8;
  const showRoster = rows >= 5 && cols >= 4;

  if (!showRoster) {
    return (
      <Panel
        panelTitle="CREW"
        sections={
          <Section>
            {known ? (
              <BigReadout $tone="go" style={TINY_READOUT_STYLE}>
                {crewCount !== undefined ? (
                  <Unit value={crewCount} />
                ) : (
                  NULL_DISPLAY
                )}
                {crewCapacity !== undefined && (
                  <ReadoutCaption>
                    of <Unit value={crewCapacity} /> aboard
                  </ReadoutCaption>
                )}
              </BigReadout>
            ) : (
              <EmptyState>No crew data</EmptyState>
            )}
          </Section>
        }
      />
    );
  }

  // The headcount lives in the header badge; this line carries only the EVA marker.
  const crewSummary = known && isEVA === true ? "EVA" : "";

  // On EVA the header names the kerbal; with no single resolved name yet it falls back to a bare "EVA".
  const evaKerbalName =
    known && isEVA === true && names.length === 1 ? names[0] : undefined;

  // A Card showing only the name the header already carries is an empty box, so it is dropped unless something else is bound to that row.
  const evaRowHasBoundContent =
    evaKerbalName !== undefined &&
    (getAugmentsForSlot("crew-status.avatar").length > 0 ||
      getAugmentsForSlot("crew-status.row-badges").length > 0 ||
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
