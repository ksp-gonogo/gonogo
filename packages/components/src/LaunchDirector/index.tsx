import type { ComponentProps } from "@gonogo/core";
import {
  registerComponent,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle, ScrollArea } from "@gonogo/ui";
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
  const execute = useExecuteAction("data");

  const ships = parseSavedShips(savedShipsRaw);
  const crew = parseCrew(crewRosterRaw);

  const [selectedShip, setSelectedShip] = useState<string | null>(null);
  const [selectedCrew, setSelectedCrew] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState<"launch" | "recover" | "revert" | null>(
    null,
  );

  // Auto-disarm so a forgotten arm doesn't sit live indefinitely.
  useEffect(() => {
    if (armed === null) return;
    const id = setTimeout(() => setArmed(null), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);

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
        <PanelTitle>LAUNCH DIRECTOR</PanelTitle>
        {showSubtitle && (
          <PanelSubtitle>Awaiting launch-pad telemetry</PanelSubtitle>
        )}
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle>LAUNCH DIRECTOR</PanelTitle>
      {showSubtitle && (
        <PanelSubtitle role="status" aria-live="polite">
          {padOccupied
            ? `On pad: ${padVesselTitle ?? "(unnamed)"}`
            : `${launchableShips.length}/${ships.length} ready · ${launchSite ?? "LaunchPad"}`}
        </PanelSubtitle>
      )}
      <Body>
        {padOccupied ? (
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
                    onArm={() => setArmed("launch")}
                    onConfirm={() => {
                      setArmed(null);
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

function ArmedButton({
  armed,
  onArm,
  onConfirm,
  label,
  confirmLabel,
  kind,
}: {
  armed: boolean;
  onArm: () => void;
  onConfirm: () => void;
  label: string;
  confirmLabel: string;
  kind: "launch" | "recover" | "revert";
}) {
  if (armed) {
    return (
      <ConfirmButton type="button" onClick={onConfirm} $kind={kind}>
        {confirmLabel}
      </ConfirmButton>
    );
  }
  return (
    <ArmButton type="button" onClick={onArm} $kind={kind}>
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

const armButtonBase = `
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 4px 12px;
  border-radius: 2px;
  cursor: pointer;
  font-family: inherit;
  border: 1px solid var(--color-surface-raised);
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
  name: "Launch Director",
  description:
    "Pick a saved craft + crew and launch from a station. Shows affordability + tech-availability filters per craft, greys out unavailable kerbals, and switches to recover / revert controls when a vessel is on the pad. All write actions are arm-then-confirm.",
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
    "career.funds",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { LaunchDirectorComponent };
