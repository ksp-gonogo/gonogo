import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  registerComponent,
  useGameContext,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  META_VANTAGE,
  type Reading,
  type SpaceCenterState,
  useCommand,
  useStream,
  useViewUt,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import {
  KSP_EDITOR_FACILITY_NAMES,
  TargetKind,
  type TargetListEntry,
  VesselType,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  type CommandButtonHandle,
  NULL_DISPLAY,
  Panel,
  Spinner,
  Unit,
  useCommandButton,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import styled from "styled-components";
import {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "../shared/magnitude";

type LaunchDirectorConfig = Record<string, never>;

/**
 * The context both LaunchDirector slots pass to their augments. A
 * life-support / logistics Uplink reads the pre-launch selection (which craft,
 * crew and site the operator is about to commit) to append a checklist item or
 * a header badge: e.g. Kerbalism supplies-for-duration, USI-LS habitation.
 */
export interface LaunchDirectorSlotContext {
  /** Current KSP scene ("Flight", "Editor", ...); undefined until telemetry arrives. */
  scene: string | undefined;
  /** True while a vessel is in flight (scene === "Flight"). */
  inFlight: boolean;
  /** The saved craft selected in the pre-launch picker, or null when none. */
  selectedShip: string | null;
  /** The chosen launch-site name (e.g. "LaunchPad"). */
  selectedSite: string;
  /** Crew names the operator has selected for the launch. */
  selectedCrew: string[];
  /** Career funds balance; undefined in sandbox/science or before telemetry. */
  funds: number | undefined;
}

// Declaration-merge the slot ids onto their props type in core's `SlotRegistry`.
// Co-located here (not a shared central file) so parallel slot work on
// other widgets can't collide. This makes `registerAugment` and
// `<AugmentSlot name="launch-director.preflight" ...>` type-check against
// `LaunchDirectorSlotContext` rather than the loose fallback.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "launch-director.preflight": LaunchDirectorSlotContext;
  }
}

export interface SavedShip {
  name: string;
  partCount: number;
  totalMass: number;
  /** KSP's own `EditorFacility` name, verbatim: the label shown on the row. */
  facility: string;
  /**
   * KSP's `EditorFacility` ORDINAL (`KspEditorFacility`), `null` when the
   * producer sent none. This is what decides which editor the craft launches
   * from; {@link facility} is only ever displayed.
   */
  facilityOrdinal: number | null;
  requiresFunds: number;
  missingParts: string[];
}

export interface CrewMember {
  name: string;
  trait: string;
  experienceLevel: number;
  available: boolean;
  unavailableReason: string;
}

export interface LaunchSiteEntry {
  name: string;
  displayName: string;
  facility: string;
  body: string;
  ready: boolean;
  unlocked: boolean;
}

/**
 * The editor a saved craft launches from, as the `ksp.launch` command spells it.
 *
 * Derived from the ORDINAL, not from KSP's name. Checking the name against a
 * hand-written `{"VAB", "SPH"}` set and substituting `"VAB"` on a miss puts
 * that substitution straight into the command's `facility` argument, and a
 * default that becomes a dispatched argument is not a fallback: it launches a
 * spaceplane from the launchpad. Such a set also misses `None`, which KSP
 * declares.
 *
 * The mod refuses an unrecognised facility outright (`CommandErrorCode.Range`,
 * see `FlightOpsCommandProvider.ParseEditorFacility`), so passing the raw name
 * through on an unknown ordinal gets the operator a visible refusal, which is
 * the correct outcome and the one the substitution was hiding. Resolving from
 * the ordinal also means a craft KSP has RENAMED still launches from the right
 * editor, because the ordinal is the fact and the mirror knows what it means.
 */
function launchFacilityArg(ship: SavedShip): string {
  const resolved =
    ship.facilityOrdinal === null
      ? undefined
      : KSP_EDITOR_FACILITY_NAMES.get(ship.facilityOrdinal);
  // `None` is a declared member and not an editor, so it is not launchable; let
  // the mod say so rather than choosing an editor on the player's behalf.
  if (resolved === undefined || resolved === "None") return ship.facility;
  return resolved;
}

/** `Sitrep.Contract.VesselType`'s C# declared order (VesselEnums.cs): the
 * ordinal -> display-label bridge for the `target.available` roster. Same
 * array TargetPicker's `normalizeRoster` uses. Index-alignment with the
 * generated SDK `VesselType` enum is locked by the drift-guard test in
 * `../TargetPicker/enumLabelDrift.test.ts` (imported there under the
 * `LAUNCH_DIRECTOR_VESSEL_TYPE_LABELS` alias exported at the bottom of this
 * file: TargetPicker declares an identically-named const of its own, and
 * both can't be bare-named at the package's `export *` barrel). */
const VESSEL_TYPE_LABELS: readonly string[] = [
  "Ship",
  "Station",
  "Lander",
  "Probe",
  "Rover",
  "Base",
  "Relay",
  "EVA",
  "Flag",
  "Debris",
  "SpaceObject",
  "DeployedScienceController",
  "DeployedSciencePart",
  "DroppedPart",
  "Unknown",
];

/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

/**
 * Parse `kc.launchSites`. Returns null when the key is absent (older fork
 * without the handler) so the picker can collapse rather than render empty.
 * Making History adds non-stock sites; without it only stock sites appear.
 *
 * Two wire shapes land here:
 * - Legacy GonogoTelemetry: `{ name, displayName, facility, body, ready,
 *   unlocked }`.
 * - New SDK `spaceCenter.launchSites` (mapped onto this key via map-topic.ts):
 *   the mod's `LaunchSiteEntry`: `editorFacility` in place of `facility`,
 *   `bodyIndex` in place of the body name, and `isStock` instead of a
 *   `ready`/`unlocked` pair. The mod enumerates `PSystemSetup.LaunchSites`
 *   (the sites actually available to launch from), so a new-shape entry is
 *   treated as selectable (`unlocked: true`): the alternative (no `unlocked`
 *   field → every site non-selectable → the picker vanishes) would silently
 *   drop the feature.
 */
export function parseLaunchSites(raw: unknown): LaunchSiteEntry[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: LaunchSiteEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : null;
    if (!name) continue;
    // New-shape detection: the mod entry has `editorFacility`/`isStock` and no
    // legacy `unlocked` field.
    const isNewShape = !("unlocked" in e) && "editorFacility" in e;
    const facility =
      typeof e.facility === "string"
        ? e.facility
        : typeof e.editorFacility === "string"
          ? e.editorFacility
          : "";
    out.push({
      name,
      displayName:
        typeof e.displayName === "string" && e.displayName
          ? e.displayName
          : name,
      facility,
      body: typeof e.body === "string" ? e.body : "",
      ready: e.ready === true,
      unlocked: isNewShape ? true : e.unlocked === true,
    });
  }
  return out;
}

export function parseSavedShips(raw: unknown): SavedShip[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: SavedShip[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : null;
    if (!name) continue;
    out.push({
      name,
      partCount: magnitudeOr(e.partCount as Quantityish, 0),
      totalMass: magnitudeOr(e.totalMass as Quantityish, 0),
      facility: typeof e.facility === "string" ? e.facility : "",
      facilityOrdinal:
        typeof e.facilityOrdinal === "number" ? e.facilityOrdinal : null,
      requiresFunds: magnitudeOr(e.requiresFunds as Quantityish, 0),
      missingParts: Array.isArray(e.missingParts)
        ? e.missingParts.filter((p): p is string => typeof p === "string")
        : [],
    });
  }
  return out;
}

export function parseCrew(raw: unknown): CrewMember[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: CrewMember[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : null;
    if (!name) continue;
    out.push({
      name,
      trait: typeof e.trait === "string" ? e.trait : "",
      experienceLevel: magnitudeOr(e.experienceLevel as Quantityish, 0),
      available: e.available === true,
      unavailableReason:
        typeof e.unavailableReason === "string" ? e.unavailableReason : "",
    });
  }
  return out;
}

function LaunchDirectorComponent({
  h,
  w,
}: Readonly<ComponentProps<LaunchDirectorConfig>>) {
  /**
   * The pad's paperwork. A .craft file on disk, a kerbal's place on the roster
   * and an unlocked launch site are not measurements: each changes when an event
   * changes it, and no such event can reach us down a link that is not
   * delivering, so the last set received is still the answer. Withholding them
   * would be worse than useless here, because this widget reads a missing craft
   * list as "nothing has arrived" and replaces its entire body with a wait
   * message, funds and crew included.
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
   * One read of the record, both fields off it: two subscriptions to the same
   * derived channel cannot disagree usefully, and a cast on each
   * (`as boolean | undefined`, `as string | undefined`) erases a `null` the
   * channel genuinely reports, collapsing an unreported pad and a pad reported
   * clear into one value.
   *
   * Only `true` makes a pad claim below. `null`/`undefined` fall through to
   * the saved-craft list, which describes what we do have without asserting
   * the pad is clear.
   */
  const spaceCentre = useStream<SpaceCenterState>("spaceCenter.state");
  const padOccupied = spaceCentre?.padOccupied;
  const padVesselTitle = spaceCentre?.padVesselTitle;
  /**
   * One read of the record; `launchSite` here and `scene` below are two fields of
   * the same payload, so nothing about them can differ in how current it is.
   *
   * The scene is a fact of the same kind, and the one this widget can least
   * afford to drop: it picks which panel renders. A withheld scene reads as
   * "not in flight", which would swap the recover / revert controls of a live
   * flight for the pre-launch craft picker, offering a launch while a vessel is
   * up.
   */
  const sceneRecord = stillTrue(useTelemetry("spaceCenter.scene"), undefined);
  const launchSite = sceneRecord?.launchSite as string | undefined;
  const launchSitesRaw = stillTrue(
    useTelemetry("spaceCenter.launchSites"),
    undefined,
  );
  /**
   * The balance is the one judgement input on the pre-launch side: it decides
   * which craft this widget calls launchable and which it tags unaffordable, and
   * that verdict is spent, not read. Funds move while nobody is looking (a
   * contract pays out, a facility bills for repairs), so a held balance is not
   * evidence of what the save can afford now, and the affordability gate below
   * already treats an unknown balance as no balance.
   */
  const careerReading = useTelemetry("career.status");
  const careerFunds = magnitudeOf(judgeable(careerReading)?.economy?.funds);
  /**
   * Which of the reasons for a missing balance applies. A never-arrived balance
   * and a balance that has stopped being current blank the same readout and block
   * the same priced craft, so the caption has to separate them: otherwise the
   * widget accuses the link of dropping on every cold start.
   */
  const fundsNotCurrent = notCurrent(careerReading);
  const { chargesFunds } = useGameContext();
  // career.funds -> career.status.economy.funds is the one
  // MAPPED read in this widget (a funds spender per CLAUDE.md's "always show
  // the balance" rule). kc.savedShips/kc.crewRoster resolve to their own
  // dedicated topics too (map-topic.ts); crash.hasRecent/crash.lastCrash now
  // read their topics directly (useStream/useTelemetry), off the shim.
  // The rest of the kc.*/ksp.* reads below stay legacy, kc.* has no
  // career.status equivalent shape (see map-topic.ts's doc comment on the
  // facilities gap), the others are separate provider families or
  // vessel-provider gaps with no wire home yet. The vessel-switcher below
  // reads `target.available` directly (a canonical topic, no shim).
  // In-flight context: populated when scene === "Flight".
  // The craft's name is set in the editor and changes nowhere else, so the last
  // one received still names the vessel that is flying.
  const vesselName = stillTrue(
    useTelemetry("vessel.identity"),
    undefined,
  )?.name;
  const missionTime = useStream<VesselState>("vessel.state")?.met;
  const altitudeMeters = useStream<VesselState>("vessel.state")?.altitudeAsl;
  /**
   * Whether the save still holds a revert point is a capability the game grants
   * and withdraws on events (entering flight, then saving over it), never
   * something that decays on its own. Withholding it would grey both controls out
   * and label them "(n/a)", which states that the save cannot revert when it
   * demonstrably still can, and each control is armed then confirmed anyway, so a
   * revert the game has since disallowed fails at the desk rather than costing
   * the flight.
   */
  const revertAvailability = stillTrue(
    useTelemetry("ksp.revertAvailability"),
    undefined,
  );
  const canRevertToLaunch = revertAvailability?.canRevertToLaunch;
  const canRevertToEditor = revertAvailability?.canRevertToEditor;
  // crash.hasRecent is a real wire boolean (CrashUplink, ReliableOrdered)
  // but still missing from the SDK's hand-declared Topic tail, the backing
  // C# const lacks the "...Topic" suffix topics.test.ts's crosscheck scans
  // for, so `useTelemetry("crash.hasRecent")` won't typecheck. `useStream`
  // is the sanctioned read for an untyped tail topic: same route off the
  // mounted store, no legacy shim. FlightOutcomeBanner reads it identically.
  const crashHasRecent = useStream<boolean>("crash.hasRecent");
  // crash.hasRecent is session-wide, a debris crash from a previous flight
  // would block recovery of a successfully landed craft. Pull the most
  // recent crash snapshot too so we can scope the gate to the active
  // vessel only. User reported this twice on 2026-05-17 (21:15, 23:12 BST).
  //
  // A crash report records something that already happened, so it stays true
  // until the next crash replaces it or a revert undoes the timeline (which the
  // ut comparison below catches). Withholding it would strip the gate of the
  // per-vessel scoping it exists for and hand the session-wide flag back the
  // false block on a successful landing that this snapshot was added to fix.
  const lastCrash = stillTrue(useTelemetry("crash.lastCrash"), undefined);
  // For the revert-staleness guard below: a revert rewinds universal time
  // below the crash snapshot's capture ut. t.universalTime is dropped as a
  // data key (it was never a stream; it IS the SDK view-UT), so read that
  // directly.
  // Stays an instant: its only use is the ordering below, and comparing two
  // instants is something the algebra does. It was unwrapped here because the
  // guard tested it with `typeof === "number"`, which answers NO for a wrapped
  // value and would have silently stopped recognising a post-dated snapshot.
  const viewUt = useViewUt();
  // `target.available` ships the switcher's real roster: the producer
  // (TargetProvider) already excludes the active vessel itself, so no extra
  // exclusion is needed here. Narrow to Vessel-kind entries only; bodies and
  // parts aren't "switch active vessel" targets.
  //
  // The roster is a fact, exactly as it is in the TargetPicker: other craft do
  // not stop existing because the link dropped, and a switcher with no rows is
  // useless, so the last roster stands.
  const targetAvailable = stillTrue(
    useTelemetry("target.available"),
    undefined,
  );
  const availableVessels = targetAvailable?.entries?.filter(
    (e) => e.kind === TargetKind.Vessel,
  );
  // LAUNCH is a delayed command to the pad, so it dispatches at the session
  // vantage. The non-launch scene ops (recover / revert / to-tracking-station /
  // switch vessel) are KSC-desk actions with no vessel signal delay, so they
  // dispatch at the meta-vantage (instant). Every handle is contributed to the
  // panel delay rail by usePanelDelay below.
  const launchCmd = useCommand("ksp.launch");
  const recoverCmd = useCommand("ksp.recover", { vantage: META_VANTAGE });
  const revertLaunchCmd = useCommand("ksp.revertToLaunch", {
    vantage: META_VANTAGE,
  });
  const revertEditorCmd = useCommand("ksp.revertToEditor", {
    vantage: META_VANTAGE,
  });
  const toTrackingCmd = useCommand("ksp.toTrackingStation", {
    vantage: META_VANTAGE,
  });
  const switchCmd = useCommand("ksp.switchVessel", { vantage: META_VANTAGE });
  usePanelDelay(launchCmd);
  usePanelDelay(recoverCmd);
  usePanelDelay(revertLaunchCmd);
  usePanelDelay(revertEditorCmd);
  usePanelDelay(toTrackingCmd);
  usePanelDelay(switchCmd);

  const ships = parseSavedShips(savedShipsRaw);
  const crew = parseCrew(crewRosterRaw);
  const launchSites = parseLaunchSites(launchSitesRaw);
  // Only sites the save can actually launch from; a single option is no
  // choice, so the picker collapses below.
  const selectableSites = (launchSites ?? []).filter((s) => s.unlocked);

  const [selectedShip, setSelectedShip] = useState<string | null>(null);
  // Launch destination site; defaults to the stock pad to preserve prior
  // behaviour. Per-launch context, deliberately not persisted in config.
  const [selectedSite, setSelectedSite] = useState<string>("LaunchPad");
  const [selectedCrew, setSelectedCrew] = useState<Set<string>>(new Set());
  const selectedSiteLabel =
    (launchSites ?? []).find((s) => s.name === selectedSite)?.displayName ??
    selectedSite;
  const scene = sceneRecord?.scene;

  const ship = useMemo(
    () => (selectedShip ? ships?.find((s) => s.name === selectedShip) : null),
    [ships, selectedShip],
  );

  // Absent funds are insufficient funds: this gate guards a control that spends
  // career funds, and "no balance ever arrived" is not evidence that the
  // operator can afford anything. Sandbox and science charge nothing, so there
  // is no affordability question to answer there.
  const fundsAvailable = chargesFunds
    ? (careerFunds ?? 0)
    : Number.POSITIVE_INFINITY;
  const launchableShips =
    ships?.filter(
      (s) => s.missingParts.length === 0 && s.requiresFunds <= fundsAvailable,
    ) ?? [];

  const rows = h ?? 9;
  const showSubtitle = rows >= 4;

  // Props both augment slots pass down. A plain object rather than a
  // hook so it can sit above the early return without a conditional `useMemo`; a
  // fresh reference per render is fine since `AugmentSlot`'s subscription is
  // store-driven and the live selection changes anyway.
  const slotContext: LaunchDirectorSlotContext = {
    scene,
    inFlight: scene === "Flight",
    selectedShip,
    selectedSite,
    selectedCrew: Array.from(selectedCrew),
    funds: careerFunds ?? undefined,
  };

  if (ships === null) {
    return (
      <Panel panelTitle="LAUNCH & RECOVERY">
        <Body>
          {showSubtitle && (
            <div
              role="status"
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--color-text-faint)",
              }}
            >
              Awaiting launch-pad telemetry
            </div>
          )}
        </Body>
      </Panel>
    );
  }

  const inFlight = scene === "Flight";
  const activeName = vesselName ?? padVesselTitle ?? "(unnamed)";
  // Only treat recovery as "crash-blocked" when the most recent crash is
  // for the active vessel: otherwise a debris crash from earlier in the
  // session would stop the operator recovering a successful landing.
  // Falls back to the session-wide flag if the snapshot hasn't arrived
  // yet (rare; the host emits both keys in the same WS tick) so the gate
  // is fail-safe rather than fail-open.
  // A crash snapshot dated AFTER the current universal time belongs to a
  // reverted (undone) timeline: reverting rewinds UT below the capture ut.
  // The provider clears the snapshot server-side on the same rule; this
  // mirror keeps the gate correct against older deployed builds. User hit
  // this on 2026-06-12: post-revert, the chip blocked recovery forever
  // because the reverted vessel shares the crashed vessel's name.
  const crashStale =
    lastCrash?.ut != null &&
    viewUt !== undefined &&
    lastCrash.ut.greaterThan(viewUt);
  const crashBlocked =
    !crashStale &&
    crashHasRecent === true &&
    (lastCrash == null
      ? true
      : typeof lastCrash.vesselName === "string" &&
        lastCrash.vesselName.length > 0 &&
        lastCrash.vesselName === vesselName);

  return (
    <Panel panelTitle="LAUNCH & RECOVERY">
      <Body>
        {showSubtitle && (
          <div
            role="status"
            aria-live="polite"
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-faint)",
            }}
          >
            {inFlight
              ? `In flight: ${activeName}${launchSite && (w ?? 7) >= 6 ? ` · from ${launchSite}` : ""}`
              : padOccupied
                ? `On pad: ${activeName}`
                : `${launchableShips.length}/${ships.length} ready · ${selectedSiteLabel}`}
            {typeof careerFunds === "number" && (
              <FundsReadout title="Available funds">
                · <Unit value={value("funds", careerFunds)} />
              </FundsReadout>
            )}
            {/* The balance is required beside a spend control, and an absent
                balance is the state that rule exists for: it is exactly when
                the affordability gate above has nothing to judge against. The
                two ways of having no balance say so differently, because every
                priced craft is blocked either way and the operator has to know
                whether that is a cold start or a link that stopped. */}
            {careerFunds === null && chargesFunds && (
              <FundsReadout
                title={
                  fundsNotCurrent
                    ? "The last funds balance is no longer current, so affordability is not being judged"
                    : "No funds balance has arrived"
                }
              >
                · {fundsNotCurrent ? "funds not current" : "funds unknown"}
              </FundsReadout>
            )}
          </div>
        )}
        {inFlight ? (
          <InFlightPanel
            missionTime={missionTime ?? null}
            altitudeMeters={altitudeMeters ?? null}
            canRevertToLaunch={canRevertToLaunch ?? false}
            canRevertToEditor={canRevertToEditor ?? false}
            crashBlocked={crashBlocked}
            availableVessels={availableVessels}
            recoverCmd={recoverCmd}
            revertLaunchCmd={revertLaunchCmd}
            revertEditorCmd={revertEditorCmd}
            toTrackingCmd={toTrackingCmd}
            switchCmd={switchCmd}
          />
        ) : padOccupied ? (
          <PadActions>
            <ArmedButton
              kind="recover"
              handle={recoverCmd}
              commandLabel="Recover"
              label="Recover"
              confirmLabel="Confirm recover"
              pendingLabel="Recovering..."
            />
            {/* Revert always to VAB by default; the mod's revertToEditor
                command accepts vab|sph but the widget cannot tell which editor
                the original craft came from from flight state alone. */}
            <ArmedButton
              kind="revert"
              handle={revertEditorCmd}
              args={{ editor: "vab" }}
              commandLabel="Revert to VAB"
              label="Revert to VAB"
              confirmLabel="Confirm revert"
              pendingLabel="Reverting..."
            />
          </PadActions>
        ) : (
          <>
            <SectionLabel>Saved craft</SectionLabel>
            <ShipList>
              {ships.map((s) => {
                const blocked =
                  s.missingParts.length > 0 || s.requiresFunds > fundsAvailable;
                return (
                  <ShipRow
                    key={`${s.facility}/${s.name}`}
                    type="button"
                    data-ship-row
                    $selected={selectedShip === s.name}
                    $blocked={blocked}
                    aria-pressed={selectedShip === s.name}
                    aria-disabled={blocked}
                    onClick={() => {
                      if (blocked) return;
                      if (selectedShip === s.name) {
                        setSelectedShip(null);
                        setSelectedCrew(new Set());
                        return;
                      }
                      setSelectedShip(s.name);
                      setSelectedCrew(new Set());
                    }}
                  >
                    <ShipMeta>
                      <ShipName>{s.name}</ShipName>
                      <ShipDetails>
                        {s.facility} · {s.partCount} parts ·{" "}
                        <Unit value={value("t", s.totalMass)} decimals={1} />
                      </ShipDetails>
                    </ShipMeta>
                    <ShipCost>
                      {s.requiresFunds > fundsAvailable && (
                        <BlockedTag title="Insufficient funds">
                          {s.requiresFunds.toFixed(0)}
                          <Unit>funds</Unit>
                        </BlockedTag>
                      )}
                      {s.requiresFunds <= fundsAvailable &&
                        s.requiresFunds > 0 && (
                          <CostTag>
                            {s.requiresFunds.toFixed(0)}
                            <Unit>funds</Unit>
                          </CostTag>
                        )}
                      {s.missingParts.length > 0 && (
                        <BlockedTag
                          title={`Missing: ${s.missingParts.join(", ")}`}
                        >
                          {s.missingParts.length} locked
                        </BlockedTag>
                      )}
                    </ShipCost>
                  </ShipRow>
                );
              })}
            </ShipList>

            {ship && crew && (
              <>
                <SectionLabel>Crew</SectionLabel>
                <CrewGrid>
                  {crew.map((k) => (
                    <CrewChip
                      key={k.name}
                      type="button"
                      $selected={selectedCrew.has(k.name)}
                      $disabled={!k.available}
                      title={
                        k.available
                          ? `${k.trait} · L${k.experienceLevel}`
                          : k.unavailableReason
                      }
                      onClick={() => {
                        if (!k.available) return;
                        setSelectedCrew((prev) => {
                          const next = new Set(prev);
                          if (next.has(k.name)) next.delete(k.name);
                          else next.add(k.name);
                          return next;
                        });
                      }}
                    >
                      <CrewName>{k.name}</CrewName>
                      <CrewTrait>
                        {k.trait || NULL_DISPLAY}
                        {k.available ? ` L${k.experienceLevel}` : ""}
                      </CrewTrait>
                    </CrewChip>
                  ))}
                </CrewGrid>

                {selectableSites.length > 1 && (
                  <>
                    <SectionLabel>Launch site</SectionLabel>
                    <SiteList>
                      {selectableSites.map((s) => (
                        <SiteChip
                          key={s.name}
                          type="button"
                          $selected={selectedSite === s.name}
                          aria-pressed={selectedSite === s.name}
                          onClick={() => setSelectedSite(s.name)}
                        >
                          <SiteName>{s.displayName}</SiteName>
                          <SiteMeta>
                            {s.facility}
                            {s.body && s.body !== "Kerbin"
                              ? ` · ${s.body}`
                              : ""}
                          </SiteMeta>
                        </SiteChip>
                      ))}
                    </SiteList>
                  </>
                )}

                <LaunchControls>
                  <ArmedButton
                    kind="launch"
                    handle={launchCmd}
                    args={{
                      shipName: ship.name,
                      facility: launchFacilityArg(ship),
                      site: selectedSite,
                      crew: Array.from(selectedCrew),
                    }}
                    commandLabel={`Launch ${ship.name}`}
                    label={
                      selectedCrew.size > 0
                        ? `Launch ${ship.name} (${selectedCrew.size} crew)`
                        : `Launch ${ship.name} unmanned`
                    }
                    confirmLabel="Confirm launch"
                    pendingLabel="Launching..."
                  />
                </LaunchControls>
              </>
            )}
            {/* Pre-launch checklist augments: a life-support / logistics Uplink
                appends a checklist item here. Empty until bound; the
                funds readout and existing controls above are untouched. */}
            <AugmentSlot name="launch-director.preflight" props={slotContext} />
          </>
        )}
      </Body>
    </Panel>
  );
}

function InFlightPanel({
  missionTime,
  altitudeMeters,
  canRevertToLaunch,
  canRevertToEditor,
  crashBlocked,
  availableVessels,
  recoverCmd,
  revertLaunchCmd,
  revertEditorCmd,
  toTrackingCmd,
  switchCmd,
}: {
  missionTime: number | null;
  altitudeMeters: number | null;
  canRevertToLaunch: boolean;
  canRevertToEditor: boolean;
  crashBlocked: boolean;
  availableVessels: TargetListEntry[] | undefined;
  /**
   * The handles, not callbacks: each control below holds its own arm and
   * in-flight state off the handle it is given, so no armed-kind enum travels
   * down from the widget any more.
   */
  recoverCmd: CommandButtonHandle;
  revertLaunchCmd: CommandButtonHandle;
  revertEditorCmd: CommandButtonHandle;
  toTrackingCmd: CommandButtonHandle;
  switchCmd: CommandButtonHandle;
}) {
  const [switchOpen, setSwitchOpen] = useState(false);
  // The Tracking Station control keeps its own warning-worded chrome (leaving
  // may cost the flight), so it takes the behaviour hook rather than the
  // default rendering.
  const trackingStation = useCommandButton({
    handle: toTrackingCmd,
    commandLabel: "Go to Tracking Station",
  });
  const [showSpaceObjects, setShowSpaceObjects] = useState(false);
  const totalAvailable = availableVessels?.length ?? 0;
  const spaceObjectCount = useMemo(
    () =>
      (availableVessels ?? []).filter(
        (e) => e.vesselType === VesselType.SpaceObject,
      ).length,
    [availableVessels],
  );
  const switchableVessels = useMemo(() => {
    const entries = availableVessels ?? [];
    // Filter SpaceObjects (asteroids / comets) by default, same UX call as
    // the TargetPicker. The toggle below reveals them for the long tail
    // where the operator actually wants to switch to one.
    const list = showSpaceObjects
      ? entries
      : entries.filter((e) => e.vesselType !== VesselType.SpaceObject);
    return [...list].sort((a, b) => {
      const da = magnitudeOf(a.distance) ?? Number.POSITIVE_INFINITY;
      const db = magnitudeOf(b.distance) ?? Number.POSITIVE_INFINITY;
      return da - db;
    });
  }, [availableVessels, showSpaceObjects]);
  return (
    <InFlightWrap>
      {crashBlocked && (
        <CrashChip role="status">
          Crash in progress: return to Space Center to recover
        </CrashChip>
      )}
      <FlightStats>
        <FlightStatRow>
          <StatLabel>Mission time</StatLabel>
          <StatValue>{formatMissionTime(missionTime)}</StatValue>
        </FlightStatRow>
        <FlightStatRow>
          <StatLabel>Altitude</StatLabel>
          <StatValue>{<Altitude m={altitudeMeters} />}</StatValue>
        </FlightStatRow>
      </FlightStats>
      <PadActions>
        <ArmedButton
          kind="recover"
          handle={recoverCmd}
          commandLabel="Recover"
          label="Recover"
          confirmLabel="Confirm recover"
          pendingLabel="Recovering..."
          disabled={crashBlocked}
        />
        <ArmedButton
          kind="revert"
          handle={revertLaunchCmd}
          commandLabel="Revert to launch"
          label={
            canRevertToLaunch ? "Revert to launch" : "Revert to launch (n/a)"
          }
          confirmLabel="Confirm revert to launch"
          pendingLabel="Reverting..."
          disabled={!canRevertToLaunch}
        />
        <ArmedButton
          kind="revert"
          handle={revertEditorCmd}
          args={{ editor: "vab" }}
          commandLabel="Revert to VAB"
          label={canRevertToEditor ? "Revert to VAB" : "Revert to VAB (n/a)"}
          confirmLabel="Confirm revert to VAB"
          pendingLabel="Reverting..."
          disabled={!canRevertToEditor}
        />
        {trackingStation.isPending ? (
          <TrackingStationConfirm type="button" disabled aria-busy="true">
            <Spinner size={12} /> Leaving...
          </TrackingStationConfirm>
        ) : trackingStation.isArmed || trackingStation.isRefused ? (
          <TrackingStationConfirm
            type="button"
            onClick={() => trackingStation.press(true)}
            title={
              trackingStation.refusalText ??
              "KSP may revert this flight to its last save if it can't save here (the in-game warning dialog has no equivalent on the wire)."
            }
            aria-label={trackingStation.refusalText ?? undefined}
          >
            {trackingStation.isRefused
              ? "Refused"
              : "Confirm: flight may revert"}
          </TrackingStationConfirm>
        ) : (
          <TrackingStationButton
            type="button"
            onClick={() => trackingStation.press(true)}
            title="Tracking Station: KSP may revert this flight if it can't save here"
          >
            Tracking Station
          </TrackingStationButton>
        )}
        <TrackingStationButton
          type="button"
          disabled={totalAvailable === 0}
          aria-expanded={switchOpen}
          aria-haspopup="listbox"
          onClick={() => setSwitchOpen((v) => !v)}
          title={
            totalAvailable === 0
              ? "No other vessels in this save"
              : `Switch to one of ${totalAvailable} other vessel${totalAvailable === 1 ? "" : "s"}`
          }
        >
          Switch to vessel ▾
        </TrackingStationButton>
      </PadActions>
      {switchOpen && totalAvailable > 0 && (
        <VesselSwitchPanel role="listbox" aria-label="Switch active vessel">
          {spaceObjectCount > 0 && (
            <SpaceObjectToggle
              type="button"
              aria-pressed={showSpaceObjects}
              onClick={() => setShowSpaceObjects((v) => !v)}
              title={
                showSpaceObjects
                  ? "Hide asteroids / comets from the list"
                  : "Show asteroids / comets in the list"
              }
            >
              {showSpaceObjects
                ? `Asteroids: shown (${spaceObjectCount})`
                : `Asteroids: hidden (${spaceObjectCount})`}
            </SpaceObjectToggle>
          )}
          {switchableVessels.length === 0 ? (
            <VesselSwitchHint>No other vessels to show.</VesselSwitchHint>
          ) : (
            switchableVessels.map((entry) => (
              <VesselSwitchRow
                key={entry.vesselId ?? entry.name}
                type="button"
                onClick={() => {
                  if (!entry.vesselId) return;
                  setSwitchOpen(false);
                  void switchCmd.send({ vesselId: entry.vesselId });
                }}
              >
                <VesselSwitchName>
                  <span>{entry.name}</span>
                  <VesselSwitchMeta>
                    {VESSEL_TYPE_LABELS[entry.vesselType ?? -1] ?? "Unknown"}
                  </VesselSwitchMeta>
                </VesselSwitchName>
                <VesselSwitchDistance>
                  <Altitude m={magnitudeOf(entry.distance)} />
                </VesselSwitchDistance>
              </VesselSwitchRow>
            ))
          )}
        </VesselSwitchPanel>
      )}
    </InFlightWrap>
  );
}

function formatMissionTime(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return NULL_DISPLAY;
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) {
    return `T+${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `T+${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

// Through the shared `length` ladder rather than a local km ceiling: this is
// the in-flight altitude readout, and a Mun transfer sits at ~12 Mm, which the
// hand-rolled version rendered as "12000.0 km".
function Altitude({ m }: { m: number | null }) {
  if (m === null) return NULL_DISPLAY;
  return <Unit value={value("m", m)} />;
}

/**
 * The pad/flight action button. Behaviour is the shared `useCommandButton`; the
 * chrome stays local because each verb carries its own colour (`$kind`), which
 * is how the operator tells a recover from a revert at a glance in a stack of
 * four, and the default `CommandButton` rendering has no such axis.
 *
 * EVERY button here carries a pending state, not just launch. It buys
 * idempotency (a double dispatch is suppressed) and honesty (the operator can
 * see the command is still travelling) off the same piece of state, and both
 * apply to a recover and a revert as much as to a launch.
 */
function ArmedButton({
  handle,
  args,
  commandLabel,
  label,
  confirmLabel,
  kind,
  disabled,
  pendingLabel,
}: {
  handle: CommandButtonHandle;
  args?: unknown;
  commandLabel?: string;
  label: string;
  confirmLabel: string;
  kind: "launch" | "recover" | "revert";
  disabled?: boolean;
  pendingLabel?: string;
}) {
  const { isArmed, isPending, isRefused, refusalText, hasFailure, press } =
    useCommandButton({ handle, args, commandLabel });

  if (isPending) {
    return (
      <ConfirmButton type="button" $kind={kind} disabled aria-busy="true">
        <Spinner size={12} /> {pendingLabel ?? "Working..."}
      </ConfirmButton>
    );
  }
  if (isRefused) {
    return (
      <ConfirmButton
        type="button"
        $kind={kind}
        onClick={() => press(true)}
        title={refusalText ?? undefined}
        aria-label={refusalText ?? undefined}
        data-launch-action={`refused-${kind}`}
      >
        Refused
      </ConfirmButton>
    );
  }
  if (isArmed) {
    return (
      <ConfirmButton
        type="button"
        onClick={() => press(true)}
        $kind={kind}
        disabled={disabled}
        data-launch-action={`confirm-${kind}`}
      >
        {confirmLabel}
      </ConfirmButton>
    );
  }
  return (
    <ArmButton
      type="button"
      onClick={() => press(true)}
      $kind={kind}
      disabled={disabled}
      data-failed={hasFailure ? "true" : undefined}
      data-launch-action={`arm-${kind}`}
    >
      {label}
    </ArmButton>
  );
}

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
`;

const SectionLabel = styled.div`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-top: var(--space-2);
`;

/* Was `styled.ul` but `<button>` is not a valid child of `<ul>` (only
   `<li>` is). The list-of-buttons UI doesn't benefit from list
   semantics here: screen readers don't typically need a length count
   for a craft picker. Use `div` and keep the same flex layout. */
const ShipList = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const ShipRow = styled.button<{ $selected: boolean; $blocked: boolean }>`
  display: flex;
  justify-content: space-between;
  /* Top-align the cost tag with the ship name. At wide widths the meta
     column is a single line so this is a no-op; at narrow (5-col)
     widths the name wraps to several lines and centering would float
     the cost tag mid-block (beside "VAB · N parts" instead of the
     name). flex-start keeps it pinned to the first line. */
  align-items: flex-start;
  gap: var(--space-8);
  padding: var(--space-6) var(--space-8);
  background: ${(p) =>
    p.$selected ? "var(--color-surface-raised)" : "var(--color-surface-panel)"};
  border: 1px solid
    ${(p) =>
      p.$selected ? "var(--color-accent-fg)" : "var(--color-surface-raised)"};
  border-radius: var(--radius-xs);
  cursor: ${(p) => (p.$blocked ? "not-allowed" : "pointer")};
  opacity: ${(p) => (p.$blocked ? 0.55 : 1)};
  text-align: left;
  font-family: inherit;
`;

const ShipMeta = styled.span`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 1;
  min-width: 0;
`;

const ShipName = styled.span`
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
`;

const ShipDetails = styled.span`
  font-size: var(--font-size-2xs);
  color: var(--color-text-faint);
`;

const ShipCost = styled.span`
  display: inline-flex;
  gap: var(--space-4);
  flex-shrink: 0;
`;

const CostTag = styled.span`
  font-size: var(--font-size-2xs);
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

const BlockedTag = styled.span`
  font-size: var(--font-size-2xs);
  color: var(--color-status-nogo-fg);
  font-variant-numeric: tabular-nums;
`;

const CrewGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-4);
`;

const CrewChip = styled.button<{ $selected: boolean; $disabled: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-hair);
  padding: var(--space-4) var(--space-8);
  background: ${(p) =>
    p.$selected ? "var(--color-status-go-bg)" : "var(--color-surface-panel)"};
  color: ${(p) =>
    p.$selected ? "var(--color-status-go-fg)" : "var(--color-text-primary)"};
  border: 1px solid
    ${(p) => (p.$selected ? "transparent" : "var(--color-surface-raised)")};
  border-radius: var(--radius-xs);
  cursor: ${(p) => (p.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(p) => (p.$disabled ? 0.4 : 1)};
  text-align: left;
  font-family: inherit;
`;

const CrewName = styled.span`
  font-size: var(--font-size-xs);
  font-weight: 600;
`;

const CrewTrait = styled.span`
  font-size: var(--font-size-2xs);
  color: inherit;
  opacity: 0.7;
  letter-spacing: 0.04em;
`;

const SiteList = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-4);
`;

const SiteChip = styled.button<{ $selected: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-hair);
  padding: var(--space-4) var(--space-8);
  background: ${(p) =>
    p.$selected ? "var(--color-status-go-bg)" : "var(--color-surface-panel)"};
  color: ${(p) =>
    p.$selected ? "var(--color-status-go-fg)" : "var(--color-text-primary)"};
  border: 1px solid
    ${(p) => (p.$selected ? "transparent" : "var(--color-surface-raised)")};
  border-radius: var(--radius-xs);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
`;

const SiteName = styled.span`
  font-size: var(--font-size-xs);
  font-weight: 600;
`;

const SiteMeta = styled.span`
  font-size: var(--font-size-2xs);
  color: inherit;
  opacity: 0.7;
  letter-spacing: 0.04em;
`;

const LaunchControls = styled.div`
  display: flex;
  gap: var(--space-6);
  margin-top: var(--space-4);
`;

const PadActions = styled.div`
  display: flex;
  gap: var(--space-6);
  flex-wrap: wrap;
`;

const InFlightWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
`;

const FlightStats = styled.dl`
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const FlightStatRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-4) var(--space-8);
  /* When the widget is too narrow to fit label + value side by side,
     drop the value onto its own line (right-aligned) instead of
     clipping the digits off the edge. */
  flex-wrap: wrap;
  padding: var(--space-4) var(--space-8);
  border-radius: var(--radius-xs);
  background: var(--color-surface-panel);
`;

const StatLabel = styled.dt`
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-dim);
  margin: 0;
`;

const StatValue = styled.dd`
  margin: 0;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
  font-weight: 600;
  /* Don't let a narrow widget split "T+04:23" mid-value; the label
     column may wrap, the value should stay intact. */
  white-space: nowrap;
  /* Stay flush-right whether it shares the line with the label or
     (when wrapped) sits on its own line. */
  margin-left: auto;
`;

const CrashChip = styled.div`
  background: var(--color-status-alert-muted);
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-xs);
  padding: var(--space-4) var(--space-8);
  border-radius: var(--radius-xs);
  letter-spacing: 0.04em;
`;

const FundsReadout = styled.span`
  color: var(--color-status-go-fg);
  font-variant-numeric: tabular-nums;
  margin-left: var(--space-2);
  /* Keep the separator glued to the amount so a narrow subtitle wraps
     "· 42,500f" as one unit instead of orphaning the middot. */
  white-space: nowrap;
`;

const armButtonBase = `
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: var(--space-4) var(--space-12);
  border-radius: var(--radius-xs);
  cursor: pointer;
  font-family: inherit;
  border: 1px solid var(--color-surface-raised);
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  justify-content: center;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }
`;

const ArmButton = styled.button<{ $kind: "launch" | "recover" | "revert" }>`
  ${armButtonBase}
  background: ${(p) =>
    p.$kind === "launch" ? "var(--color-status-go-bg)" : "transparent"};
  color: ${(p) =>
    p.$kind === "launch"
      ? "var(--color-status-go-fg)"
      : "var(--color-text-muted)"};
  border-color: ${(p) =>
    p.$kind === "launch" ? "transparent" : "var(--color-surface-raised)"};

  &:hover {
    filter: brightness(1.1);
  }
`;

const TrackingStationButton = styled.button`
  ${armButtonBase}
  background: transparent;
  color: var(--color-status-info-fg);
  border-color: var(--color-surface-raised);

  &:hover {
    filter: brightness(1.1);
    border-color: var(--color-status-info-fg);
  }
`;

const TrackingStationConfirm = styled.button`
  ${armButtonBase}
  background: var(--color-status-warning-bg-muted);
  color: var(--color-status-warning-fg-muted);
  border-color: var(--color-status-warning-border-muted);

  &:hover {
    filter: brightness(1.1);
  }
`;

const VesselSwitchPanel = styled.div`
  margin-top: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-hair);
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--color-surface-raised);
  border-radius: var(--radius-xs);
  background: var(--color-surface-app);
  padding: var(--space-2);
`;

const VesselSwitchRow = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  padding: var(--space-4) var(--space-8);
  background: transparent;
  color: var(--color-text-primary);
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: var(--font-size-xs);

  &:hover {
    background: var(--color-surface-panel);
  }
  &:focus-visible {
    /* Focus-ring geometry, off the spacing scale by rule. The offset is
       negative on purpose (an inset ring): VesselSwitchPanel above is
       overflow-y: auto and would clip an outset one, so do not normalise
       this to the +2px used elsewhere in this file. */
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }
`;

const VesselSwitchName = styled.span`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const VesselSwitchMeta = styled.span`
  font-size: var(--font-size-2xs);
  color: currentColor;
  opacity: 0.7;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const VesselSwitchDistance = styled.span`
  font-size: var(--font-size-2xs);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  margin-right: var(--space-4);
`;

const VesselSwitchHint = styled.div`
  padding: var(--space-6) var(--space-8);
  font-size: var(--font-size-2xs);
  color: var(--color-text-faint);
  line-height: var(--line-height-body);
`;

/** Same asteroid/comet visibility toggle as the TargetPicker's Vessels tab,
 * hidden by default, the count-carrying label doubles as the reveal button. */
const SpaceObjectToggle = styled.button`
  align-self: flex-start;
  margin: var(--space-2) var(--space-2) var(--space-4);
  font-size: var(--font-size-2xs);
  padding: var(--space-2) var(--space-8);
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-surface-raised);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  letter-spacing: 0.04em;
  font-family: inherit;
  &[aria-pressed="true"] {
    color: var(--color-status-info-fg);
    border-color: var(--color-status-info-fg);
  }
  &:hover {
    filter: brightness(1.15);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const ConfirmButton = styled.button<{
  $kind: "launch" | "recover" | "revert";
}>`
  ${armButtonBase}
  background: ${(p) =>
    p.$kind === "launch"
      ? "var(--color-status-go-bg)"
      : "var(--color-status-nogo-bg)"};
  color: ${(p) =>
    p.$kind === "launch"
      ? "var(--color-status-go-fg)"
      : "var(--color-status-nogo-fg)"};
  border-color: transparent;
  /* The animation property lives inside the same media guard as the
     keyframes: wrapping only the keyframes leaves the animation
     active for reduced-motion users (CLAUDE.md a11y rule). */
  @media (prefers-reduced-motion: no-preference) {
    animation: armedPulse 1s var(--ease-emphasis) infinite;
    @keyframes armedPulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.6;
      }
    }
  }
`;

registerComponent<LaunchDirectorConfig>({
  id: "launch-director",
  name: "Launch & Recovery",
  description:
    "Pick a saved craft and crew, launch from a pad, or recover/revert the current flight. Greyed-out craft are blocked by funds or missing tech; greyed-out kerbals are off-duty. Buttons that fire a launch or recovery always confirm before sending the action.",
  tags: ["career", "launch"],
  defaultSize: { w: 7, h: 10 },
  minSize: { w: 4, h: 6 },
  component: LaunchDirectorComponent,
  // A pre-launch checklist section, unfilled until a life-support or logistics Uplink binds; the launch flow renders unchanged either way.
  augmentSlots: ["launch-director.preflight"],
  dataRequirements: [
    "spaceCenter.savedShips",
    "spaceCenter.crewRoster",
    "spaceCenter.launchSites",
    "spaceCenter.scene.scene",
    "spaceCenter.scene.launchSite",
    "spaceCenter.state.padOccupied",
    "spaceCenter.state.padVesselTitle",
    "career.status.economy.funds",
    "vessel.identity.name",
    "vessel.state.met",
    "vessel.state.altitudeAsl",
    "ksp.revertAvailability.canRevertToLaunch",
    "ksp.revertAvailability.canRevertToEditor",
    "crash.hasRecent",
    "crash.lastCrash",
    "target.available",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

// Test-only surface for the T3 drift-guard (`../TargetPicker/enumLabelDrift.test.ts`),
// aliased rather than exported bare, since TargetPicker declares an
// identically-named `VESSEL_TYPE_LABELS` const of its own and the package
// barrel (`src/index.ts`) re-exports every widget's `*`, which would
// otherwise collide.
export {
  LaunchDirectorComponent,
  VESSEL_TYPE_LABELS as LAUNCH_DIRECTOR_VESSEL_TYPE_LABELS,
};
