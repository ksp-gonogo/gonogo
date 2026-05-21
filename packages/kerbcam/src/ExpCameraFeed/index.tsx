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
  // No data keys — the widget pulls its camera registry + stream
  // direct from the kerbcam DataSource via custom hooks. Listing
  // kerbcam.cameras here would push the orchestrator to schedule
  // a subscription that the hook already owns.
  dataRequirements: [],
  defaultConfig: {
    flightId: null,
  },
  actions: [],
  pushable: true,
});

export { ExpCameraFeed };
export type { ExpCameraFeedConfig };
