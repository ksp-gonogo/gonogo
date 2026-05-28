import { registerComponent } from "@gonogo/core";
import { ExpCameraFeed, type ExpCameraFeedConfig } from "./ExpCameraFeed";

registerComponent<ExpCameraFeedConfig>({
  id: "exp-camera-feed",
  name: "Camera Feed (exp)",
  description:
    "Experimental — single Hullcam VDS stream from the kerbcam sidecar via WebRTC. Replaces the OCISLY camera feed once the architecture is proven; both can coexist on a dashboard during the migration.",
  tags: ["camera", "experimental"],
  defaultSize: { w: 5, h: 5 },
  minSize: { w: 2, h: 2 },
  component: ExpCameraFeed,
  // kerbcam.cameras is pulled direct from the kerbcam DataSource via
  // custom hooks — not listed here to avoid a duplicate subscription.
  // CommNet keys are listed so the orchestrator knows to subscribe
  // the "data" source for signal strength / connection status.
  dataRequirements: ["comm.signalStrength", "comm.connected"],
  defaultConfig: {
    flightId: null,
  },
  actions: [],
  pushable: true,
});

export type { ExpCameraFeedConfig };
export { ExpCameraFeed };
