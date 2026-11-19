import {
  type ComponentHeldOpen,
  HeldOpenContext,
  NO_TELEMETRY_HOST_MESSAGE,
  useAwaitingFirstSignal,
  useCrashEnding,
  useGameContext,
  useTelemetry,
  useTelemetryHostDown,
  useUplinkHealthFor,
} from "@ksp-gonogo/core";
import {
  type ChannelFamily,
  type DeclaredDelayRoles,
  delayLaneOf,
  familyPrefix,
  readDeclaredDelayRoles,
  type TopicId,
  type WidgetChannelId,
} from "@ksp-gonogo/sitrep-sdk";
import { useClaimCapability } from "@ksp-gonogo/sitrep-sdk/spine";
import { DimmedOverlay } from "@ksp-gonogo/ui";
import {
  AWAITING_FIRST_SIGNAL,
  Cluster,
  LockMark,
  LockScope,
  type LockSummary,
  Panel,
  Section,
} from "@ksp-gonogo/ui-kit";
import { type ReactNode, useMemo } from "react";
import { groundDomainsOf } from "./seatAvailability";

export interface RequiresGuardProps {
  /** Reasons the widget stays open while its craft Topics say there is no vessel. */
  heldOpenBy?: readonly ComponentHeldOpen[];
  /** The widget has nothing to draw until the link's first report arrives, so the awaiting notice stands in for it until then. */
  awaitsFirstSignal?: boolean | { heading: string };
  /** The widget's required channels. */
  channels?: readonly string[];
  /** The widget's optional channels: they gate only a widget that requires no Topic and reads none of the ground. */
  optionalChannels?: readonly string[];
  /** The widget's reads in the older field-path form (`vessel.orbit.sma`), counted as the Topics they name. */
  dataRequirements?: readonly string[];
  /**
   * The widget's required families of runtime-built Topics. Each is claimed and
   * health-checked through the literal prefix before its first placeholder, and
   * a family that starts with a placeholder has none, so it is neither.
   */
  families?: readonly ChannelFamily[];
  /** The widget's optional families: they only count towards the missing-host check. */
  optionalFamilies?: readonly ChannelFamily[];
  /**
   * The Topics the widget's saved settings name. They are claimed and count
   * towards the missing-host check, and never gate on Uplink health.
   */
  configChannels?: readonly string[];
  /** The widget's name, kept as the panel heading while its body is refused. */
  title?: string;
  /**
   * Set while the widget shows its tiny form: a lock then draws as the compact
   * mark under this heading, since the full notice does not fit a tiny tile.
   */
  compact?: { title: string };
  children: ReactNode;
}

/**
 * The orchestrator's "can this widget render meaningfully now" gate, one
 * reason line in priority order: no telemetry host, a capability this save has
 * not unlocked, an unhealthy Uplink owning a required channel, then an unmet
 * game context read off the Topics the widget reads (no vessel, no career).
 *
 * The order is the nesting: the host check sits outside the widget's lock
 * scope, and the health and game-context checks inside it. Each declared
 * channel is claimed beside the body, so a widget the game-context check is
 * hiding still shows a lock it would meet; a read or command hook in the
 * widget's own body, outside any `Section`, locks the whole widget.
 */
export function RequiresGuard({
  heldOpenBy,
  dataRequirements,
  awaitsFirstSignal,
  channels,
  families,
  optionalFamilies,
  optionalChannels,
  configChannels,
  title,
  compact,
  children,
}: RequiresGuardProps) {
  const hostDown = useTelemetryHostDown();
  // A widget that declares nothing has nothing a missing host can block.
  const readsTopics =
    (channels?.length ?? 0) +
      (families?.length ?? 0) +
      (optionalFamilies?.length ?? 0) +
      (configChannels?.length ?? 0) >
    0;
  if (hostDown && readsTopics) {
    return (
      <GuardPlaceholder title={title} message={NO_TELEMETRY_HOST_MESSAGE} />
    );
  }

  const claimed = [
    ...(channels ?? []),
    ...(families ?? []).map(familyPrefix).filter((prefix) => prefix !== ""),
    ...(configChannels ?? []),
  ];
  const healthChecked = [
    ...(channels ?? []),
    ...(families ?? []).map(familyPrefix).filter((prefix) => prefix !== ""),
  ];

  return (
    <LockScope
      fallback={(lock) =>
        compact ? (
          <TinyLockPlaceholder title={compact.title} lock={lock} />
        ) : (
          <GuardPlaceholder
            title={title}
            message={lock.reason}
            hint={lock.hint}
          />
        )
      }
    >
      {[...new Set(claimed)].map((topic) => (
        <ChannelClaim key={topic} topic={topic} />
      ))}
      <ReadinessGate
        heldOpenBy={heldOpenBy}
        channels={healthChecked}
        optionalChannels={optionalChannels}
        configChannels={configChannels}
        dataRequirements={dataRequirements}
        title={title}
      >
        {awaitsFirstSignal !== undefined && awaitsFirstSignal !== false ? (
          <AwaitingFirstSignalGate
            title={
              typeof awaitsFirstSignal === "object"
                ? awaitsFirstSignal.heading
                : title
            }
            compact={compact}
          >
            {children}
          </AwaitingFirstSignalGate>
        ) : (
          children
        )}
      </ReadinessGate>
    </LockScope>
  );
}

/** Draws the awaiting notice in place of the widget until the link's first report arrives. */
function AwaitingFirstSignalGate({
  title,
  compact,
  children,
}: {
  title?: string;
  compact?: { title: string };
  children: ReactNode;
}) {
  const awaiting = useAwaitingFirstSignal();
  if (!awaiting) return <>{children}</>;
  return compact ? (
    <TinyNotice title={compact.title} />
  ) : (
    <GuardPlaceholder title={title} message={AWAITING_FIRST_SIGNAL} />
  );
}

/** A tiny tile has no room for the whole wording, so it draws nothing but the hover heading. */
function TinyNotice({ title }: { title: string }) {
  return <Panel panelTitle={title} fitToSize hoverTitle />;
}

/** Claims one declared channel with the widget's scope, drawing nothing. */
function ChannelClaim({ topic }: { topic: string }) {
  useClaimCapability("topic", topic);
  return null;
}

/** The Topic a field path names: its first two segments, as `vessel.orbit` for `vessel.orbit.sma`. */
function topicOfField(path: string): string {
  return path.split(".").slice(0, 2).join(".");
}

/**
 * Whether `topic` is read in the craft's delayed lane, by the roles the mod
 * states on `system.uplinks` (Uplink channels included), else by the
 * contract's own table. These are the channels that describe the active craft:
 * with none active, the mod withdraws each of them, so they read no value.
 */
function isCraftTopic(topic: string, roles?: DeclaredDelayRoles): boolean {
  // A ground Topic the client derives (`spaceCenter.state`) has no declared role and would default to the delayed lane, so the seat rule's ground decides first.
  return (
    delayLaneOf(topic, roles) === "delayed" &&
    groundDomainsOf({ channels: [topic as WidgetChannelId] }).length === 0
  );
}

/** The delay roles the running mod states for every channel, once its roster has arrived. */
function useDeclaredDelayRoles(): DeclaredDelayRoles | undefined {
  const roster = useTelemetry("system.uplinks");
  const payload =
    roster.state === "observed" || roster.state === "held"
      ? roster.value
      : undefined;
  return useMemo(() => readDeclaredDelayRoles(payload), [payload]);
}

/**
 * The Topics that gate a widget, read off what it declares it reads, with
 * nothing declared for the gate itself. Its craft Topics are the ones it
 * requires that the contract puts in the craft's delayed lane, Uplink channels
 * included by `roles`: with no active vessel the mod withdraws each of them.
 * Its career Topics count when it requires nothing else. A widget that requires
 * no Topic at all is gated by the craft Topics it reads optionally, unless it
 * also reads the ground (the Space Center, the career), which makes it a ground
 * instrument that works with no vessel, as the seat rule reads it too. One that
 * requires only ground Topics (the Tracking Station's bodies, Warp Control's
 * warp) works with no vessel, and one that needs more than the career (the
 * Astronaut Complex's crew) works in any save.
 */
export function gateTopicsOf(
  declared: {
    channels?: readonly string[];
    configChannels?: readonly string[];
    optionalChannels?: readonly string[];
    dataRequirements?: readonly string[];
  },
  roles?: DeclaredDelayRoles,
): { vesselTopics: readonly string[]; careerTopics: readonly string[] } {
  const required = [
    ...(declared.channels ?? []),
    ...(declared.configChannels ?? []),
    ...(declared.dataRequirements ?? []).map(topicOfField),
  ];
  const optional = declared.optionalChannels ?? [];
  const vesselTopics =
    required.length > 0
      ? required.filter((t) => isCraftTopic(t, roles))
      : groundDomainsOf({
            optionalChannels: optional as readonly WidgetChannelId[],
          }).length > 0
        ? []
        : optional.filter((t) => isCraftTopic(t, roles));
  const careerTopics = required.every((t) => t.startsWith("career."))
    ? required
    : [];
  return { vesselTopics, careerTopics };
}

/** The health and game-context half of {@link RequiresGuard}, inside its lock scope. */
function ReadinessGate(props: RequiresGuardProps) {
  const { vesselTopics, careerTopics } = gateTopicsOf(
    props,
    useDeclaredDelayRoles(),
  );
  const key = [...vesselTopics, "/", ...careerTopics].join("|");
  // The crash is read only for a widget that declares it: a read in here claims its topics for the widget's lock scope.
  return props.heldOpenBy?.includes("crash-ending") === true ? (
    <CrashHeldGate
      key={key}
      {...props}
      vesselTopics={vesselTopics}
      careerTopics={careerTopics}
    />
  ) : (
    <GameGate
      key={key}
      {...props}
      vesselTopics={vesselTopics}
      careerTopics={careerTopics}
      heldOpen={false}
    />
  );
}

interface TopicGateProps extends RequiresGuardProps {
  vesselTopics: readonly string[];
  careerTopics: readonly string[];
}

function CrashHeldGate(props: TopicGateProps) {
  return <GameGate {...props} heldOpen={useCrashEnding() !== undefined} />;
}

/** Whether any of `topics` reads no value. The list is fixed for a mounted gate, which is keyed by it. */
function useAnyAbsent(topics: readonly string[]): boolean {
  let absent = false;
  for (const topic of topics) {
    // biome-ignore lint/correctness/useHookAtTopLevel: the list is fixed for a mounted gate, which its parent keys by it
    const reading = useTelemetry(topic as TopicId) as { state: string };
    if (reading.state === "absent") absent = true;
  }
  return absent;
}

/**
 * Whether the game has no active vessel and one of the widget's craft Topics
 * says so. `ksp.activeVessel` tells "no vessel" from a vessel Topic that has
 * no value while a craft is flying, such as no target set or a craft that is
 * comms-dark.
 */
function useNoVessel(topics: readonly string[]): boolean {
  const active = useTelemetry("ksp.activeVessel");
  const anyAbsent = useAnyAbsent(topics);
  return topics.length > 0 && active.state === "absent" && anyAbsent;
}

function GameGate({
  channels,
  vesselTopics,
  careerTopics,
  title,
  heldOpen,
  children,
}: TopicGateProps & { heldOpen: boolean }) {
  const uplinkHealth = useUplinkHealthFor(channels ?? []);
  const ctx = useGameContext();
  const noVessel = useNoVessel(vesselTopics);
  const noCareer = useAnyAbsent(careerTopics);

  if (uplinkHealth.status === "resolved" && uplinkHealth.state !== "healthy") {
    return (
      <GuardPlaceholder
        title={title}
        message={uplinkHealth.detail ?? `${uplinkHealth.ownerId}: unavailable`}
      />
    );
  }

  // Without any game-context signal yet, gating would flash every widget on each refresh.
  if (!ctx.hasGameSignal) {
    return <>{children}</>;
  }

  if (noCareer) {
    return (
      <GuardPlaceholder
        title={title}
        message="Career or science save required"
        hint={
          ctx.careerMode === "SANDBOX"
            ? "Sandbox mode has no funds or science."
            : undefined
        }
      />
    );
  }

  let bypassed = false;
  if (noVessel) {
    if (!heldOpen) {
      return (
        <GuardPlaceholder
          title={title}
          message="No active vessel"
          hint={hintForScene(ctx.scene)}
        />
      );
    }
    bypassed = true;
  }

  // One element either way, so the widget is not remounted, and does not lose its state, when the crash starts holding it open.
  return (
    <HeldOpenContext.Provider value={bypassed ? "crash-ending" : undefined}>
      {children}
    </HeldOpenContext.Provider>
  );
}

/**
 * The one placeholder every orchestrator-side gate renders, since two gates
 * that look different read as two kinds of problem. It is the widget's own
 * panel, titled and inactive, so the tile keeps its place and says why.
 */
export function GuardPlaceholder({
  title,
  message,
  hint,
}: {
  title?: string;
  message: string;
  hint?: string;
}) {
  return <Panel panelTitle={title} inactive={{ reason: message, hint }} />;
}

/** A lock in a tiny tile: the tiny heading over the compact mark, in the frame the tiny form draws in. */
function TinyLockPlaceholder({
  title,
  lock,
}: {
  title: string;
  lock: LockSummary;
}) {
  return (
    <Panel
      panelTitle={title}
      fitToSize
      hoverTitle
      sections={
        <Section full>
          <Cluster justify="center">
            <LockMark lock={lock} />
          </Cluster>
        </Section>
      }
    />
  );
}

export { DimmedOverlay };

function hintForScene(scene: string): string | undefined {
  switch (scene) {
    case "SpaceCenter":
      return "Launch a vessel to see this widget live.";
    case "Editor":
      return "Editor scene: vessel data unavailable.";
    case "TrackingStation":
      return "Switch to a vessel in the tracking station.";
    case "MainMenu":
      return "Load a save to begin.";
    default:
      return undefined;
  }
}
