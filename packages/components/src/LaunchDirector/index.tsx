import type { AvailableVesselEntry, ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  formatDistance,
  registerComponent,
  useDataStreamStatus,
  useDataValue,
  useExecuteAction,
} from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import {
  Panel,
  PanelSubtitle,
  PanelTitle,
  ScrollArea,
  Spinner,
  StreamStatusBadge,
} from "@ksp-gonogo/ui";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

type LaunchDirectorConfig = Record<string, never>;

/**
 * The context both LaunchDirector slots pass to their augments. A
 * life-support / logistics Uplink reads the pre-launch selection (which craft,
 * crew and site the operator is about to commit) to append a checklist item or
 * a header badge — e.g. Kerbalism supplies-for-duration, USI-LS habitation.
 */
export interface LaunchDirectorSlotContext {
  /** Current KSP scene ("Flight", "Editor", …); undefined until telemetry arrives. */
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

// Declaration-merge the slot ids → props type into core's `SlotRegistry` (spec
// §4.6). Co-located here (not a shared central file) so parallel slot work on
// other widgets can't collide. This makes `registerAugment` and
// `<AugmentSlot name="launch-director.sections" …>` type-check against
// `LaunchDirectorSlotContext` rather than the loose fallback.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "launch-director.badges": LaunchDirectorSlotContext;
    "launch-director.sections": LaunchDirectorSlotContext;
  }
}

export interface SavedShip {
  name: string;
  partCount: number;
  totalMass: number;
  facility: "VAB" | "SPH" | string;
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

const KNOWN_FACILITIES = new Set(["VAB", "SPH"]);

/**
 * Parse `kc.launchSites`. Returns null when the key is absent (older fork
 * without the handler) so the picker can collapse rather than render empty.
 * Making History adds non-stock sites; without it only stock sites appear.
 *
 * Two wire shapes land here:
 * - Legacy GonogoTelemetry: `{ name, displayName, facility, body, ready,
 *   unlocked }`.
 * - New SDK `spaceCenter.launchSites` (mapped onto this key via map-topic.ts):
 *   the mod's `LaunchSiteEntry` — `editorFacility` in place of `facility`,
 *   `bodyIndex` in place of the body name, and `isStock` instead of a
 *   `ready`/`unlocked` pair. The mod enumerates `PSystemSetup.LaunchSites`
 *   (the sites actually available to launch from), so a new-shape entry is
 *   treated as selectable (`unlocked: true`) — the alternative (no `unlocked`
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
      partCount: typeof e.partCount === "number" ? e.partCount : 0,
      totalMass: typeof e.totalMass === "number" ? e.totalMass : 0,
      facility:
        typeof e.facility === "string" && KNOWN_FACILITIES.has(e.facility)
          ? e.facility
          : "VAB",
      requiresFunds: typeof e.requiresFunds === "number" ? e.requiresFunds : 0,
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
      experienceLevel:
        typeof e.experienceLevel === "number" ? e.experienceLevel : 0,
      available: e.available === true,
      unavailableReason:
        typeof e.unavailableReason === "string" ? e.unavailableReason : "",
    });
  }
  return out;
}

const ARM_TIMEOUT_MS = 4000;

function LaunchDirectorComponent({
  h,
  w,
}: Readonly<ComponentProps<LaunchDirectorConfig>>) {
  const savedShipsRaw = useDataValue("data", "kc.savedShips");
  const crewRosterRaw = useDataValue("data", "kc.crewRoster");
  const padOccupied = useDataValue("data", "kc.padOccupied") as
    | boolean
    | undefined;
  const padVesselTitle = useDataValue("data", "kc.padVesselTitle") as
    | string
    | undefined;
  const launchSite = useDataValue("data", "kc.launchSite") as
    | string
    | undefined;
  const launchSitesRaw = useDataValue("data", "kc.launchSites");
  const careerFunds = useDataValue("data", "career.funds") as
    | number
    | undefined;
  // career.funds -> career.status.economy.funds is the one
  // MAPPED read in this widget (a funds spender per CLAUDE.md's "always show
  // the balance" rule). kc.savedShips/kc.crewRoster and crash.hasRecent/
  // crash.lastCrash resolve to their own dedicated topics too (map-topic.ts).
  // The rest of the kc.*/ksp.*/tar.availableVessels reads below stay legacy
  // — kc.* has no career.status equivalent shape (see map-topic.ts's doc
  // comment on the facilities gap), the others are separate provider
  // families or vessel-provider gaps with no wire home yet.
  const streamStatus = useDataStreamStatus("data", "career.funds");
  // In-flight context — populated when scene === "Flight".
  const vesselName = useDataValue<string>("data", "v.name");
  const missionTime = useDataValue<number>("data", "v.missionTime");
  const altitudeMeters = useDataValue<number>("data", "v.altitude");
  const canRevertToLaunch = useDataValue<boolean>(
    "data",
    "ksp.canRevertToLaunch",
  );
  const canRevertToEditor = useDataValue<boolean>(
    "data",
    "ksp.canRevertToEditor",
  );
  const crashHasRecent = useDataValue<boolean>("data", "crash.hasRecent");
  // crash.hasRecent is session-wide — a debris crash from a previous flight
  // would block recovery of a successfully landed craft. Pull the most
  // recent crash snapshot too so we can scope the gate to the active
  // vessel only. User reported this twice on 2026-05-17 (21:15, 23:12 BST).
  const lastCrash = useDataValue<{
    vesselName?: string;
    vesselId?: number;
    ut?: number;
  } | null>("data", "crash.lastCrash");
  // For the revert-staleness guard below — a revert rewinds universal time
  // below the crash snapshot's capture ut. t.universalTime is dropped as a
  // data key (it was never a stream; it IS the SDK view-UT), so read that
  // directly.
  const universalTime = useViewUt();
  const availableVessels = useDataValue<AvailableVesselEntry[]>(
    "data",
    "tar.availableVessels",
  );
  const execute = useExecuteAction("data");

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
  const [armed, setArmed] = useState<
    "launch" | "recover" | "revert" | "revert-vab" | "tracking-station" | null
  >(null);
  // While the launch RPC is in flight (and until the scene flips to Flight
  // or a 10s safety timeout elapses), suppress the launch button so an
  // impatient double-click doesn't fire two `ksp.launch` actions.
  const [launching, setLaunching] = useState(false);
  const scene = useDataValue<string>("data", "kc.scene");

  // Auto-disarm so a forgotten arm doesn't sit live indefinitely.
  useEffect(() => {
    if (armed === null) return;
    const id = setTimeout(() => setArmed(null), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);

  // Clear the launching guard when the scene flips to Flight (the success
  // signal we actually care about) or after 10s either way.
  useEffect(() => {
    if (!launching) return;
    if (scene === "Flight") {
      setLaunching(false);
      return;
    }
    const id = setTimeout(() => setLaunching(false), 10_000);
    return () => clearTimeout(id);
  }, [launching, scene]);

  const ship = useMemo(
    () => (selectedShip ? ships?.find((s) => s.name === selectedShip) : null),
    [ships, selectedShip],
  );

  const fundsAvailable =
    typeof careerFunds === "number" ? careerFunds : Infinity;
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
    funds: careerFunds,
  };

  if (ships === null) {
    return (
      <Panel>
        <TitleRow>
          <PanelTitle>LAUNCH & RECOVERY</PanelTitle>
          <StreamStatusBadge status={streamStatus} />
        </TitleRow>
        {showSubtitle && (
          <PanelSubtitle>Awaiting launch-pad telemetry</PanelSubtitle>
        )}
      </Panel>
    );
  }

  const inFlight = scene === "Flight";
  const activeName = vesselName ?? padVesselTitle ?? "(unnamed)";
  // Only treat recovery as "crash-blocked" when the most recent crash is
  // for the active vessel — otherwise a debris crash from earlier in the
  // session would stop the operator recovering a successful landing.
  // Falls back to the session-wide flag if the snapshot hasn't arrived
  // yet (rare; the host emits both keys in the same WS tick) so the gate
  // is fail-safe rather than fail-open.
  // A crash snapshot dated AFTER the current universal time belongs to a
  // reverted (undone) timeline — reverting rewinds UT below the capture ut.
  // Telemachus clears the snapshot server-side on the same rule; this
  // mirror keeps the gate correct against older deployed builds. User hit
  // this on 2026-06-12: post-revert, the chip blocked recovery forever
  // because the reverted vessel shares the crashed vessel's name.
  const crashStale =
    lastCrash != null &&
    typeof lastCrash.ut === "number" &&
    typeof universalTime === "number" &&
    lastCrash.ut > universalTime;
  const crashBlocked =
    !crashStale &&
    crashHasRecent === true &&
    (lastCrash == null
      ? true
      : typeof lastCrash.vesselName === "string" &&
        lastCrash.vesselName.length > 0 &&
        lastCrash.vesselName === vesselName);

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>LAUNCH & RECOVERY</PanelTitle>
        {/* Inline header badges — an Uplink (e.g. a life-support summary) can
            surface an indicator beside the title without a bespoke slot (spec
            §4.8). Renders nothing until an augment binds. */}
        <AugmentSlot name="launch-director.badges" props={slotContext} />
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      {showSubtitle && (
        <PanelSubtitle role="status" aria-live="polite">
          {inFlight
            ? `In flight: ${activeName}${launchSite && (w ?? 7) >= 6 ? ` · from ${launchSite}` : ""}`
            : padOccupied
              ? `On pad: ${activeName}`
              : `${launchableShips.length}/${ships.length} ready · ${selectedSiteLabel}`}
          {typeof careerFunds === "number" && (
            <FundsReadout title="Available funds">
              · {Math.round(careerFunds).toLocaleString()}f
            </FundsReadout>
          )}
        </PanelSubtitle>
      )}
      <Body>
        {inFlight ? (
          <InFlightPanel
            missionTime={missionTime ?? null}
            altitudeMeters={altitudeMeters ?? null}
            canRevertToLaunch={canRevertToLaunch ?? false}
            canRevertToEditor={canRevertToEditor ?? false}
            crashBlocked={crashBlocked}
            armed={armed}
            onArm={setArmed}
            availableVessels={availableVessels}
            onRecover={() => {
              setArmed(null);
              void execute("ksp.recover");
            }}
            onRevertToLaunch={() => {
              setArmed(null);
              void execute("ksp.revertToLaunch");
            }}
            onRevertToVAB={() => {
              setArmed(null);
              void execute("ksp.revertToEditor[vab]");
            }}
            onToTrackingStation={() => {
              setArmed(null);
              void execute("ksp.toTrackingStation");
            }}
            onSwitchVessel={(idx) => {
              setArmed(null);
              void execute(`tar.switchVessel[${idx}]`);
            }}
          />
        ) : padOccupied ? (
          <PadActions>
            <ArmedButton
              kind="recover"
              armed={armed === "recover"}
              onArm={() => setArmed("recover")}
              onConfirm={() => {
                setArmed(null);
                void execute("ksp.recover");
              }}
              label="Recover"
              confirmLabel="Confirm recover"
            />
            <ArmedButton
              kind="revert"
              armed={armed === "revert"}
              onArm={() => setArmed("revert")}
              onConfirm={() => {
                setArmed(null);
                // Revert always to VAB by default; the mod's revertToEditor
                // command accepts vab|sph but the widget doesn't know which
                // editor the original craft came from from flight state
                // alone. Prefer the explicit choice when we have it.
                void execute("ksp.revertToEditor[vab]");
              }}
              label="Revert to VAB"
              confirmLabel="Confirm revert"
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
                        {s.totalMass.toFixed(1)}t
                      </ShipDetails>
                    </ShipMeta>
                    <ShipCost>
                      {s.requiresFunds > fundsAvailable && (
                        <BlockedTag title="Insufficient funds">
                          {s.requiresFunds.toFixed(0)}f
                        </BlockedTag>
                      )}
                      {s.requiresFunds <= fundsAvailable &&
                        s.requiresFunds > 0 && (
                          <CostTag>{s.requiresFunds.toFixed(0)}f</CostTag>
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
                        {k.trait || "—"}
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
                    armed={armed === "launch"}
                    disabled={launching}
                    pending={launching}
                    onArm={() => setArmed("launch")}
                    onConfirm={() => {
                      if (launching) return;
                      setArmed(null);
                      setLaunching(true);
                      const crewArg = Array.from(selectedCrew).join(";");
                      const site = selectedSite;
                      void execute(
                        `ksp.launch[${ship.name},${ship.facility},${site},${crewArg}]`,
                      );
                    }}
                    label={
                      selectedCrew.size > 0
                        ? `Launch ${ship.name} (${selectedCrew.size} crew)`
                        : `Launch ${ship.name} unmanned`
                    }
                    confirmLabel="Confirm launch"
                    pendingLabel="Launching…"
                  />
                </LaunchControls>
              </>
            )}
            {/* Pre-launch checklist augments — a life-support / logistics Uplink
                appends a checklist item here. Empty until bound; the
                funds readout and existing controls above are untouched. */}
            <AugmentSlot name="launch-director.sections" props={slotContext} />
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
  armed,
  onArm,
  availableVessels,
  onRecover,
  onRevertToLaunch,
  onRevertToVAB,
  onToTrackingStation,
  onSwitchVessel,
}: {
  missionTime: number | null;
  altitudeMeters: number | null;
  canRevertToLaunch: boolean;
  canRevertToEditor: boolean;
  crashBlocked: boolean;
  armed:
    | "launch"
    | "recover"
    | "revert"
    | "revert-vab"
    | "tracking-station"
    | null;
  onArm: (
    k: "recover" | "revert" | "revert-vab" | "tracking-station" | null,
  ) => void;
  availableVessels: AvailableVesselEntry[] | undefined;
  onRecover: () => void;
  onRevertToLaunch: () => void;
  onRevertToVAB: () => void;
  onToTrackingStation: () => void;
  onSwitchVessel: (vesselIndex: number) => void;
}) {
  const [switchOpen, setSwitchOpen] = useState(false);
  const switchableVessels = useMemo(() => {
    // The stream's `tar.availableVessels` -> `system.vessels` topic delivers
    // the NEW roster shape `{ vessels: [...] }` (object), not the legacy bare
    // `AvailableVesselEntry[]`, and its entries carry `vesselType`/`vesselId`
    // rather than the `type`/`position`/`index` this switcher was written
    // against. Until this switcher is migrated to normalise that roster (the
    // way TargetPicker's `normalizeRoster` does) and dispatch by `vesselId`,
    // guard against the object shape so the panel renders instead of throwing
    // `raw.filter is not a function`. A non-array collapses to an empty list,
    // which disables the "Switch to vessel" control rather than firing a
    // `tar.switchVessel[undefined]` against the wrong entry shape.
    const raw = Array.isArray(availableVessels) ? availableVessels : [];
    // Filter SpaceObjects (asteroids / comets) — same UX call as the
    // TargetPicker. Operator can pop open the Tracking Station for the
    // long tail if they actually want to switch to an asteroid.
    const list = raw.filter((v) => v.type !== "SpaceObject");
    return list
      .map((v) => ({ entry: v, distance: vectorMagnitude(v.position) }))
      .sort((a, b) => a.distance - b.distance);
  }, [availableVessels]);
  return (
    <InFlightWrap>
      {crashBlocked && (
        <CrashChip role="status">
          Crash in progress — return to Space Center to recover
        </CrashChip>
      )}
      <FlightStats>
        <FlightStatRow>
          <StatLabel>Mission time</StatLabel>
          <StatValue>{formatMissionTime(missionTime)}</StatValue>
        </FlightStatRow>
        <FlightStatRow>
          <StatLabel>Altitude</StatLabel>
          <StatValue>{formatAltitude(altitudeMeters)}</StatValue>
        </FlightStatRow>
      </FlightStats>
      <PadActions>
        <ArmedButton
          kind="recover"
          armed={armed === "recover"}
          onArm={() => onArm("recover")}
          onConfirm={onRecover}
          label="Recover"
          confirmLabel="Confirm recover"
          disabled={crashBlocked}
        />
        <ArmedButton
          kind="revert"
          armed={armed === "revert"}
          onArm={() => onArm("revert")}
          onConfirm={onRevertToLaunch}
          label={
            canRevertToLaunch ? "Revert to launch" : "Revert to launch (n/a)"
          }
          confirmLabel="Confirm revert to launch"
          disabled={!canRevertToLaunch}
        />
        <ArmedButton
          kind="revert"
          armed={armed === "revert-vab"}
          onArm={() => onArm("revert-vab")}
          onConfirm={onRevertToVAB}
          label={canRevertToEditor ? "Revert to VAB" : "Revert to VAB (n/a)"}
          confirmLabel="Confirm revert to VAB"
          disabled={!canRevertToEditor}
        />
        {armed === "tracking-station" ? (
          <TrackingStationConfirm
            type="button"
            onClick={() => {
              onArm(null);
              onToTrackingStation();
            }}
            title="KSP may revert this flight to its last save if it can't save here (Telemachus has no equivalent of the in-game warning dialog)."
          >
            Confirm — flight may revert
          </TrackingStationConfirm>
        ) : (
          <TrackingStationButton
            type="button"
            onClick={() => onArm("tracking-station")}
            title="Tracking Station — KSP may revert this flight if it can't save here"
          >
            Tracking Station
          </TrackingStationButton>
        )}
        <TrackingStationButton
          type="button"
          disabled={switchableVessels.length === 0}
          aria-expanded={switchOpen}
          aria-haspopup="listbox"
          onClick={() => setSwitchOpen((v) => !v)}
          title={
            switchableVessels.length === 0
              ? "No other vessels in this save"
              : `Switch to one of ${switchableVessels.length} other vessel${switchableVessels.length === 1 ? "" : "s"}`
          }
        >
          Switch to vessel ▾
        </TrackingStationButton>
      </PadActions>
      {switchOpen && switchableVessels.length > 0 && (
        <VesselSwitchPanel role="listbox" aria-label="Switch active vessel">
          {switchableVessels.map(({ entry, distance }) => (
            <VesselSwitchRow
              key={entry.index}
              type="button"
              onClick={() => {
                setSwitchOpen(false);
                onSwitchVessel(entry.index);
              }}
            >
              <VesselSwitchName>
                <span>{entry.name}</span>
                <VesselSwitchMeta>
                  {entry.type}
                  {entry.body ? ` · ${entry.body}` : ""}
                  {entry.situation ? ` · ${entry.situation.toLowerCase()}` : ""}
                </VesselSwitchMeta>
              </VesselSwitchName>
              <VesselSwitchDistance>
                {Number.isFinite(distance) ? formatDistance(distance) : "—"}
              </VesselSwitchDistance>
            </VesselSwitchRow>
          ))}
        </VesselSwitchPanel>
      )}
    </InFlightWrap>
  );
}

function vectorMagnitude(v: [number, number, number] | undefined): number {
  if (!v) return Number.POSITIVE_INFINITY;
  return Math.hypot(v[0], v[1], v[2]);
}

function formatMissionTime(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "—";
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) {
    return `T+${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `T+${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function formatAltitude(m: number | null): string {
  if (m === null || !Number.isFinite(m)) return "—";
  if (Math.abs(m) >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${m.toFixed(0)} m`;
}

function ArmedButton({
  armed,
  onArm,
  onConfirm,
  label,
  confirmLabel,
  kind,
  disabled,
  pending,
  pendingLabel,
}: {
  armed: boolean;
  onArm: () => void;
  onConfirm: () => void;
  label: string;
  confirmLabel: string;
  kind: "launch" | "recover" | "revert";
  disabled?: boolean;
  pending?: boolean;
  pendingLabel?: string;
}) {
  if (pending) {
    return (
      <ConfirmButton type="button" $kind={kind} disabled aria-busy="true">
        <Spinner size={12} /> {pendingLabel ?? "Working…"}
      </ConfirmButton>
    );
  }
  if (armed) {
    return (
      <ConfirmButton
        type="button"
        onClick={onConfirm}
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
      onClick={onArm}
      $kind={kind}
      disabled={disabled}
      data-launch-action={`arm-${kind}`}
    >
      {label}
    </ArmButton>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
`;

const Body = styled(ScrollArea)`
  flex: 1;
  min-height: 0;

  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
`;

const SectionLabel = styled.div`
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-top: 2px;
`;

/* Was `styled.ul` but `<button>` is not a valid child of `<ul>` (only
   `<li>` is). The list-of-buttons UI doesn't benefit from list
   semantics here — screen readers don't typically need a length count
   for a craft picker. Use `div` and keep the same flex layout. */
const ShipList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
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
  gap: 8px;
  padding: 6px 8px;
  background: ${(p) =>
    p.$selected ? "var(--color-surface-raised)" : "var(--color-surface-panel)"};
  border: 1px solid
    ${(p) =>
      p.$selected ? "var(--color-accent-fg)" : "var(--color-surface-raised)"};
  border-radius: 2px;
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
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
`;

const ShipDetails = styled.span`
  font-size: 10px;
  color: var(--color-text-faint);
`;

const ShipCost = styled.span`
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
`;

const CostTag = styled.span`
  font-size: 10px;
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

const BlockedTag = styled.span`
  font-size: 10px;
  color: var(--color-status-nogo-fg);
  font-variant-numeric: tabular-nums;
`;

const CrewGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 4px;
`;

const CrewChip = styled.button<{ $selected: boolean; $disabled: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 4px 8px;
  background: ${(p) =>
    p.$selected ? "var(--color-status-go-bg)" : "var(--color-surface-panel)"};
  color: ${(p) =>
    p.$selected ? "var(--color-status-go-fg)" : "var(--color-text-primary)"};
  border: 1px solid
    ${(p) => (p.$selected ? "transparent" : "var(--color-surface-raised)")};
  border-radius: 2px;
  cursor: ${(p) => (p.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(p) => (p.$disabled ? 0.4 : 1)};
  text-align: left;
  font-family: inherit;
`;

const CrewName = styled.span`
  font-size: 11px;
  font-weight: 600;
`;

const CrewTrait = styled.span`
  font-size: 9px;
  color: inherit;
  opacity: 0.7;
  letter-spacing: 0.04em;
`;

const SiteList = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 4px;
`;

const SiteChip = styled.button<{ $selected: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 4px 8px;
  background: ${(p) =>
    p.$selected ? "var(--color-status-go-bg)" : "var(--color-surface-panel)"};
  color: ${(p) =>
    p.$selected ? "var(--color-status-go-fg)" : "var(--color-text-primary)"};
  border: 1px solid
    ${(p) => (p.$selected ? "transparent" : "var(--color-surface-raised)")};
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
`;

const SiteName = styled.span`
  font-size: 11px;
  font-weight: 600;
`;

const SiteMeta = styled.span`
  font-size: 9px;
  color: inherit;
  opacity: 0.7;
  letter-spacing: 0.04em;
`;

const LaunchControls = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 4px;
`;

const PadActions = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`;

const InFlightWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const FlightStats = styled.dl`
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const FlightStatRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 4px 8px;
  /* When the widget is too narrow to fit label + value side by side,
     drop the value onto its own line (right-aligned) instead of
     clipping the digits off the edge. */
  flex-wrap: wrap;
  padding: 4px 8px;
  border-radius: 2px;
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
  background: var(--color-status-nogo-muted);
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-xs);
  padding: 4px 8px;
  border-radius: 2px;
  letter-spacing: 0.04em;
`;

const FundsReadout = styled.span`
  color: var(--color-status-go-fg);
  font-variant-numeric: tabular-nums;
  margin-left: 2px;
  /* Keep the separator glued to the amount so a narrow subtitle wraps
     "· 42,500f" as one unit instead of orphaning the middot. */
  white-space: nowrap;
`;

const armButtonBase = `
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 4px 12px;
  border-radius: 2px;
  cursor: pointer;
  font-family: inherit;
  border: 1px solid var(--color-surface-raised);
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--color-surface-raised);
  border-radius: 2px;
  background: var(--color-surface-app);
  padding: 2px;
`;

const VesselSwitchRow = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  background: transparent;
  color: var(--color-text-primary);
  border: none;
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: 11px;

  &:hover {
    background: var(--color-surface-panel);
  }
  &:focus-visible {
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
  font-size: 9px;
  color: currentColor;
  opacity: 0.7;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const VesselSwitchDistance = styled.span`
  font-size: 10px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  margin-right: 4px;
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
     keyframes — wrapping only the keyframes leaves the animation
     active for reduced-motion users (CLAUDE.md a11y rule). */
  @media (prefers-reduced-motion: no-preference) {
    animation: armedPulse 1s ease-in-out infinite;
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

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<LaunchDirectorConfig>({
  id: "launch-director",
  name: "Launch & Recovery",
  description:
    "Pick a saved craft and crew, launch from a pad, or recover/revert the current flight. Greyed-out craft are blocked by funds or missing tech; greyed-out kerbals are off-duty. Buttons that fire a launch or recovery always confirm before sending the action.",
  tags: ["career", "launch"],
  defaultSize: { w: 7, h: 10 },
  minSize: { w: 4, h: 6 },
  component: LaunchDirectorComponent,
  // Header badges + a pre-launch checklist section (augment-slot-map:
  // launch-director.badges / .sections). Unfilled until a life-support /
  // logistics Uplink binds — the launch flow renders exactly as before.
  augmentSlots: ["launch-director.badges", "launch-director.sections"],
  dataRequirements: [
    "kc.savedShips",
    "kc.crewRoster",
    "kc.padOccupied",
    "kc.padVesselTitle",
    "kc.launchSite",
    "kc.launchSites",
    "kc.scene",
    "career.funds",
    "v.name",
    "v.missionTime",
    "v.altitude",
    "ksp.canRevertToLaunch",
    "ksp.canRevertToEditor",
    "crash.hasRecent",
    "crash.lastCrash",
    "tar.availableVessels",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { LaunchDirectorComponent };
