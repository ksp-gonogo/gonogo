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
  commandLossSentence,
  Disclosure,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  Spinner,
  Unit,
  useCommandButton,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import styled from "styled-components";
import {
  FundsDrain,
  netFundsPerDay,
  reportsFundsDrain,
} from "../shared/FundsDrain";
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
 * a header badge: e.g. supplies for the planned duration, or habitation.
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

/**
 * One pad, as the row that draws it sees it. An Uplink that models launch
 * complexes joins its own pad record on {@link siteName} and says what it knows
 * about THIS pad: which complex owns it, whether it is being reconditioned, what
 * is rolling out to it and when that arrives.
 *
 * The context is per-row rather than per-selection because the list is
 * prioritised by what is standing on each pad, and a pad an Uplink knows is
 * busy has to be able to say so from the row rather than only once opened.
 */
export interface LaunchDirectorPadContext {
  /** The site's internal `LaunchSite.name`: the stable key an Uplink joins on. */
  siteName: string;
  /** The site's human-facing name, as the row shows it. */
  displayName: string;
  /** KSP's `EditorFacility` name for this site: a `VAB` site is a pad, an `SPH` site a runway. */
  editorFacility: string;
  /** Whether a vessel is standing on this pad; `null` when this site reports no occupancy. */
  occupied: boolean | null;
  /** The occupying vessel's name, `null` when none is reported. */
  occupantName: string | null;
  /** Whether this is the pad the operator has opened, so an augment can spend more room on it. */
  expanded: boolean;
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
    "launch-director.pad": LaunchDirectorPadContext;
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
  /**
   * Whether the wire says this kerbal can fly today, or `null` where it said
   * nothing. Null is not false: the roster carries `available` for every kerbal
   * it knows about, so its absence is a payload that could not answer, and
   * folding it to "unavailable" would put an unreadable row and a kerbal on a
   * mission in the same pixel.
   */
  available: boolean | null;
  unavailableReason: string;
}

/** What a crew row can be, once availability and its reason are read together. */
export type CrewReading = "available" | "unavailable" | "unread";

/**
 * The unavailable set, derived rather than asked for: the roster carries no
 * "available crew" list and does not need to, since `available` is per row and
 * `CrewStandings.CanFly` is a whitelist mod-side (only Available and Applicant
 * are free, so a standing added later reads unavailable here without an edit).
 *
 * <p>The empty reason is the third state, not a formatting miss. The contract
 * gives `CrewStanding.Unknown` an EMPTY reason on purpose, because "Unknown"
 * beside a dead control reads as a diagnosis, so unavailable-with-no-reason is
 * how "nothing could say" arrives.</p>
 */
export function crewReading(k: CrewMember): CrewReading {
  if (k.available === true) return "available";
  if (k.available === false && k.unavailableReason !== "") return "unavailable";
  return "unread";
}

/**
 * The roster's own count, and the three exceptions to it. Silent on a term that
 * is zero, so a roster where everyone can fly reads as its size and nothing
 * else.
 *
 * <p>The selected count is here rather than beside the chips because this line
 * is the only part of the section that survives a short tile: the grid folds
 * behind it, and a fold that hid the manifest the operator had already picked
 * would be worse than the overflow it replaced.</p>
 */
export function crewTally(crew: CrewMember[], selected = 0): string {
  const readings = crew.map(crewReading);
  const unavailable = readings.filter((r) => r === "unavailable").length;
  const unread = readings.filter((r) => r === "unread").length;
  const terms = [`(${crew.length})`];
  if (unavailable > 0) terms.push(`${unavailable} unavailable`);
  if (unread > 0) terms.push(`${unread} no reading`);
  if (selected > 0) terms.push(`${selected} selected`);
  return ` ${terms.join(" · ")}`;
}

/**
 * Grid rows at or above which the crew grid stands open, and below which it
 * starts folded behind its tally.
 *
 * Measured off the render matrix rather than picked: with a craft selected, the
 * pad row, the craft row and their labels cost ~200px before crew is reached,
 * the section's own label and a seven-kerbal grid cost ~330px more, and the
 * launch control ~40px. At `ROW_HEIGHT` 25 plus an 8px margin that is 18 rows,
 * which is why the only tile it ever fitted was the 7x18 one. Fourteen rows
 * (454px) holds it with the compact chips below; every shorter tile pushed both
 * the grid AND the launch control past the fold.
 */
const CREW_GRID_MIN_ROWS = 14;

/**
 * The letterbox tile: wide enough to hold two readable columns, short enough
 * that stacking them spends the one dimension it has none of.
 *
 * A pad's craft and its crew stack in every other shape, which is right when
 * height is what the tile has. At 18x5 the widget was 712px wide and 165px
 * tall, spent none of the width, and ran 352px of stacked content, so the fold
 * landed on the craft label and neither the crew nor the launch control was on
 * screen. Fourteen columns is where two tracks still fit a craft name beside
 * its cost rather than wrapping it; six rows is where stacking stops fitting.
 */
const LETTERBOX_MIN_COLS = 14;
const LETTERBOX_MAX_ROWS = 6;

/** Trait and rank stay reachable on a row whose value line spent itself on the reason. */
export function crewChipTitle(k: CrewMember, reading: CrewReading): string {
  const who = `${k.trait || NULL_DISPLAY} · L${k.experienceLevel}`;
  if (reading === "available") return who;
  if (reading === "unavailable") return `${who} · ${k.unavailableReason}`;
  return `${who} · no availability reading`;
}

export interface LaunchSiteEntry {
  name: string;
  displayName: string;
  facility: string;
  body: string;
  ready: boolean;
  unlocked: boolean;
  /**
   * Whether a vessel is standing on this pad, `null` when this site reports no
   * occupancy at all. The two are different answers and the row says so
   * differently: the mod derives occupancy from the active vessel being at
   * PRELAUNCH and replicates it onto the stock VAB pad ALONE, so the runway and
   * every Making History / Kerbal Konstructs site carries `null` rather than a
   * claim that they are clear.
   */
  occupied: boolean | null;
  /** The occupying vessel's name; `null` whenever {@link occupied} is not true. */
  occupantName: string | null;
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
      // Only a real boolean is an answer. Anything else is a site that reported
      // no occupancy, which the row states rather than rendering as clear.
      occupied: typeof e.padOccupied === "boolean" ? e.padOccupied : null,
      occupantName:
        typeof e.padVesselTitle === "string" && e.padVesselTitle
          ? e.padVesselTitle
          : null,
    });
  }
  return out;
}

/**
 * The pads, with the ones holding a vessel first.
 *
 * Only a REPORTED occupant promotes a pad. A pad whose occupancy nobody reported
 * keeps its place rather than being floated above one reported clear: "might be
 * holding something" is not a reason to rank it over a pad the operator can act
 * on, and floating it would sink the stock KSC pad (the one site that answers
 * the question at all) below every site that stays silent.
 *
 * Stable otherwise, so the rest keep the order the space centre listed them in.
 */
export function orderPads(
  sites: readonly LaunchSiteEntry[],
): LaunchSiteEntry[] {
  return [...sites].sort(
    (a, b) => (a.occupied === true ? 0 : 1) - (b.occupied === true ? 0 : 1),
  );
}

/** What a site's `EditorFacility` makes it, in the operator's words. */
function padKindLabel(facility: string): string {
  if (facility === "VAB") return "Pad";
  if (facility === "SPH") return "Runway";
  return facility || NULL_DISPLAY;
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
      available: typeof e.available === "boolean" ? e.available : null,
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
  /**
   * The pads themselves, this widget's subject.
   *
   * Read as the raw per-site array rather than through the `spaceCenter.state`
   * derived channel, which collapses the whole list down to the one entry that
   * carries occupancy. That collapse answers "is the pad busy" for a widget with
   * a single pad in mind; a widget whose subject is every pad across every
   * complex needs each site's own answer, occupancy included.
   */
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
  /**
   * The standing cost the balance is also paying for. A craft this widget calls
   * launchable is one the balance covers today, which is not the same claim as
   * one the programme can carry, so the rate the elected money model reports
   * sits beside the balance rather than being folded into the gate. A stock
   * career reports no such rate and this renders nothing.
   */
  const netFunds = netFundsPerDay(judgeable(careerReading)?.economy);
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
  // Only sites the save can actually launch from, in the order the operator
  // should read them: something on it first.
  const pads = useMemo(
    () => orderPads((launchSites ?? []).filter((s) => s.unlocked)),
    [launchSites],
  );

  const [selectedShip, setSelectedShip] = useState<string | null>(null);
  // Which pad row is open. Null means none has been picked yet, and the first
  // pad in the prioritised order stands in: the pad worth looking at is the one
  // the operator would have opened. Derived rather than seeded through an
  // effect, so a pad that leaves the list cannot leave a dead selection behind.
  const [pickedPad, setPickedPad] = useState<string | null>(null);
  const [selectedCrew, setSelectedCrew] = useState<Set<string>>(new Set());
  const activePad = pads.find((p) => p.name === pickedPad) ?? pads[0];
  const selectedSite = activePad?.name ?? "";
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
  /**
   * The craft this pad can take, which is the stock half of "what can go from
   * here": KSP launches a VAB craft from a pad and an SPH craft from a runway,
   * and the site says which it is.
   *
   * Matched on the editor RESOLVED FROM THE ORDINAL, the same fact
   * {@link launchFacilityArg} dispatches, so a craft KSP has renamed still lands
   * under the right site. A site whose facility is neither editor offers every
   * craft rather than none: hiding the fleet on a name we did not recognise
   * states that nothing can launch from here, which is a claim we cannot make.
   */
  const padCraft =
    activePad === undefined || ships === null
      ? (ships ?? [])
      : activePad.facility === "VAB" || activePad.facility === "SPH"
        ? ships.filter((s) => launchFacilityArg(s) === activePad.facility)
        : ships;
  const occupiedPads = pads.filter((p) => p.occupied === true).length;
  const unreportedPads = pads.filter((p) => p.occupied === null).length;

  const rows = h ?? 9;
  const cols = w ?? 7;
  const showSubtitle = rows >= 4;
  const letterbox = cols >= LETTERBOX_MIN_COLS && rows <= LETTERBOX_MAX_ROWS;

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

  const inFlight = scene === "Flight";

  // The pads are the subject, so their absence is what empties the panel. Not
  // gated on the craft list any more: a craft list is what one pad can take,
  // and a widget that blanks over it says nothing about the pads it does know.
  if (launchSites === null && !inFlight) {
    return (
      <Panel
        panelTitle="LAUNCH & RECOVERY"
        compactTitle={["LAUNCH & REC", "LAUNCH"]}
        sections={
          showSubtitle ? (
            <Section full>
              <div
                role="status"
                style={{
                  fontSize: "var(--font-size-xs)",
                  color: "var(--color-text-faint)",
                }}
              >
                Awaiting launch-pad telemetry
              </div>
            </Section>
          ) : null
        }
      />
    );
  }

  const activeName = vesselName ?? activePad?.occupantName ?? "(unnamed)";
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
    <Panel
      panelTitle="LAUNCH & RECOVERY"
      compactTitle={["LAUNCH & REC", "LAUNCH"]}
      sections={[
        showSubtitle ? (
          <Section key="summary" full>
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
                : padSummary({
                    pads: pads.length,
                    occupied: occupiedPads,
                    unreported: unreportedPads,
                  })}
              {typeof careerFunds === "number" && (
                <FundsReadout title="Available funds">
                  · <Unit value={value("funds", careerFunds)} />
                </FundsReadout>
              )}
              {/* NOT wrapped in FundsReadout beside it: that span is nowrap, so
                    a readout placed inside it cannot take a second line and clips
                    at the panel edge instead. */}
              {reportsFundsDrain(netFunds) && (
                <DrainReadout>
                  <FundsDrain
                    funds={careerFunds}
                    netPerDay={netFunds}
                    separator
                  />
                </DrainReadout>
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
          </Section>
        ) : null,
        <Section key="pads">
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
          ) : (
            <PadSection
              pads={pads}
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
  );
}

/**
 * The subtitle's account of the pads. Every pad silent about occupancy is not
 * every pad clear, so an all-unreported list says exactly that rather than
 * claiming the space centre is empty.
 */
function padSummary({
  pads,
  occupied,
  unreported,
}: {
  pads: number;
  occupied: number;
  unreported: number;
}): string {
  if (pads === 0) return "No pads";
  const label = `${pads} pad${pads === 1 ? "" : "s"}`;
  if (unreported === pads) return `${label} · occupancy unreported`;
  // "all clear" is a claim about EVERY pad, so it is only available when every
  // pad answered. With some silent it becomes a count of the ones that did.
  const parts = [label];
  if (occupied > 0) parts.push(`${occupied} occupied`);
  else if (unreported === 0) parts.push("all clear");
  else parts.push(`${pads - unreported} clear`);
  if (unreported > 0) parts.push(`${unreported} unreported`);
  return parts.join(" · ");
}

/** What is standing on this pad, including the case where nobody said. */
function occupancyText(site: LaunchSiteEntry): string {
  if (site.occupied === true)
    return `On pad: ${site.occupantName ?? NULL_DISPLAY}`;
  if (site.occupied === false) return "Clear";
  return "Occupancy unreported";
}

/**
 * The pads, and what the operator can do with the one they have opened.
 *
 * The list is the subject: what is standing on a pad is a fact of the pad and is
 * read straight off the row, rather than being a join between a craft list and a
 * separate occupancy flag that a reader has to remember to make.
 *
 * A pad an Uplink knows more about says so through `launch-director.pad`, which
 * every row carries. What can launch from an open pad is the stock capability:
 * KSP will take any saved craft from the matching editor, so the picker is the
 * craft list narrowed to this site's own.
 */
function PadSection({
  pads,
  activePad,
  onPickPad,
  padCraft,
  craftKnown,
  crew,
  selectedShip,
  onSelectShip,
  selectedCrew,
  onToggleCrew,
  fundsAvailable,
  funds,
  rows,
  letterbox,
  launchCmd,
  recoverCmd,
  revertEditorCmd,
  slotContext,
}: {
  pads: readonly LaunchSiteEntry[];
  activePad: LaunchSiteEntry | undefined;
  onPickPad: (name: string) => void;
  padCraft: readonly SavedShip[];
  /** False while the saved-craft list has never arrived, which is not an empty pad. */
  craftKnown: boolean;
  crew: CrewMember[] | null;
  selectedShip: string | null;
  onSelectShip: (name: string | null) => void;
  selectedCrew: ReadonlySet<string>;
  onToggleCrew: (name: string) => void;
  fundsAvailable: number;
  funds: number | undefined;
  /** The tile's height in grid rows; decides whether the crew grid stands open. */
  rows: number;
  /** Wide and short, so the pad's craft and crew sit side by side. */
  letterbox: boolean;
  launchCmd: CommandButtonHandle;
  recoverCmd: CommandButtonHandle;
  revertEditorCmd: CommandButtonHandle;
  slotContext: LaunchDirectorSlotContext;
}) {
  const ship = selectedShip
    ? padCraft.find((s) => s.name === selectedShip)
    : undefined;
  /**
   * What the launch will actually carry: the selection, minus anyone the roster
   * has since stopped calling available. A selection made before a kerbal was
   * assigned or grounded would otherwise still be dispatched and counted, and
   * `KspFlightOpsActuator.AssignCrew` skips a name it cannot seat without
   * refusing the launch, so the operator would read "(3 crew)" and fly two.
   */
  const manifest = (crew ?? [])
    .filter((k) => crewReading(k) === "available" && selectedCrew.has(k.name))
    .map((k) => k.name);

  return (
    <>
      <SectionLabel>Pads</SectionLabel>
      {pads.length === 0 ? (
        <EmptyNote>No launch sites reported</EmptyNote>
      ) : (
        <PadList>
          {pads.map((site) => {
            const expanded = site.name === activePad?.name;
            return (
              <PadCard key={site.name}>
                <PadRowButton
                  type="button"
                  data-pad-row
                  $selected={expanded}
                  aria-pressed={expanded}
                  onClick={() => onPickPad(site.name)}
                >
                  <PadMeta>
                    <PadName>{site.displayName}</PadName>
                    <PadDetails>
                      {padKindLabel(site.facility)}
                      {site.body && site.body !== "Kerbin"
                        ? ` · ${site.body}`
                        : ""}
                    </PadDetails>
                  </PadMeta>
                  <PadOccupancy $occupied={site.occupied}>
                    {occupancyText(site)}
                  </PadOccupancy>
                </PadRowButton>
                <PadAside>
                  <AugmentSlot
                    name="launch-director.pad"
                    props={{
                      siteName: site.name,
                      displayName: site.displayName,
                      editorFacility: site.facility,
                      occupied: site.occupied,
                      occupantName: site.occupantName,
                      expanded,
                      funds,
                    }}
                  />
                </PadAside>
                {expanded && (
                  <PadDetail>
                    {site.occupied === true ? (
                      /* The pad's occupant is the vessel KSP has at PRELAUNCH,
                         which is the one both commands act on; neither takes a
                         site argument because there is only ever one such
                         vessel. */
                      <PadActions>
                        <ArmedButton
                          kind="recover"
                          handle={recoverCmd}
                          commandLabel="Recover"
                          label="Recover"
                          confirmLabel="Confirm recover"
                          pendingLabel="Recovering..."
                        />
                        {/* Revert always to VAB by default; the mod's
                            revertToEditor command accepts vab|sph but the widget
                            cannot tell which editor the craft on the pad came
                            from. */}
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
                    ) : !craftKnown ? (
                      <EmptyNote>Awaiting saved-craft telemetry</EmptyNote>
                    ) : padCraft.length === 0 ? (
                      <EmptyNote>
                        No saved craft for this{" "}
                        {padKindLabel(site.facility).toLowerCase()}
                      </EmptyNote>
                    ) : (
                      <CraftAndCrew $sideBySide={letterbox && ship != null}>
                        <PadColumn>
                          <SectionLabel>
                            Craft ·{" "}
                            {
                              padCraft.filter(
                                (s) =>
                                  s.missingParts.length === 0 &&
                                  s.requiresFunds <= fundsAvailable,
                              ).length
                            }
                            /{padCraft.length} ready
                          </SectionLabel>
                          <ShipList>
                            {padCraft.map((s) => {
                              const blocked =
                                s.missingParts.length > 0 ||
                                s.requiresFunds > fundsAvailable;
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
                                    onSelectShip(
                                      selectedShip === s.name ? null : s.name,
                                    );
                                  }}
                                >
                                  <ShipMeta>
                                    <ShipName>{s.name}</ShipName>
                                    <ShipDetails>
                                      {s.partCount} parts ·{" "}
                                      <Unit
                                        value={value("t", s.totalMass)}
                                        decimals={1}
                                      />
                                    </ShipDetails>
                                  </ShipMeta>
                                  <ShipCost>
                                    {/* One Unit carrying the value, not a
                                      hand-formatted number beside a bare
                                      symbol: the children form renders the
                                      symbol ALONE and never sees the number, so
                                      this cost printed ungrouped beside a
                                      grouped balance in the same widget. */}
                                    {s.requiresFunds > fundsAvailable && (
                                      <BlockedTag title="Insufficient funds">
                                        <Unit
                                          value={value(
                                            "funds",
                                            s.requiresFunds,
                                          )}
                                        />
                                      </BlockedTag>
                                    )}
                                    {s.requiresFunds <= fundsAvailable &&
                                      s.requiresFunds > 0 && (
                                        <CostTag>
                                          <Unit
                                            value={value(
                                              "funds",
                                              s.requiresFunds,
                                            )}
                                          />
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
                        </PadColumn>

                        {ship && (
                          <PadColumn>
                            {crew === null ? (
                              <>
                                <SectionLabel>Crew</SectionLabel>
                                {/* The roster's own absence, said out loud: it
                                    used to remove this section and the launch
                                    controls with it. Nothing to fold here, so
                                    no expander is offered. */}
                                <ReadoutCaption>
                                  Roster: no reading
                                </ReadoutCaption>
                              </>
                            ) : (
                              /* The tally is the part that survives a short
                                 tile, so it is the expander's own label rather
                                 than a heading above one. `key` re-seats the
                                 open state when a resize crosses the threshold;
                                 without it a tile dragged taller would keep the
                                 fold it was given while it was short. */
                              <CrewDisclosure
                                key={
                                  rows >= CREW_GRID_MIN_ROWS ? "open" : "folded"
                                }
                                variant="inline"
                                panelHeight="auto"
                                defaultOpen={rows >= CREW_GRID_MIN_ROWS}
                                label={
                                  <SectionLabel>
                                    Crew
                                    {crewTally(crew, manifest.length)}
                                  </SectionLabel>
                                }
                              >
                                <CrewGrid $compact={rows < CREW_GRID_MIN_ROWS}>
                                  {crew.map((k) => {
                                    const reading = crewReading(k);
                                    const selectable = reading === "available";
                                    return (
                                      <CrewChip
                                        key={k.name}
                                        type="button"
                                        /* Named rather than bare, so a render
                                           scene can select a SPECIFIC kerbal:
                                           the selected chip had no picture at
                                           all while nothing could click one. */
                                        data-crew-chip={k.name}
                                        $selected={selectedCrew.has(k.name)}
                                        $disabled={!selectable}
                                        $compact={rows < CREW_GRID_MIN_ROWS}
                                        aria-disabled={!selectable}
                                        aria-pressed={selectedCrew.has(k.name)}
                                        title={crewChipTitle(k, reading)}
                                        onClick={() => {
                                          if (!selectable) return;
                                          onToggleCrew(k.name);
                                        }}
                                      >
                                        <CrewName>{k.name}</CrewName>
                                        {/* The reason is a fact off the wire
                                            and belongs on screen, not in a
                                            tooltip the operator has to hunt
                                            for. */}
                                        <CrewTrait>
                                          {reading === "available"
                                            ? `${k.trait || NULL_DISPLAY} L${k.experienceLevel}`
                                            : reading === "unavailable"
                                              ? k.unavailableReason
                                              : "no reading"}
                                        </CrewTrait>
                                      </CrewChip>
                                    );
                                  })}
                                </CrewGrid>
                              </CrewDisclosure>
                            )}
                            <LaunchControls>
                              <ArmedButton
                                kind="launch"
                                handle={launchCmd}
                                args={{
                                  shipName: ship.name,
                                  facility: launchFacilityArg(ship),
                                  site: site.name,
                                  crew: manifest,
                                }}
                                commandLabel={`Launch ${ship.name}`}
                                label={
                                  manifest.length > 0
                                    ? `Launch ${ship.name} (${manifest.length} crew)`
                                    : `Launch ${ship.name} unmanned`
                                }
                                confirmLabel="Confirm launch"
                                pendingLabel="Launching..."
                              />
                            </LaunchControls>
                          </PadColumn>
                        )}
                      </CraftAndCrew>
                    )}
                  </PadDetail>
                )}
              </PadCard>
            );
          })}
        </PadList>
      )}
      {/* Pre-launch checklist augments: a life-support / logistics Uplink
          appends a checklist item here. Empty until bound; the funds readout and
          the pad list above are untouched. */}
      <AugmentSlot name="launch-director.preflight" props={slotContext} />
    </>
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
  // The Tracking Station control keeps its own chrome (the mod saves first and
  // refuses when KSP will not, so the refusal names the arm), which is why it
  // takes the behaviour hook rather than the default rendering.
  const trackingStation = useCommandButton({
    handle: toTrackingCmd,
    commandLabel: "Go to Tracking Station",
  });
  const trackingStationLoss = commandLossSentence({
    label: "Go to Tracking Station",
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
        ) : trackingStation.isArmed ||
          trackingStation.isRefused ||
          trackingStation.isLost ? (
          <TrackingStationConfirm
            type="button"
            onClick={() => trackingStation.press(true)}
            title={
              trackingStation.refusalText ??
              (trackingStation.isLost
                ? trackingStationLoss
                : "Saves the game, then leaves. Refused, naming KSP's own reason, when KSP will not save here.")
            }
            aria-label={
              trackingStation.refusalText ??
              (trackingStation.isLost ? trackingStationLoss : undefined)
            }
          >
            {trackingStation.isRefused
              ? "Refused"
              : trackingStation.isLost
                ? "No reply"
                : "Confirm: save and leave"}
          </TrackingStationConfirm>
        ) : (
          <TrackingStationButton
            type="button"
            onClick={() => trackingStation.press(true)}
            title="Tracking Station: saves the game first, and refuses if KSP will not save here"
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
  const {
    isArmed,
    isPending,
    isRefused,
    isLost,
    refusalText,
    hasFailure,
    press,
  } = useCommandButton({ handle, args, commandLabel });

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
  if (isLost) {
    // Never the resting render, which is where a CONFIRMED action goes: a
    // recover or a revert nobody answered may already have happened.
    const sentence = commandLossSentence({ label: commandLabel });
    return (
      <ConfirmButton
        type="button"
        $kind={kind}
        onClick={() => press(true)}
        title={sentence}
        aria-label={sentence}
        data-launch-action={`lost-${kind}`}
      >
        No reply
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

const SectionLabel = styled.div`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-top: var(--space-2);
`;

const PadList = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const PadCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const PadRowButton = styled.button<{ $selected: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-8);
  padding: var(--space-6) var(--space-8);
  background: ${(p) =>
    p.$selected ? "var(--color-surface-raised)" : "var(--color-surface-panel)"};
  border: 1px solid
    ${(p) =>
      p.$selected ? "var(--color-accent-fg)" : "var(--color-surface-raised)"};
  border-radius: var(--radius-xs);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const PadMeta = styled.span`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 1;
  min-width: 0;
`;

const PadName = styled.span`
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
`;

const PadDetails = styled.span`
  font-size: var(--font-size-2xs);
  color: var(--color-text-faint);
`;

/* Occupied reads as the live state, unreported as a caution: an operator who
   skims the colour must not read silence as an empty pad. */
const PadOccupancy = styled.span<{ $occupied: boolean | null }>`
  font-size: var(--font-size-2xs);
  flex-shrink: 0;
  text-align: right;
  color: ${(p) =>
    p.$occupied === true
      ? "var(--color-status-go-fg)"
      : p.$occupied === null
        ? "var(--color-text-muted)"
        : "var(--color-text-faint)"};
`;

/* What an Uplink adds to a pad, indented under the row it belongs to and one
   step down in size, so a space centre with six pads still reads as a list. */
const PadAside = styled.div`
  padding-left: var(--space-8);
  font-size: var(--font-size-2xs);
  &:empty {
    display: none;
  }
`;

const PadDetail = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding-left: var(--space-8);
  border-left: 2px solid var(--color-surface-raised);
`;

/* One track in every ordinary tile, two in a letterbox: see LETTERBOX_MIN_COLS.
   `align-items: start` so the crew column keeps its own height rather than
   stretching to the craft list beside it. The call site asks for two tracks only
   once a craft is picked, since with no crew column a lone craft list squeezed
   into half the tile is worse than the full-width list it replaced.

   Tried and rejected: lifting the launch control up BESIDE the tally to clear
   the fold outright. It cost the tally its single line, three at 18 columns and
   still two once the crew track was widened, and a wrapped summary reads worse
   than a button whose bottom edge is cut. The tally is the part that has to
   survive here. */
const CraftAndCrew = styled.div<{ $sideBySide: boolean }>`
  display: grid;
  grid-template-columns: ${(p) =>
    p.$sideBySide ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)"};
  align-items: start;
  gap: var(--space-8);
`;

const PadColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  min-width: 0;
`;

const EmptyNote = styled.div`
  font-size: var(--font-size-2xs);
  color: var(--color-text-faint);
  line-height: var(--line-height-body);
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

/* The tally reads as a section heading and has to sit in the same column as
   CRAFT above it. Its trigger is a `<button>`, which centres its label and pads
   its leading edge by UA default, so both are undone here. */
const CrewDisclosure = styled(Disclosure)`
  > button {
    padding-left: 0;
    text-align: left;
  }
  /* The kit's inline panel carries accordion chrome (border, fill, padding),
     which would draw a box around the crew grid that the section never had.
     This is a section that folds, not a row that pops open, so the chrome comes
     off and the expanded grid renders exactly as it did before it could fold. */
  > [role="group"] {
    padding: 0;
    background: none;
    border: none;
  }
`;

const CrewGrid = styled.div<{ $compact: boolean }>`
  display: grid;
  grid-template-columns: repeat(
    auto-fit,
    minmax(${(p) => (p.$compact ? "170px" : "120px")}, 1fr)
  );
  gap: var(--space-4);
`;

/* Compact lays the name and the reason on ONE line instead of two, which is
   what makes an opened grid affordable in a short tile: seven kerbals cost
   ~170px rather than ~300px. The reason is not shortened and not truncated,
   which is why the compact track is WIDER than the two-line one: a kerbal who
   cannot fly has to keep saying why. It wraps back to two lines by itself if a
   reason ever outgrows its track. */
const CrewChip = styled.button<{
  $selected: boolean;
  $disabled: boolean;
  $compact: boolean;
}>`
  display: flex;
  flex-direction: ${(p) => (p.$compact ? "row" : "column")};
  flex-wrap: wrap;
  align-items: ${(p) => (p.$compact ? "baseline" : "flex-start")};
  gap: ${(p) => (p.$compact ? "var(--space-6)" : "var(--space-hair)")};
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

/* The drain's own spacing. Deliberately not FundsReadout: the drain readout is
   several phrases long and manages its own break opportunities, so borrowing a
   span that pins white-space would stop it wrapping at all. */
const DrainReadout = styled.span`
  margin-left: var(--space-2);
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
    "Every launch pad across the space centre, the ones with something standing on them first, and what you can do from the one you open: launch a craft and crew from it, or recover and revert what is already there. Greyed-out craft are blocked by funds or missing tech; a kerbal who cannot fly is greyed out and says why, or reads as no reading where the roster carried no availability. Buttons that fire a launch or recovery always confirm before sending the action.",
  tags: ["career", "launch"],
  defaultSize: { w: 7, h: 10 },
  minSize: { w: 4, h: 6 },
  component: LaunchDirectorComponent,
  // A per-pad section, so an Uplink that models launch complexes says what it
  // knows about each pad, and a pre-launch checklist section for a life-support
  // or logistics Uplink. Both unfilled until one binds; the launch flow renders
  // unchanged either way.
  augmentSlots: ["launch-director.pad", "launch-director.preflight"],
  dataRequirements: [
    "spaceCenter.savedShips",
    "spaceCenter.crewRoster",
    "spaceCenter.launchSites",
    "spaceCenter.scene.scene",
    "spaceCenter.scene.launchSite",
    "career.status.economy.funds",
    "career.status.economy.subsidyPerDay",
    "career.status.economy.upkeepPerDay",
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
