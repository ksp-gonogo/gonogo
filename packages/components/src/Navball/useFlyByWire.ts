import { useCommand } from "@ksp-gonogo/sitrep-client";
import { classifyCommandRejection } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useRef, useState } from "react";

/**
 * Fly-by-wire as the craft last answered it, or the command still travelling.
 * `unconfirmed` is an arm or disarm that got no answer: the craft may be
 * holding the stick or may not.
 */
export type FbwState = "off" | "arming" | "armed" | "disarming" | "unconfirmed";

type Settled = "off" | "armed" | "unconfirmed";

/**
 * FBW's state is the outcome of the latest arm or disarm command until the mod
 * reports otherwise: `readback` is `vessel.control.flyByWire`, the truth about
 * whether the override is armed on this craft, and every change in it settles
 * the state once no command is travelling. That is what a page reload relies
 * on, since the reload loses the command outcomes and the unmount disarm never
 * ran. The mod drops the override when the reported craft changes, so a new
 * `vesselId` reads as off. It disarms on unmount.
 */
export function useFlyByWire(
  vesselId: string | undefined,
  readback: boolean | undefined,
): {
  fbwState: FbwState;
  armFbw: () => void;
  disarmFbw: () => void;
} {
  const fbwCmd = useCommand("vessel.control.setFlyByWire");
  const [fbwState, setFbwState] = useState<FbwState>("off");
  const settled = useRef<Settled>("off");
  const latest = useRef(0);
  const stateRef = useRef<FbwState>("off");
  const travelling = useRef(false);
  useEffect(() => {
    stateRef.current = fbwState;
  }, [fbwState]);

  const vesselRef = useRef(vesselId);
  useEffect(() => {
    const previous = vesselRef.current;
    vesselRef.current = vesselId;
    if (previous === undefined || previous === vesselId) return;
    settled.current = "off";
    setFbwState("off");
  }, [vesselId]);

  useEffect(() => {
    if (readback === undefined || travelling.current) return;
    settled.current = readback ? "armed" : "off";
    setFbwState(settled.current);
  }, [readback]);

  useEffect(() => {
    return () => {
      if (stateRef.current === "off") return;
      void fbwCmd.send({ enabled: false }, { label: "Disarm FBW" });
    };
  }, [fbwCmd.send]);

  const dispatch = (enabled: boolean) => {
    const seq = ++latest.current;
    travelling.current = true;
    setFbwState(enabled ? "arming" : "disarming");
    fbwCmd
      .send({ enabled }, { label: enabled ? "Arm FBW" : "Disarm FBW" })
      .then(
        () => {
          if (seq !== latest.current) return;
          travelling.current = false;
          settled.current = enabled ? "armed" : "off";
          setFbwState(settled.current);
        },
        (err: unknown) => {
          if (seq !== latest.current) return;
          travelling.current = false;
          // A refusal or a failed send left the craft as it was; only a loss leaves it unknown.
          if (classifyCommandRejection(err).kind === "lost") {
            settled.current = "unconfirmed";
          }
          setFbwState(settled.current);
        },
      );
  };

  return {
    fbwState,
    armFbw: () => dispatch(true),
    disarmFbw: () => dispatch(false),
  };
}
