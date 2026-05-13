import type { ComponentProps } from "@gonogo/core";
import {
  registerComponent,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import {
  Panel,
  PanelSubtitle,
  PanelTitle,
  ScrollArea,
  Spinner,
} from "@gonogo/ui";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

type LaunchDirectorConfig = Record<string, never>;

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

const KNOWN_FACILITIES = new Set(["VAB", "SPH"]);

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
  const careerFunds = useDataValue("data", "career.funds") as
    | number
    | undefined;
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
  const execute = useExecuteAction("data");

  const ships = parseSavedShips(savedShipsRaw);
  const crew = parseCrew(crewRosterRaw);

  const [selectedShip, setSelectedShip] = useState<string | null>(null);
  const [selectedCrew, setSelectedCrew] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState<"launch" | "recover" | "revert" | null>(
    null,
  );
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

  if (ships === null) {
    return (
      <Panel>
        <PanelTitle>LAUNCH & RECOVERY</PanelTitle>
        {showSubtitle && (
          <PanelSubtitle>Awaiting launch-pad telemetry</PanelSubtitle>
        )}
      </Panel>
    );
  }

  const inFlight = scene === "Flight";
  const activeName = vesselName ?? padVesselTitle ?? "(unnamed)";

  return (
    <Panel>
      <PanelTitle>LAUNCH & RECOVERY</PanelTitle>
      {showSubtitle && (
        <PanelSubtitle role="status" aria-live="polite">
          {inFlight
            ? `In flight: ${activeName}`
            : padOccupied
              ? `On pad: ${activeName}`
              : `${launchableShips.length}/${ships.length} ready · ${launchSite ?? "LaunchPad"}`}
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
            crashBlocked={crashHasRecent === true}
            armed={armed}
            onArm={setArmed}
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
                // Revert always to VAB by default; the Phase 4 plugin
                // accepts vab|sph but the widget doesn't know which
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
                      const site = launchSite ?? "LaunchPad";
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
  onRecover,
  onRevertToLaunch,
  onRevertToVAB,
}: {
  missionTime: number | null;
  altitudeMeters: number | null;
  canRevertToLaunch: boolean;
  canRevertToEditor: boolean;
  crashBlocked: boolean;
  armed: "launch" | "recover" | "revert" | null;
  onArm: (k: "recover" | "revert" | null) => void;
  onRecover: () => void;
  onRevertToLaunch: () => void;
  onRevertToVAB: () => void;
}) {
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
          armed={false}
          onArm={onRevertToVAB}
          onConfirm={onRevertToVAB}
          label={canRevertToEditor ? "Revert to VAB" : "Revert to VAB (n/a)"}
          confirmLabel="Revert to VAB"
          disabled={!canRevertToEditor}
        />
      </PadActions>
    </InFlightWrap>
  );
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
      >
        {confirmLabel}
      </ConfirmButton>
    );
  }
  return (
    <ArmButton type="button" onClick={onArm} $kind={kind} disabled={disabled}>
      {label}
    </ArmButton>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

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

const ShipList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ShipRow = styled.button<{ $selected: boolean; $blocked: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
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
  gap: 8px;
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
  animation: armedPulse 1s ease-in-out infinite;

  @media (prefers-reduced-motion: no-preference) {
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
  dataRequirements: [
    "kc.savedShips",
    "kc.crewRoster",
    "kc.padOccupied",
    "kc.padVesselTitle",
    "kc.launchSite",
    "kc.scene",
    "career.funds",
    "v.name",
    "v.missionTime",
    "v.altitude",
    "ksp.canRevertToLaunch",
    "ksp.canRevertToEditor",
    "crash.hasRecent",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { LaunchDirectorComponent };
