import type { ConfigComponentProps } from "@ksp-gonogo/core";
import { useContributions } from "@ksp-gonogo/core";
import {
  CELESTIAL_FACTS,
  CONTROL_FRAME_TOPIC,
  controlFrameToReadFrameChoice,
  readFrameChoicesEqual,
  useProcessor,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import type { ControlFrame } from "@ksp-gonogo/sitrep-sdk";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Select,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import { ReadFrameControl } from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import type { SystemViewConfig } from "./config";
import { followControlFrameProjection } from "./projection";
import { useCelestialBodies } from "./useCelestialBodies";

export function SystemViewConfigForm({
  config,
  onSave,
}: Readonly<ConfigComponentProps<SystemViewConfig>>) {
  const bodies = useCelestialBodies();
  // A held catalogue is still the catalogue.
  const factsReading = useProcessor(CELESTIAL_FACTS);
  const facts =
    factsReading?.state === "observed" || factsReading?.state === "held"
      ? factsReading.value
      : undefined;
  // For "Follow the in-game view", offered only when it would draw something the picker's other entries do not already draw.
  const controlFrameReading = useStream<ControlFrame>(CONTROL_FRAME_TOPIC);
  const controlFrame =
    controlFrameReading.state === "observed" ||
    controlFrameReading.state === "held"
      ? controlFrameReading.value
      : undefined;
  const controlFrameChoice = controlFrameToReadFrameChoice(controlFrame, facts);

  const [frame, setFrame] = useState(config?.frame ?? "auto");
  const [projection, setProjection] = useState(config?.projection ?? "");

  // "auto" follows the live vessel and cannot be resolved here, so this lists the root body's projections.
  const frameBodyName =
    frame === "auto" || frame === "root"
      ? (bodies.find((b) => b.referenceBody === null)?.name ?? null)
      : frame;
  const frameBodyIndex =
    frameBodyName === null ? undefined : facts?.indexByName[frameBodyName];
  const allProjections = useContributions("system-view.projection");
  const projectionOptions = useMemo(
    () =>
      frameBodyIndex === undefined
        ? []
        : allProjections.filter((p) => p.frameBodyIndex === frameBodyIndex),
    [allProjections, frameBodyIndex],
  );
  const followEntry = useMemo(
    () =>
      frameBodyIndex === undefined
        ? null
        : followControlFrameProjection(
            frameBodyIndex,
            projectionOptions.map((p) => p.choice),
            controlFrameChoice,
          ),
    [frameBodyIndex, projectionOptions, controlFrameChoice],
  );
  const projectionEntries = useMemo(
    () =>
      followEntry === null
        ? projectionOptions
        : [...projectionOptions, followEntry],
    [projectionOptions, followEntry],
  );
  // The host contributes the inertial entry first, so an absent or stale saved id lands on it, matching `index.tsx`'s own fallback.
  const selectedProjection =
    projectionEntries.find((p) => p.id === projection) ??
    projectionEntries[0] ??
    null;

  const candidate = useMemo<SystemViewConfig>(() => {
    const defaultId = projectionEntries[0]?.id;
    const chosenId = selectedProjection?.id;
    return chosenId === undefined || chosenId === defaultId
      ? { frame }
      : { frame, projection: chosenId };
  }, [frame, selectedProjection, projectionEntries]);

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="system-frame">Frame of reference</FieldLabel>
        <Select
          id="system-frame"
          value={frame}
          onChange={(e) => setFrame(e.target.value)}
        >
          <option value="auto">Auto (current body)</option>
          <option value="root">Root parent (whole system)</option>
          {bodies
            .filter((b) => b.name !== null)
            .map((b) => (
              <option key={b.index} value={b.name ?? ""}>
                {b.name}
              </option>
            ))}
        </Select>
        <FieldHint>
          "Auto" follows the vessel's current body: Kerbin-orbit shows
          Mun/Minmus, Mun-orbit shows Mun. "Root parent" walks up to the star so
          you see the whole system. Pick a specific body to pin the frame.
        </FieldHint>
      </Field>
      <ReadFrameControl
        id="system-projection"
        label="Draw the picture in"
        value={
          selectedProjection?.choice ?? {
            kind: "body-centred-inertial",
            bodyIndex: frameBodyIndex ?? -1,
          }
        }
        options={projectionEntries.map((entry) => ({
          choice: entry.choice,
          label: entry.label,
        }))}
        onChange={(choice) => {
          const match = projectionEntries.find((entry) =>
            readFrameChoicesEqual(entry.choice, choice),
          );
          if (match !== undefined) setProjection(match.id);
        }}
        hint="This changes what the axes do, not which body is in the middle. The
          bodies, their orbits and the craft all move together: holding the
          parent still is how a transfer window becomes a shape you can see, and
          the orbit stops looking closed because it is not. The panel says which
          one you are looking at."
      />
    </ConfigForm>
  );
}
