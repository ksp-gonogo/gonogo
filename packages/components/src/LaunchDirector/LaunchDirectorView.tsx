import type { ComponentProps } from "@ksp-gonogo/core";
import { useGameContext, useTelemetry } from "@ksp-gonogo/core";
import { stillTrue } from "@ksp-gonogo/sitrep-sdk";
import { Panel, Section, Unit } from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import {
  FundsDrain,
  netFundsPerDay,
  reportsFundsDrain,
} from "../shared/FundsDrain";
import { magnitudeOf } from "../shared/magnitude";
import { BoundPresses } from "./actions";
import { parseCrew } from "./crew";
import { InFlightPanel } from "./InFlightPanel";
import { PadSection } from "./PadSection";
import { awayBodyNames, orderPads, padSummary, parseLaunchSites } from "./pads";
import { craftForPad, parseSavedShips } from "./ships";
import type { LaunchDirectorSlotContext } from "./slots";
import { DrainReadout, FundsReadout } from "./styles";
import { useFlightState } from "./useFlightState";
import { useLaunchCommands } from "./useLaunchCommands";

export type LaunchDirectorConfig = Record<string, never>;

/** The letterbox tile: wide enough for two readable columns, too short to stack them. */
const LETTERBOX_MIN_COLS = 14;
const LETTERBOX_MAX_ROWS = 6;

const SUBTITLE_STYLE = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
} as const;

export function LaunchDirectorComponent({
  h,
  w,
}: Readonly<ComponentProps<LaunchDirectorConfig>>) {
  /**
   * The pad's paperwork: craft files, the roster and unlocked sites change only
   * on events, so the last set received is still the answer.
   */
  const savedShipsRaw = stillTrue(
    useTelemetry("spaceCenter.savedShips"),
    undefined,
  );
  const crewRosterRaw = stillTrue(
    useTelemetry("spaceCenter.crewRoster"),
    undefined,
  );
  /**
   * The scene is a fact of the same kind, and it picks which panel renders: a
   * withheld scene would offer a launch while a vessel is up.
   */
  const sceneRecord = stillTrue(useTelemetry("spaceCenter.scene"), undefined);
  const launchSite = sceneRecord?.launchSite as string | undefined;
  // The raw per-site array, not `spaceCenter.state`, which collapses the list to the one entry carrying occupancy.
  const launchSitesRaw = stillTrue(
    useTelemetry("spaceCenter.launchSites"),
    undefined,
  );
  // A site names its body by index; the body catalogue is a fact, so a held one still answers.
  const bodies = stillTrue(useTelemetry("system.bodies"), undefined);
  const awayBodies = useMemo(
    () => awayBodyNames(bodies?.bodies ?? []),
    [bodies],
  );
  /**
   * The balance decides which craft are launchable, and that verdict is spent,
   * not read. Funds move while nobody looks, so a held balance is withheld.
   */
  const careerReading = useTelemetry("career.status");
  const careerEconomy =
    careerReading.state === "observed"
      ? careerReading.value.economy
      : undefined;
  const careerFunds = magnitudeOf(careerEconomy?.funds);
  // Drawn as the whole field reading, so a held balance stays on screen with the Unit's own mark.
  const fundsReading = careerReading.economy.funds;
  const hasFunds = stillTrue(careerReading, undefined)?.economy?.funds != null;
  const fundsHeld = careerReading.state === "stale";
  // The standing rate the elected money model reports, beside the balance rather than folded into the gate; stock reports none.
  const netFunds = netFundsPerDay(careerEconomy);
  const { chargesFunds } = useGameContext();
  const flight = useFlightState();
  const {
    boundPresses,
    launchCmd,
    recoverCmd,
    revertLaunchCmd,
    revertEditorCmd,
    toTrackingCmd,
    switchCmd,
  } = useLaunchCommands();

  const ships = parseSavedShips(savedShipsRaw);
  const crew = parseCrew(crewRosterRaw);
  const launchSites = parseLaunchSites(launchSitesRaw);
  // In the order the operator should read them: something on it first.
  const pads = useMemo(() => orderPads(launchSites ?? []), [launchSites]);

  const [selectedShip, setSelectedShip] = useState<string | null>(null);
  // Which pad row is open; null means the first pad in prioritised order stands in. Derived, so a pad that leaves cannot leave a dead selection.
  const [pickedPad, setPickedPad] = useState<string | null>(null);
  const [selectedCrew, setSelectedCrew] = useState<Set<string>>(new Set());
  const activePad = pads.find((p) => p.name === pickedPad) ?? pads[0];
  const selectedSite = activePad?.name ?? "";
  const scene = sceneRecord?.scene;

  // Absent funds are insufficient funds; sandbox and science charge nothing.
  const fundsAvailable = chargesFunds
    ? (careerFunds ?? 0)
    : Number.POSITIVE_INFINITY;
  const padCraft = craftForPad(activePad, ships);

  const rows = h ?? 9;
  const cols = w ?? 7;
  const showSubtitle = rows >= 4;
  const letterbox = cols >= LETTERBOX_MIN_COLS && rows <= LETTERBOX_MAX_ROWS;

  // Plain object, not a hook, so it can sit above the early return.
  const slotContext: LaunchDirectorSlotContext = {
    scene: scene ?? undefined,
    inFlight: scene === "Flight",
    selectedShip,
    selectedSite,
    selectedCrew: Array.from(selectedCrew),
    funds: careerFunds ?? undefined,
  };

  const inFlight = scene === "Flight";

  // The pads are the subject, so their absence is what empties the panel.
  if (launchSites === null && !inFlight) {
    return (
      <Panel
        panelTitle="LAUNCH & RECOVERY"
        compactTitle={["LAUNCH & REC", "LAUNCH"]}
        sections={
          showSubtitle ? (
            <Section full>
              <div role="status" style={SUBTITLE_STYLE}>
                Awaiting launch-pad telemetry
              </div>
            </Section>
          ) : null
        }
      />
    );
  }

  const activeName =
    flight.vesselName ?? activePad?.occupantName ?? "(unnamed)";

  return (
    <BoundPresses.Provider value={boundPresses}>
      <Panel
        panelTitle="LAUNCH & RECOVERY"
        compactTitle={["LAUNCH & REC", "LAUNCH"]}
        sections={[
          showSubtitle ? (
            <Section key="summary" full>
              <div role="status" aria-live="polite" style={SUBTITLE_STYLE}>
                {inFlight
                  ? `In flight: ${activeName}${launchSite && cols >= 6 ? ` · from ${launchSite}` : ""}`
                  : padSummary({
                      pads: pads.length,
                      occupied: pads.filter((p) => p.occupied === true).length,
                      unreported: pads.filter((p) => p.occupied === null)
                        .length,
                    })}
                {hasFunds && (
                  <FundsReadout
                    title={
                      fundsHeld
                        ? "Affordability is not judged against a held balance"
                        : "Available funds"
                    }
                  >
                    · <Unit value={fundsReading} />
                  </FundsReadout>
                )}
                {/* Not inside FundsReadout: that span is nowrap and would clip the drain. */}
                {reportsFundsDrain(netFunds) && (
                  <DrainReadout>
                    <FundsDrain
                      funds={careerFunds}
                      netPerDay={netFunds}
                      separator
                    />
                  </DrainReadout>
                )}
                {/* The balance is required beside a spend control. */}
                {!hasFunds && chargesFunds && (
                  <FundsReadout title="No funds balance has arrived">
                    · funds unknown
                  </FundsReadout>
                )}
              </div>
            </Section>
          ) : null,
          <Section key="pads">
            {inFlight ? (
              <InFlightPanel
                missionTime={flight.missionTime}
                altitudeMeters={flight.altitudeMeters}
                crashInProgress={flight.crashInProgress}
                availableVessels={flight.availableVessels}
                recoverCmd={recoverCmd}
                revertLaunchCmd={revertLaunchCmd}
                revertEditorCmd={revertEditorCmd}
                toTrackingCmd={toTrackingCmd}
                switchCmd={switchCmd}
              />
            ) : (
              <PadSection
                pads={pads}
                awayBodies={awayBodies}
                activePad={activePad}
                onPickPad={(name) => {
                  setPickedPad(name);
                  setSelectedShip(null);
                  setSelectedCrew(new Set());
                }}
                padCraft={padCraft}
                craftKnown={ships !== null}
                crew={crew}
                selectedShip={selectedShip}
                onSelectShip={(name) => {
                  setSelectedShip(name);
                  setSelectedCrew(new Set());
                }}
                selectedCrew={selectedCrew}
                onToggleCrew={(name) =>
                  setSelectedCrew((prev) => {
                    const next = new Set(prev);
                    if (next.has(name)) next.delete(name);
                    else next.add(name);
                    return next;
                  })
                }
                fundsAvailable={fundsAvailable}
                funds={careerFunds ?? undefined}
                rows={rows}
                letterbox={letterbox}
                launchCmd={launchCmd}
                recoverCmd={recoverCmd}
                revertEditorCmd={revertEditorCmd}
                slotContext={slotContext}
              />
            )}
          </Section>,
        ]}
      />
    </BoundPresses.Provider>
  );
}
