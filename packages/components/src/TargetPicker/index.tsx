import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@gonogo/core";
import {
  formatDistance,
  registerComponent,
  resolveTargetName,
  useActionInput,
  useDataStreamStatus,
  useExecuteAction,
  useTelemetry,
} from "@gonogo/core";
import type { VesselRosterEntry } from "@gonogo/sitrep-sdk";
import {
  Button,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Panel,
  PanelTitle,
  ScrollArea,
  Spinner,
  StreamStatusBadge,
  Tabs,
} from "@gonogo/ui";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { useCelestialBodies } from "../SystemView/useCelestialBodies";
import { OrbitalEventChips } from "../shared/OrbitalEventChips";

// Config is empty post-migration — the kOS-driven vessel feed has been
// retired in favour of the native `system.vessels` roster.
type TargetPickerConfig = Record<string, never>;
type TabId = "bodies" | "vessels" | "current";

/** `Sitrep.Contract.VesselType`'s C# declared order (VesselEnums.cs) — the
 * ordinal -> display-label bridge for the new roster shape. */
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

/** Display shape the `system.vessels` roster normalizes into — the widget
 * renders/sorts off this alone. */
interface DisplayVesselEntry {
  /** React list key + `pendingTarget` disambiguator. */
  key: string;
  /** Exact bracket arg for `tar.setTargetVessel[...]` — the roster's stable
   * `vesselId` guid. */
  targetArg: string;
  name: string;
  type: string;
  body: string | null;
  distance: number;
}

/** `system.vessels`' roster (`SystemViewProvider.BuildSystemVessels`) carries
 * NO position/distance field — a static snapshot list, not per-vessel
 * kinematics — so every entry reports `Number.POSITIVE_INFINITY` distance,
 * which `formatDistance` already renders as "—". */
function normalizeRoster(
  vessels: readonly VesselRosterEntry[] | undefined,
  bodies: ReturnType<typeof useCelestialBodies>,
): DisplayVesselEntry[] {
  if (vessels === undefined) return [];
  return vessels.map((entry) => ({
    key: `roster:${entry.vesselId}`,
    targetArg: entry.vesselId,
    name: entry.name,
    type: VESSEL_TYPE_LABELS[entry.vesselType] ?? "Unknown",
    body:
      entry.bodyIndex == null
        ? null
        : (bodies.find((b) => b.index === entry.bodyIndex)?.name ?? null),
    // No position on the roster shape — formatDistance(Infinity) -> "—".
    distance: Number.POSITIVE_INFINITY,
  }));
}

const targetPickerActions = [
  {
    id: "clear-target",
    label: "Clear target",
    accepts: ["button"],
    description: "Clears the current KSP target via tar.clearTarget.",
  },
] as const satisfies readonly ActionDefinition[];
type TargetPickerActions = typeof targetPickerActions;

function TargetPickerComponent({
  w,
  h,
}: Readonly<ComponentProps<TargetPickerConfig>>) {
  const bodies = useCelestialBodies();
  // Target-detail reads are Wave-1 clean homes (R6 §1) routed through
  // `useTelemetry`'s legacy two-arg form onto their SDK-derived homes:
  // `tar.name` -> `vessel.target.name`, `tar.type` -> `vessel.state.targetKind`
  // (enum-ordinal → display name), `tar.distance` -> `vessel.state.targetDistance`
  // (|relativePosition|) and `tar.o.relativeVelocity` ->
  // `vessel.state.targetRelativeSpeed` (signed range-rate). Each shape matches
  // the legacy scalar exactly, so the shim's fallback is a safe pass-through.
  const tarName = resolveTargetName(useTelemetry("data", "tar.name"));
  const tarType = useTelemetry("data", "tar.type") as string | undefined;
  const tarDistance = useTelemetry("data", "tar.distance");
  const tarRelVel = useTelemetry("data", "tar.o.relativeVelocity");
  const execute = useExecuteAction("data");
  const streamStatus = useDataStreamStatus("data", "tar.availableVessels");

  const [tab, setTab] = useState<TabId>("bodies");
  const [filter, setFilter] = useState("");
  const [showSpaceObjects, setShowSpaceObjects] = useState(false);

  useActionInput<TargetPickerActions>({
    "clear-target": (payload) => {
      if (payload.kind !== "button" || payload.value !== true) return;
      void execute("tar.clearTarget");
    },
  });

  // Pending state — which row is awaiting the `tar.name` readback after a
  // click. We render a spinner on that row until the readback confirms
  // (or a 5 s safety net clears it). Body rows use the integer index;
  // vessel rows use the roster entry's `key` (same disambiguator as the
  // React key).
  const [pendingTarget, setPendingTarget] = useState<{
    kind: "body" | "vessel";
    id: string;
    expectedName: string;
    since: number;
  } | null>(null);
  useEffect(() => {
    if (pendingTarget === null) return;
    if (tarName === pendingTarget.expectedName) {
      setPendingTarget(null);
      return;
    }
    const id = setTimeout(() => setPendingTarget(null), 5000);
    return () => clearTimeout(id);
  }, [pendingTarget, tarName]);

  const targetBody = (index: number, name: string | null) => {
    setPendingTarget({
      kind: "body",
      id: `body:${index}`,
      expectedName: name ?? "",
      since: Date.now(),
    });
    void execute(`tar.setTargetBody[${index}]`);
  };
  const clearTarget = () => {
    setPendingTarget(null);
    void execute("tar.clearTarget");
  };

  // ── Vessel listing via the `system.vessels` roster ───────────────────────
  // Read canonically off the stream (R6): the roster is a structurally
  // different shape from the legacy `tar.availableVessels` array (no position/
  // distance field), so there is no shape-compatible legacy fallback to keep —
  // the canonical Topic read drops the Telemachus path outright and only ever
  // sees `{ vessels: [...] }`, normalized into `DisplayVesselEntry` above.
  const roster = useTelemetry("system.vessels");
  const displayVessels = useMemo(
    () => normalizeRoster(roster?.vessels, bodies),
    [roster, bodies],
  );

  const targetVessel = (entry: DisplayVesselEntry) => {
    setPendingTarget({
      kind: "vessel",
      id: `vessel:${entry.key}`,
      expectedName: entry.name,
      since: Date.now(),
    });
    void execute(`tar.setTargetVessel[${entry.targetArg}]`);
  };

  const filterText = filter.trim().toLowerCase();
  const isFiltering = filterText.length > 0;

  const namedBodies = useMemo(
    () => bodies.filter((b) => b.name !== null),
    [bodies],
  );

  const filteredBodies = useMemo(() => {
    if (!isFiltering) return namedBodies;
    return namedBodies.filter((b) =>
      (b.name as string).toLowerCase().includes(filterText),
    );
  }, [namedBodies, filterText, isFiltering]);

  // Group bodies by their reference body for the tree-style rendering.
  // The tree is shallow — at most parent / children / grandchildren — so
  // a sorted-children Map is enough.
  //
  // A body is treated as a top-level root when any of:
  //   - referenceBody is null (no parent declared);
  //   - referenceBody equals the body's own name (Telemachus reports the
  //     star as its own parent — `b.referenceBody[0] === "Sun"`); or
  //   - referenceBody points at a name that hasn't streamed yet, or never
  //     will (orphan).
  const tree = useMemo(() => {
    const childrenOf = new Map<string, typeof namedBodies>();
    const roots: typeof namedBodies = [];
    const knownNames = new Set(namedBodies.map((b) => b.name as string));
    for (const body of namedBodies) {
      const ref = body.referenceBody;
      if (ref === null || ref === body.name || !knownNames.has(ref)) {
        roots.push(body);
        continue;
      }
      const bucket = childrenOf.get(ref) ?? [];
      bucket.push(body);
      childrenOf.set(ref, bucket);
    }
    return { roots, childrenOf };
  }, [namedBodies]);

  const bodiesContent = (
    <BodiesTab>
      <FilterInput
        type="search"
        placeholder="Filter bodies"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter bodies"
      />
      {namedBodies.length === 0 ? (
        <Hint>Waiting for body data…</Hint>
      ) : isFiltering ? (
        <BodyList>
          {filteredBodies.length === 0 ? (
            <Hint>No bodies match.</Hint>
          ) : (
            filteredBodies.map((body) => {
              const isPending = pendingTarget?.id === `body:${body.index}`;
              return (
                <BodyRow
                  key={body.index}
                  type="button"
                  $depth={0}
                  $current={body.name === tarName}
                  onClick={() => targetBody(body.index, body.name)}
                >
                  <BodyName>{body.name ?? "(unnamed)"}</BodyName>
                  {isPending && <Spinner ariaLabel="Setting target" />}
                  {!isPending && body.name === tarName && (
                    <BodyTag>TARGET</BodyTag>
                  )}
                </BodyRow>
              );
            })
          )}
        </BodyList>
      ) : (
        <BodyList>
          {tree.roots.map((root) => (
            <BodyTreeNode
              key={root.index}
              body={root}
              childrenOf={tree.childrenOf}
              depth={0}
              currentTargetName={tarName}
              pendingId={pendingTarget?.id ?? null}
              onTarget={targetBody}
            />
          ))}
        </BodyList>
      )}
    </BodiesTab>
  );

  const vesselsContent = (() => {
    const spaceObjectCount = displayVessels.filter(
      (v) => v.type === "SpaceObject",
    ).length;
    const filtered = showSpaceObjects
      ? displayVessels
      : displayVessels.filter((v) => v.type !== "SpaceObject");
    const sorted = [...filtered].sort((a, b) => a.distance - b.distance);

    return (
      <VesselsTab>
        <VesselsHeader>
          <VesselsMeta>
            {sorted.length} target{sorted.length === 1 ? "" : "s"}
          </VesselsMeta>
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
        </VesselsHeader>
        {roster === undefined ? (
          <Hint>Waiting for vessel list…</Hint>
        ) : sorted.length === 0 ? (
          <Hint>No targets in range.</Hint>
        ) : (
          <BodyList>
            {sorted.map((entry) => {
              const isCurrent = tarName === entry.name;
              const isPending = pendingTarget?.id === `vessel:${entry.key}`;
              return (
                <BodyRow
                  key={entry.key}
                  type="button"
                  $depth={0}
                  $current={isCurrent}
                  onClick={() => targetVessel(entry)}
                >
                  <VesselName>
                    <span>{entry.name}</span>
                    <VesselType>
                      {entry.type}
                      {entry.body ? ` · ${entry.body}` : ""}
                    </VesselType>
                  </VesselName>
                  <VesselDistance>
                    {formatDistance(entry.distance)}
                  </VesselDistance>
                  {isPending && <Spinner ariaLabel="Setting target" />}
                  {!isPending && isCurrent && <BodyTag>TARGET</BodyTag>}
                </BodyRow>
              );
            })}
          </BodyList>
        )}
      </VesselsTab>
    );
  })();

  const currentContent = (
    <CurrentTab>
      {tarName === undefined ? (
        <Hint>No target set in KSP.</Hint>
      ) : (
        <>
          <CurrentRow>
            <CurrentLabel>Name</CurrentLabel>
            <CurrentValue>{tarName}</CurrentValue>
          </CurrentRow>
          {tarType && (
            <CurrentRow>
              <CurrentLabel>Type</CurrentLabel>
              <CurrentValue>{tarType}</CurrentValue>
            </CurrentRow>
          )}
          {typeof tarDistance === "number" && Number.isFinite(tarDistance) && (
            <CurrentRow>
              <CurrentLabel>Distance</CurrentLabel>
              <CurrentValue>{formatDistance(tarDistance)}</CurrentValue>
            </CurrentRow>
          )}
          {typeof tarRelVel === "number" && Number.isFinite(tarRelVel) && (
            <CurrentRow>
              <CurrentLabel>Δv</CurrentLabel>
              <CurrentValue>{tarRelVel.toFixed(2)} m/s</CurrentValue>
            </CurrentRow>
          )}
          <ClearButtonRow>
            <Button onClick={clearTarget} type="button">
              Clear target
            </Button>
          </ClearButtonRow>
        </>
      )}
    </CurrentTab>
  );

  // Selective rendering — at very small sizes the tabbed picker doesn't
  // have room, so collapse to a current-target readout (clear button if
  // there's any width).
  const cols = w ?? 6;
  const rows = h ?? 11;
  const showTabs = rows >= 6 && cols >= 4;

  if (!showTabs) {
    return (
      <Panel>
        <CompactTitleRow>
          <PanelTitle>TARGET</PanelTitle>
          <StreamStatusBadge status={streamStatus} />
        </CompactTitleRow>
        <CompactCurrent>
          {tarName ? (
            <>
              <CompactName>{tarName}</CompactName>
              {typeof tarDistance === "number" &&
                Number.isFinite(tarDistance) && (
                  <CompactDistance>
                    {formatDistance(tarDistance)}
                  </CompactDistance>
                )}
            </>
          ) : (
            <Hint>No target set</Hint>
          )}
        </CompactCurrent>
      </Panel>
    );
  }

  return (
    <Panel>
      <PickerHeader>
        <PickerHeaderTitle>
          <PanelTitle>TARGET PICKER</PanelTitle>
          <StreamStatusBadge status={streamStatus} />
        </PickerHeaderTitle>
        {tarName && (
          <CurrentTargetChip
            type="button"
            onClick={() => setTab("current")}
            aria-label={`Current target: ${tarName}. Open Current tab.`}
            title={tarName}
          >
            <ChipLabel>TARGET</ChipLabel>
            <ChipName>{tarName}</ChipName>
          </CurrentTargetChip>
        )}
      </PickerHeader>
      <OrbitalEventChipsRow>
        <OrbitalEventChips />
      </OrbitalEventChipsRow>
      <TabsScope>
        <Tabs
          tabs={[
            { id: "bodies", label: "Bodies", content: bodiesContent },
            { id: "vessels", label: "Vessels", content: vesselsContent },
            { id: "current", label: "Current", content: currentContent },
          ]}
          activeId={tab}
          onChange={(id) => setTab(id as TabId)}
        />
      </TabsScope>
    </Panel>
  );
}

interface BodyTreeNodeProps {
  body: ReturnType<typeof useCelestialBodies>[number];
  childrenOf: Map<string, ReturnType<typeof useCelestialBodies>>;
  depth: number;
  currentTargetName: string | undefined;
  pendingId: string | null;
  onTarget: (index: number, name: string | null) => void;
}

function BodyTreeNode({
  body,
  childrenOf,
  depth,
  currentTargetName,
  pendingId,
  onTarget,
}: BodyTreeNodeProps) {
  const children = body.name ? (childrenOf.get(body.name) ?? []) : [];
  const isCurrent = body.name && body.name === currentTargetName;
  const isPending = pendingId === `body:${body.index}`;
  return (
    <>
      <BodyRow
        type="button"
        $depth={depth}
        $current={!!isCurrent}
        onClick={() => onTarget(body.index, body.name)}
      >
        <BodyName>{body.name ?? "(unnamed)"}</BodyName>
        {isPending && <Spinner ariaLabel="Setting target" />}
        {!isPending && isCurrent && <BodyTag>TARGET</BodyTag>}
      </BodyRow>
      {children.map((child) => (
        <BodyTreeNode
          key={child.index}
          body={child}
          childrenOf={childrenOf}
          depth={depth + 1}
          currentTargetName={currentTargetName}
          pendingId={pendingId}
          onTarget={onTarget}
        />
      ))}
    </>
  );
}

// ── Config component ──────────────────────────────────────────────────────────

function TargetPickerConfigComponent(
  _props: Readonly<ConfigComponentProps<TargetPickerConfig>>,
) {
  return (
    <ConfigForm>
      <Field>
        <FieldLabel>Target Picker</FieldLabel>
        <FieldHint>
          No config — bodies come from the <code>system.bodies</code> roster,
          vessels from <code>system.vessels</code>. Click a row to set the KSP
          target; click Clear in the Current tab to drop it.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const PickerHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 0;
`;

const PickerHeaderTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const CompactTitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

/** Chip row that collapses to zero height when there's no encounter / apsis
 *  data — keeps the header tight in the common steady-orbit case. */
const OrbitalEventChipsRow = styled.div`
  display: flex;
  margin-top: 4px;
  &:empty {
    display: none;
  }
`;

/** Scoped override of the shared @gonogo/ui Tabs chrome. The three tab
 *  labels here ("Bodies" / "Vessels" / "Current") are longer than the
 *  shared component's default sizing was tuned for, so at this widget's
 *  common narrower widths the last tab clips under the overflow glow
 *  instead of just fitting. Trim the label type down a size and tighten
 *  the letter-spacing/padding rather than touching the shared primitive's
 *  defaults, which other (shorter-label) tab consumers may rely on. */
const TabsScope = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;

  [role="tablist"] [role="tab"] {
    font-size: var(--font-size-xs);
    letter-spacing: 0.04em;
    padding: 6px 6px;
  }
`;

const CurrentTargetChip = styled.button`
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 2px;
  border: 1px solid var(--color-status-go-bg);
  background: var(--color-status-go-bg);
  color: var(--color-status-go-fg);
  cursor: pointer;
  max-width: 60%;
  &:hover {
    filter: brightness(1.15);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const ChipLabel = styled.span`
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  flex-shrink: 0;
`;

const ChipName = styled.span`
  font-size: 11px;
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

const BodiesTab = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  flex: 1;
  min-height: 0;
`;

const FilterInput = styled.input`
  font-size: 12px;
  padding: 4px 6px;
  background: var(--color-surface-app);
  border: 1px solid var(--color-surface-raised);
  border-radius: 2px;
  color: var(--color-text-primary);
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const BodyList = styled(ScrollArea)`
  flex: 1;
  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
`;

const BodyRow = styled.button<{ $depth: number; $current: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px;
  padding-left: ${({ $depth }) => 6 + $depth * 14}px;
  background: ${({ $current }) =>
    $current ? "var(--color-status-go-bg)" : "transparent"};
  color: ${({ $current }) =>
    $current ? "var(--color-status-go-fg)" : "var(--color-text-primary)"};
  border: none;
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  &:hover {
    background: var(--color-surface-panel);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }
`;

const BodyName = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const BodyTag = styled.span`
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--color-status-go-fg);
`;

const Hint = styled.div`
  margin-top: 6px;
  font-size: 11px;
  color: var(--color-text-faint);
  line-height: 1.4;
`;

const CompactCurrent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-align: center;
`;

const CompactName = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: 0.04em;
`;

const CompactDistance = styled.div`
  font-size: 11px;
  color: var(--color-accent-fg);
  letter-spacing: 0.04em;
`;

const CurrentTab = styled.div`
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const CurrentRow = styled.div`
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 6px;
  font-size: 12px;
`;

const CurrentLabel = styled.span`
  color: var(--color-text-faint);
  letter-spacing: 0.05em;
  font-size: 10px;
  text-transform: uppercase;
  align-self: center;
`;

const CurrentValue = styled.span`
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
`;

const ClearButtonRow = styled.div`
  margin-top: 8px;
`;

const VesselsTab = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  flex: 1;
  min-height: 0;
`;

const VesselsHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const VesselsMeta = styled.span`
  font-size: 10px;
  color: var(--color-text-faint);
  letter-spacing: 0.04em;
`;

const SpaceObjectToggle = styled.button`
  margin-left: auto;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
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

const VesselName = styled.span`
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

const VesselType = styled.span`
  font-size: 9px;
  color: currentColor;
  opacity: 0.7;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const VesselDistance = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  margin-right: 6px;
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<TargetPickerConfig>({
  id: "target-picker",
  name: "Target Picker",
  description:
    "Pick a target body, vessel, or inspect the current target. Bodies tab lists every body in the system grouped by reference-body. Vessels tab streams the `system.vessels` roster and click-to-targets by stable vessel id. Current tab shows the active target's name / type / distance / Δv with a clear button.",
  tags: ["telemetry", "navigation"],
  defaultSize: { w: 6, h: 11 },
  minSize: { w: 3, h: 3 },
  component: TargetPickerComponent,
  configComponent: TargetPickerConfigComponent,
  dataRequirements: [
    "b.number",
    "tar.name",
    "tar.type",
    "tar.distance",
    "tar.o.relativeVelocity",
    "tar.availableVessels",
    "o.encounterExists",
    "o.encounterBody",
    "o.encounterTime",
    "o.nextApsisType",
    "o.timeToNextApsis",
  ],
  defaultConfig: {},
  actions: targetPickerActions,
  pushable: true,
  requires: ["flight"],
});

export { TargetPickerComponent };
