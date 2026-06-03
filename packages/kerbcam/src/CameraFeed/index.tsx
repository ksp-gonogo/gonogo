import { registerComponent } from "@gonogo/core";
import {
  CameraFeed,
  type CameraFeedConfig,
  cameraFeedActions,
} from "./CameraFeed";

registerComponent<CameraFeedConfig>({
  id: "camera-feed",
  name: "Camera Feed",
  description:
    "Live camera streams from in-flight Hullcam VDS parts, with an in-widget camera picker and Next/Previous switching.",
  tags: ["camera"],
  defaultSize: { w: 5, h: 5 },
  minSize: { w: 2, h: 2 },
  // On MobileDashboard a widget without this squishes to
  // `defaultSize.h * ROW_HEIGHT` (5 * 25 = 125px) — far too short for a
  // 16:9 feed. Give it a proper box (mirrors the other media-ish widgets
  // and the mobile-sizing regression guarded by camera-feed-mobile.spec).
  mobileHeight: 280,
  component: CameraFeed,
  // kerbcam.cameras is pulled direct from the kerbcam DataSource via
  // custom hooks — not listed here to avoid a duplicate subscription.
  // CommNet keys are listed so the orchestrator knows to subscribe
  // the "data" source for signal strength / connection status.
  dataRequirements: ["comm.signalStrength", "comm.connected"],
  defaultConfig: {
    flightId: null,
    showDebugInfo: false,
  },
  actions: cameraFeedActions,
  pushable: true,
});

export type { CameraFeedConfig };
export { CameraFeed, cameraFeedActions };
