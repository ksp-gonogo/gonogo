import {
  type ReadFrameChoice,
  readFrameChoicesEqual,
} from "@ksp-gonogo/sitrep-client";
import {
  apsidesExist,
  type ControlFrame,
  ControlFrameKind,
  controlFrameLabel,
  type QualifiedFrame,
} from "@ksp-gonogo/sitrep-sdk";
import type { CurrentOrbitFrameChoice } from "./config";

/** What the readouts are qualified against, and the frame's name when it is not the Control Frame. */
export interface CurrentOrbitFrame {
  frame: QualifiedFrame | undefined;
  ownFrameLabel: string | undefined;
}

/** The vessel's own reference body, the only centre its elements are about. */
export interface ReferenceBody {
  index: number | undefined;
  name: string | undefined;
}

function inertialAboutReferenceBody(
  referenceBody: ReferenceBody,
): ReadFrameChoice {
  return {
    kind: "body-centred-inertial",
    bodyIndex: referenceBody.index ?? null,
  };
}

function inertialLabel(referenceBody: ReferenceBody): string | undefined {
  return controlFrameLabel({
    kind: ControlFrameKind.BodyCentredInertial,
    centreBody: referenceBody.name ?? null,
  });
}

/**
 * The frame Current Orbit reads its elements in.
 *
 * Absent a pin it follows the Control Frame while that frame has a centre. A
 * frame with none (a rotating pair, the target frame) has no apsides at all,
 * so the widget reads in the frame centred on the vessel's reference body
 * instead, where the elements it is given are defined, and names it. A
 * Control Frame not yet reported stays unknown rather than being overridden:
 * nothing says it lacks a centre.
 */
export function currentOrbitFrame(
  configured: CurrentOrbitFrameChoice | undefined,
  controlFrame: ControlFrame | undefined,
  controlFrameChoice: ReadFrameChoice | null,
  referenceBody: ReferenceBody,
): CurrentOrbitFrame {
  if (configured !== undefined && configured.kind !== "follow-control-frame") {
    const pinned = inertialAboutReferenceBody(referenceBody);
    return {
      frame: pinned,
      ownFrameLabel: readFrameChoicesEqual(pinned, controlFrameChoice)
        ? undefined
        : inertialLabel(referenceBody),
    };
  }
  if (apsidesExist(controlFrame) !== "invalid") {
    return { frame: controlFrame, ownFrameLabel: undefined };
  }
  return {
    frame: inertialAboutReferenceBody(referenceBody),
    ownFrameLabel: inertialLabel(referenceBody),
  };
}

/** The pinned choice the config form offers, and what an operator calls it. */
export function referenceBodyOption(referenceBody: ReferenceBody): {
  choice: CurrentOrbitFrameChoice;
  label: string;
} {
  return {
    choice: { kind: "body-centred-inertial" },
    label: inertialLabel(referenceBody) ?? "<centre>-Centred Inertial",
  };
}

/**
 * Whether following the Control Frame would read in a different frame from
 * the reference-body pin, the only condition under which the form offers it.
 * Compared after this widget's own override, so a centreless Control Frame,
 * which it reads as the pin, is not offered as a second entry with one
 * behaviour.
 */
export function followDiffersFromPin(
  controlFrame: ControlFrame | undefined,
  controlFrameChoice: ReadFrameChoice | null,
  referenceBody: ReferenceBody,
): boolean {
  if (controlFrameChoice === null) return false;
  const pin = inertialAboutReferenceBody(referenceBody);
  const followed =
    apsidesExist(controlFrame) === "invalid" ? pin : controlFrameChoice;
  return !readFrameChoicesEqual(followed, pin);
}
