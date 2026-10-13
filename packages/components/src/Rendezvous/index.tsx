import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import type { TinyEssential } from "@ksp-gonogo/sitrep-sdk";
import { EmptyState } from "@ksp-gonogo/ui-kit";
import { closingRateReading, rangeReading } from "../shared/dockAngles";
import { ApproachHud } from "./ApproachHud";
import type { DockingHudMode, RendezvousConfig } from "./config";
import { DockingHud } from "./DockingHud";
import { RendezvousConfigForm } from "./RendezvousConfigForm";
import { TargetPanel, TrackingView } from "./RendezvousView";
import { useRendezvousMode } from "./useRendezvousMode";
import { rendezvousTopics, useRendezvousReading } from "./useRendezvousReading";

export type { RendezvousHudContext } from "./slots";

function RendezvousComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<RendezvousConfig>>) {
  const autoSwitch = config?.autoSwitch !== false;
  const hudMode: DockingHudMode = config?.hudMode ?? "hud-with-camera";

  const {
    targetState,
    tarName,
    dockable,
    timeToClosestApproach,
    tarDistance,
    relVel,
    rangeR,
    closingRateR,
    dockAx,
    dockAy,
    dockAz,
    dockX,
    dockY,
    dockingRelVel,
    dockingDistance,
    dockingFiguresReading,
    dockForwardDot,
    dockingAvailable,
    alignmentWithheld,
    modelledAlignment,
    outOfContact,
    reckoned,
    reckonedDistance,
  } = useRendezvousReading();

  const mode = useRendezvousMode({
    autoSwitch,
    dockable,
    dockingAvailable,
    tarDistance,
    targetState,
  });

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

  // A cleared target arrives as a tombstone; `tarName === undefined` guards a record without a name.
  if (targetState === "absent" || tarName === undefined) {
    return (
      <TargetPanel>
        <EmptyState>No target set in KSP</EmptyState>
      </TargetPanel>
    );
  }

  // View choice is distance-driven, but the chrome still backs off in a small slot.
  const rows = h ?? 5;
  const cols = w ?? 6;

  if (mode === "docking-hud") {
    return (
      <DockingHud
        name={tarName}
        distance={dockingDistance}
        figuresReading={dockingFiguresReading}
        relVel={dockingRelVel}
        ax={dockAx}
        ay={dockAy}
        az={dockAz}
        x={dockX}
        y={dockY}
        forwardDot={dockForwardDot}
        modelled={modelledAlignment ? { basis: modelledAlignment } : undefined}
        showCamera={hudMode === "hud-with-camera"}
        cameraFlightId={config?.cameraFlightId}
        cols={cols}
        rows={rows}
      />
    );
  }

  if (mode === "approach") {
    return (
      <ApproachHud
        name={tarName}
        distance={tarDistance}
        relVel={relVel}
        rangeR={rangeR}
        closingRateR={closingRateR}
        timeToClosestApproach={timeToClosestApproach}
        alignmentWithheld={alignmentWithheld}
        cols={cols}
        rows={rows}
      />
    );
  }

  const showSubReadout =
    rows >= 5 && relVel !== undefined && Number.isFinite(relVel);
  const showTargetName = rows >= 4 || cols >= 5;

  return (
    <TrackingView
      name={tarName}
      distance={tarDistance}
      rangeR={rangeR}
      closingRateR={closingRateR}
      outOfContact={outOfContact}
      reckoned={reckoned}
      reckonedDistance={reckonedDistance}
      showTargetName={showTargetName}
      showSubReadout={showSubReadout}
    />
  );
}

/** How far the target is and how fast that is closing. */
function useRendezvousEssentials(): readonly TinyEssential[] {
  const target = rendezvousTopics.useTelemetry("vessel.target");
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
  description:
    "Your target's name, range and closing rate, whether it is a vessel, a docking port or a body. Closing on a vessel or docking port, it switches to a docking view with an alignment reticle, over a camera picture when an Uplink supplies one through the `rendezvous.camera` slot.",
  tags: ["telemetry", "rendezvous"],
  defaultSize: { w: 6, h: 9 },
  // Five rows: at four the overflow glow painted out the waiting hint's last word.
  minSize: { w: 3, h: 5 },
  component: RendezvousComponent,
  tiny: {
    title: "TARGET",
    useEssentials: useRendezvousEssentials,
  },
  configComponent: RendezvousConfigForm,
  channels: rendezvousTopics.channels,
  defaultConfig: { autoSwitch: true, hudMode: "hud-with-camera" },
  augmentSlots: ["rendezvous.camera", "rendezvous.overlay"],
  pushable: true,
  requires: ["flight"],
});

export { RendezvousComponent };
