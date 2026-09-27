import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import { EmptyState, ReadoutCaption, Stack, Unit } from "@ksp-gonogo/ui-kit";
import { ApproachHud } from "./ApproachHud";
import type { DockingHudMode, TargetingConfig } from "./config";
import { DockingHud } from "./DockingHud";
import { TargetingConfigForm } from "./TargetingConfigForm";
import { TargetPanel, TrackingView } from "./TargetingView";
import { useTargetingMode } from "./useTargetingMode";
import { targetingTopics, useTargetingReading } from "./useTargetingReading";

export type { TargetingHudContext } from "./slots";

function TargetingComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<TargetingConfig>>) {
  const autoSwitch = config?.autoSwitch !== false;
  const hudMode: DockingHudMode = config?.hudMode ?? "hud-with-camera";

  const {
    targetState,
    tarName,
    dockable,
    closestApproachUT,
    universalTime,
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
    dockForwardDot,
    dockingAvailable,
    alignmentWithheld,
    modelledAlignment,
    dockAge,
    age,
    outOfContact,
    reckoned,
    reckonedDistance,
  } = useTargetingReading();

  const mode = useTargetingMode({
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

  /*
   * Confirmed absence: a cleared target arrives as a tombstone. `tarName ===
   * undefined` guards a record without a name. A confirmed absence can itself
   * go old, which the age says.
   */
  if (targetState === "absent" || tarName === undefined) {
    // "Confirmed" only while we are still hearing from the craft.
    const confirmedWord =
      targetState === "observed" || targetState === "absent"
        ? "confirmed"
        : "last seen";
    return (
      <TargetPanel>
        <EmptyState>
          {/* Stacked: as siblings the text and caption ran into one accessible string. */}
          <Stack>
            <span>No target set in KSP</span>
            {age !== undefined && (
              <ReadoutCaption>
                {confirmedWord} <Unit value={age} /> ago
              </ReadoutCaption>
            )}
          </Stack>
        </EmptyState>
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
        relVel={dockingRelVel}
        ax={dockAx}
        ay={dockAy}
        az={dockAz}
        x={dockX}
        y={dockY}
        forwardDot={dockForwardDot}
        modelled={
          modelledAlignment
            ? { basis: modelledAlignment, age: dockAge }
            : undefined
        }
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
        closestApproachUT={
          typeof closestApproachUT === "number" ? closestApproachUT : null
        }
        universalTime={typeof universalTime === "number" ? universalTime : null}
        alignmentWithheld={alignmentWithheld ? { age: dockAge } : undefined}
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

registerComponent<TargetingConfig>({
  id: "targeting",
  name: "Targeting",
  description:
    "Target name + distance, with an auto-switching docking HUD (crosshair + alignment reticle + optional camera backdrop) when closing on a vessel or docking port.",
  tags: ["telemetry", "rendezvous"],
  defaultSize: { w: 6, h: 9 },
  /* Five rows: at four the overflow glow painted out the waiting hint's last word. */
  minSize: { w: 3, h: 5 },
  component: TargetingComponent,
  configComponent: TargetingConfigForm,
  channels: targetingTopics.channels,
  defaultConfig: { autoSwitch: true, hudMode: "hud-with-camera" },
  augmentSlots: ["targeting.camera", "targeting.overlay"],
  pushable: true,
  requires: ["flight"],
});

export { TargetingComponent };
