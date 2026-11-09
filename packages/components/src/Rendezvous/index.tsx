import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useActionInput } from "@ksp-gonogo/core";
import type { RendezvousPicture, TinyEssential } from "@ksp-gonogo/sitrep-sdk";
import { EmptyState, Panel, Section } from "@ksp-gonogo/ui-kit";
import { useEffect, useRef, useState } from "react";
import { closingRateReading, rangeReading } from "../shared/dockAngles";
import { approachView, encounterView, farView } from "./circles";
import {
  type DockingHudMode,
  type RendezvousActions,
  type RendezvousConfig,
  rendezvousActions,
} from "./config";
import { DockingCircle } from "./DockingCircle";
import { recallPortName, rememberPortName } from "./dockedName";
import { DRAWN_PICTURE, dockEdgeCue, dockMarkCues } from "./edgeCue";
import { LEVEL_NAMES } from "./LensStack";
import { DOCKING_ENTER_M } from "./levels";
import { ReadoutFigures } from "./ReadoutFigures";
import { RendezvousConfigForm } from "./RendezvousConfigForm";
import { RendezvousLevels } from "./RendezvousLevels";
import { TargetPanel } from "./RendezvousView";
import { useRendezvousGeometry } from "./useRendezvousGeometry";
import { useRendezvousLevel } from "./useRendezvousLevel";
import { rendezvousTopics, useRendezvousReading } from "./useRendezvousReading";

export type { RendezvousHudContext } from "./slots";

function RendezvousComponent({
  config,
}: Readonly<ComponentProps<RendezvousConfig>>) {
  const autoSwitch = config?.autoSwitch !== false;
  const hudMode: DockingHudMode = config?.hudMode ?? "hud-with-camera";

  const [picture, setPicture] = useState<RendezvousPicture | null>(null);
  const reading = useRendezvousReading();
  const { targetState, tarName, dockable, tarDistance, dockingAvailable } =
    reading;
  const targetReading = rendezvousTopics.useTelemetry("vessel.target");
  const target =
    targetReading.state === "observed" ? targetReading.value : undefined;

  const geometry = useRendezvousGeometry(
    target,
    targetState === "observed",
    tarDistance,
  );
  const { level, levels, setLevel, stepIn, stepOut } = useRendezvousLevel({
    autoSwitch,
    target: geometry.targetClass,
    input: {
      range: tarDistance,
      dockingAvailable: dockable && dockingAvailable,
      rangeInSoi: geometry.rangeInSoi,
      pathEntersBody: geometry.pathEntersBody,
    },
    targetState,
  });

  useActionInput<RendezvousActions>({
    "level-in": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      stepIn();
      return undefined;
    },
    "level-out": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      stepOut();
      return undefined;
    },
  });

  /*
   * KSP clears the target the moment a dock completes, while the docking
   * channel goes on reporting the ports' states, so the joined state is read
   * from that channel and remembered across the clear: the view stays at
   * Docking, reading "Docked", until a target is set again.
   */
  const joined = reading.dockJoined;
  const wasJoined = useRef(false);
  const lastName = useRef("");
  if (tarName !== undefined) {
    lastName.current = tarName;
    if (reading.dockTargetPort !== undefined) {
      rememberPortName(reading.dockTargetPort, tarName);
    }
  }
  useEffect(() => {
    if (joined) {
      wasJoined.current = true;
      return;
    }
    if (targetState !== "absent") wasJoined.current = false;
  }, [joined, targetState]);
  const docked = joined || (targetState === "absent" && wasJoined.current);
  // Short of a dock, a target cleared at the Docking level keeps the camera up behind a notice, so the picture is not cut off.
  const wasDocking = useRef(false);
  useEffect(() => {
    if (targetState !== "absent") wasDocking.current = level === "docking";
  }, [level, targetState]);

  if (targetState === "pending") {
    return (
      <TargetPanel>
        <EmptyState>Waiting for target telemetry</EmptyState>
      </TargetPanel>
    );
  }

  // Neither "not yet" nor "no target set": nothing here reports targets.
  if (targetState === "unowned") {
    return (
      <TargetPanel>
        <EmptyState>No target channel on this install</EmptyState>
      </TargetPanel>
    );
  }

  const cleared =
    targetState === "absent" &&
    (docked || (wasDocking.current && hudMode === "hud-with-camera"));
  // A cleared target arrives as a tombstone; `tarName === undefined` guards a record without a name.
  if ((targetState === "absent" || tarName === undefined) && !cleared) {
    return (
      <TargetPanel>
        <EmptyState>No target set in KSP</EmptyState>
      </TargetPanel>
    );
  }

  const shownLevel = docked || cleared ? "docking" : level;
  const noDockingData =
    reading.portTargeted &&
    !reading.dockingAvailable &&
    !docked &&
    tarDistance !== undefined &&
    tarDistance <= DOCKING_ENTER_M;
  const { craft, encounter, bodyIsMoon } = geometry;
  const views = {
    far: craft
      ? (unit: number, small: boolean) => farView(craft, unit, small)
      : null,
    approach: craft
      ? (unit: number, small: boolean) =>
          approachView(craft, unit, small, reading.orbitDrift ?? null)
      : null,
    encounter: encounter
      ? (unit: number) => encounterView(encounter, bodyIsMoon, unit)
      : null,
  };

  return (
    <Panel
      panelTitle={LEVEL_NAMES[shownLevel].toUpperCase()}
      sections={
        <Section fill>
          <RendezvousLevels
            target={geometry.targetClass}
            level={shownLevel}
            levels={levels}
            onSelect={setLevel}
            views={views}
            cues={{
              docking: docked
                ? null
                : (() => {
                    const portLeft = dockEdgeCue({
                      ax: reading.dockAx,
                      ay: reading.dockAy,
                      picture: picture ?? DRAWN_PICTURE,
                    });
                    if (portLeft !== null) return portLeft;
                    return dockMarkCues({
                      ax: reading.dockAx,
                      ay: reading.dockAy,
                      distance: reading.dockingDistance,
                      picture: hudMode === "hud-with-camera" ? picture : null,
                    });
                  })(),
            }}
            docking={() => (
              <DockingCircle
                distance={reading.dockingDistance}
                figuresReading={reading.dockingFiguresReading}
                ax={reading.dockAx}
                ay={reading.dockAy}
                forwardDot={reading.dockForwardDot}
                docked={docked}
                targetPort={cleared ? undefined : reading.dockTargetPort}
                picture={picture}
                showCamera={hudMode === "hud-with-camera"}
                cameraFlightId={config?.cameraFlightId}
                onPicture={setPicture}
                cleared={cleared}
              />
            )}
            figures={(layout, box, ask) => (
              <ReadoutFigures
                level={shownLevel}
                name={
                  tarName ??
                  (lastName.current || recallPortName(reading.dockTargetPort))
                }
                reading={reading}
                craft={geometry.craft}
                periapsis={geometry.periapsis}
                layout={layout}
                box={box}
                ask={ask}
                docked={docked}
                noTarget={cleared && !docked}
                noDockingData={noDockingData}
              />
            )}
          />
        </Section>
      }
    />
  );
}

/** How far the target is and how fast that is closing. */
function useRendezvousEssentials(): readonly TinyEssential[] {
  const target = rendezvousTopics.useTelemetry("vessel.target");
  // A tile this small draws no circles, so there is no level to step; the keys are bound so they stay claimed at every size.
  useActionInput<RendezvousActions>({
    "level-in": () => undefined,
    "level-out": () => undefined,
  });
  return [
    { label: "Range", value: rangeReading(target.relativePosition) },
    {
      label: "Closing",
      value: closingRateReading(
        target.relativePosition,
        target.relativeVelocity,
      ),
    },
  ];
}

registerComponent<RendezvousConfig>({
  id: "rendezvous",
  name: "Rendezvous",
  description: "Range and closing rate to your target.",
  tags: ["telemetry", "rendezvous"],
  defaultSize: { w: 6, h: 9 },
  // Four columns and six rows: below that the circle, the name and the range cannot all be drawn, and the body scrolls.
  minSize: { w: 4, h: 6 },
  component: RendezvousComponent,
  tiny: {
    title: "TARGET",
    bindsActions: true,
    useEssentials: useRendezvousEssentials,
  },
  configComponent: RendezvousConfigForm,
  channels: rendezvousTopics.channels,
  optionalChannels: rendezvousTopics.optionalChannels,
  actions: rendezvousActions,
  // The docking figures arrive once a second at the base rate; Faster raises them while the widget is open.
  dataRates: { fast: ["vessel.dock"] },
  defaultConfig: { autoSwitch: true, hudMode: "hud-with-camera" },
  augmentSlots: ["rendezvous.camera", "rendezvous.overlay"],
  pushable: true,
  requires: ["flight"],
});

export { RendezvousComponent };
