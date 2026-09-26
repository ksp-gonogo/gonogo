import { useCommand } from "@ksp-gonogo/sitrep-client";
import { usePanelDelay } from "@ksp-gonogo/ui-kit";
import { useEffect, useRef, useState } from "react";

// FBW has no readback, so its state mirrors the latest arm command; it disarms on unmount.
export function useFlyByWire(): {
  fbwArmed: boolean;
  armFbw: () => void;
  disarmFbw: () => void;
} {
  const fbwCmd = useCommand("vessel.control.setFlyByWire");
  usePanelDelay(fbwCmd);
  const [fbwArmed, setFbwArmed] = useState(false);
  const fbwArmedRef = useRef(false);
  useEffect(() => {
    fbwArmedRef.current = fbwArmed;
  }, [fbwArmed]);
  useEffect(() => {
    return () => {
      if (fbwArmedRef.current) {
        void fbwCmd.send({ enabled: false }, { label: "Disarm FBW" });
      }
    };
  }, [fbwCmd.send]);

  const armFbw = () => {
    void fbwCmd.send({ enabled: true }, { label: "Arm FBW" });
    setFbwArmed(true);
  };
  const disarmFbw = () => {
    void fbwCmd.send({ enabled: false }, { label: "Disarm FBW" });
    setFbwArmed(false);
  };
  return { fbwArmed, armFbw, disarmFbw };
}
