import type { CommcastTransmissionRow } from "@ksp-gonogo/sitrep-sdk";
import { useStreamEvent, useUtNow } from "@ksp-gonogo/sitrep-sdk/spine";
import { useState } from "react";
import {
  applyTransmissionRow,
  type DetectedTransmission,
  strangersOnAir,
  TRANSMISSIONS_TOPIC,
} from "./detected";

const NONE: ReadonlyMap<string, DetectedTransmission> = new Map();

/**
 * Keyings this vantage can detect but is not a party to, from
 * `commcast.transmissions`. Detection only: the row grants no access to the
 * audio, so this says who is on the air and nothing of what is said.
 */
export function useDetectedTransmissions(
  screenKey: string | undefined,
  isMine: (groupId: string) => boolean,
): DetectedTransmission[] {
  const utNow = useUtNow();
  const [held, setHeld] = useState(NONE);
  useStreamEvent<CommcastTransmissionRow>(TRANSMISSIONS_TOPIC, (row) => {
    if (utNow === undefined) return;
    setHeld((current) => applyTransmissionRow(current, row, utNow));
  });
  return strangersOnAir(held, utNow, screenKey, isMine);
}
