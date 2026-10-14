import type { ConfigComponentProps } from "@ksp-gonogo/core";
import { useTelemetry } from "@ksp-gonogo/core";
import {
  CELESTIAL_FACTS,
  CONTROL_FRAME_TOPIC,
  controlFrameToReadFrameChoice,
  useProcessor,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import type { ControlFrame } from "@ksp-gonogo/sitrep-sdk";
import { ConfigForm } from "@ksp-gonogo/ui";
import {
  ReadFrameControl,
  type ReadFrameOption,
  useModalSaveBar,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import { useBodyName } from "../shared/useBodyName";
import type { CurrentOrbitConfig, CurrentOrbitFrameChoice } from "./config";
import { followDiffersFromPin, referenceBodyOption } from "./readFrame";

const FOLLOW: CurrentOrbitFrameChoice = { kind: "follow-control-frame" };

export function CurrentOrbitConfigForm({
  config,
  onSave,
}: Readonly<ConfigComponentProps<CurrentOrbitConfig>>) {
  // A held catalogue is still the catalogue.
  const factsReading = useProcessor(CELESTIAL_FACTS);
  const facts =
    factsReading?.state === "observed" || factsReading?.state === "held"
      ? factsReading.value
      : undefined;
  const controlFrameReading = useStream<ControlFrame>(CONTROL_FRAME_TOPIC);
  const controlFrame =
    controlFrameReading.state === "observed" ||
    controlFrameReading.state === "held"
      ? controlFrameReading.value
      : undefined;
  const controlFrameChoice = controlFrameToReadFrameChoice(controlFrame, facts);
  const orbitReading = useTelemetry("vessel.orbit");
  const referenceBodyIndex =
    orbitReading.state === "observed" || orbitReading.state === "held"
      ? (orbitReading.value.referenceBodyIndex ?? undefined)
      : undefined;
  const referenceBody = {
    index: referenceBodyIndex,
    name: useBodyName(referenceBodyIndex) ?? undefined,
  };

  const pin = referenceBodyOption(referenceBody);
  const offerFollow = followDiffersFromPin(
    controlFrame,
    controlFrameChoice,
    referenceBody,
  );
  const options: ReadFrameOption[] = offerFollow
    ? [{ choice: FOLLOW, label: "Follow the in-game view" }, pin]
    : [pin];

  const [choice, setChoice] = useState<CurrentOrbitFrameChoice>(
    config?.frame ?? FOLLOW,
  );
  // Following reads in the pin's frame whenever it is not offered, so that is what the control shows.
  const shown =
    choice.kind === "follow-control-frame" && !offerFollow
      ? pin.choice
      : choice;

  const candidate = useMemo<CurrentOrbitConfig>(() => {
    const { frame: _saved, ...rest } = config ?? {};
    return choice.kind === "follow-control-frame"
      ? rest
      : { ...rest, frame: choice };
  }, [config, choice]);

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <ReadFrameControl
        id="current-orbit-frame"
        label="Read the orbit in"
        value={shown}
        options={options}
        onChange={(next) =>
          setChoice(next.kind === "body-centred-inertial" ? pin.choice : FOLLOW)
        }
      />
    </ConfigForm>
  );
}
