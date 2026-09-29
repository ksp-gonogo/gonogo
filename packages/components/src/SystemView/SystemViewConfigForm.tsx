import type { ConfigComponentProps } from "@ksp-gonogo/core";
import { useContributions } from "@ksp-gonogo/core";
import { CELESTIAL_FACTS, useProcessor } from "@ksp-gonogo/sitrep-client";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Select,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import { useMemo, useState } from "react";
import type { SystemViewConfig } from "./config";
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

  const candidate = useMemo<SystemViewConfig>(
    () => (projection === "" ? { frame } : { frame, projection }),
    [frame, projection],
  );

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
      <Field>
        <FieldLabel htmlFor="system-projection">Draw the picture in</FieldLabel>
        <Select
          id="system-projection"
          value={projection}
          onChange={(e) => setProjection(e.target.value)}
        >
          <option value="">Follow the frame (the ordinary view)</option>
          {projectionOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        <FieldHint>
          This changes what the axes do, not which body is in the middle. The
          bodies, their orbits and the craft all move together: holding the
          parent still is how a transfer window becomes a shape you can see, and
          the orbit stops looking closed because it is not. The panel says which
          one you are looking at.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}
