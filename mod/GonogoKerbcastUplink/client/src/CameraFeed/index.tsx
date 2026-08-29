import { registerComponent } from "@ksp-gonogo/sitrep-sdk";
import { KERBCAST } from "../uplink";
import {
  CameraFeed,
  type CameraFeedConfig,
  cameraFeedActions,
  isPartCamera,
} from "./CameraFeed";
import { CameraFeedConfigPanel } from "./CameraFeedConfigPanel";

registerComponent<CameraFeedConfig>({
  id: "camera-feed",
  name: "Camera Feed",
  description:
    "Live camera streams from in-flight Hullcam VDS parts, with an in-widget camera picker and Next/Previous switching.",
  tags: ["camera"],
  defaultSize: { w: 6, h: 5 },
  /**
   * Six columns is what the feed header's own title needs before it
   * ellipsises, and four rows is what the "no cameras" sentence needs before
   * the panel edge cuts through it. Both come out of the shared kerbcast feed
   * rather than this widget, so the tile is the only side that can give.
   *
   * <p>It was five, measured on macOS, and five had NO margin: the same title
   * rendered 5px wider under Linux font metrics and the render gate refused
   * the page because "Nose Cam" was clipped rather than readable. A threshold
   * measured on one platform's font rasterisation and set to the exact width
   * that just fits is a threshold that only holds on that platform, so this
   * one is deliberately a column clear of the boundary rather than on it.</p>
   */
  minSize: { w: 6, h: 4 },
  // On MobileDashboard a widget without this squishes to
  // `defaultSize.h * ROW_HEIGHT` (5 * 25 = 125px), far too short for a
  // 16:9 feed. Give it a proper box (mirrors the other media-ish widgets
  // and the mobile-sizing regression guarded by camera-feed-mobile.spec).
  mobileHeight: 280,
  component: CameraFeed,
  // "Show debug info" lives in the gear modal's Settings tab (paired with the
  // Inputs tab the widget's actions add): not in the in-feed camera dropdown.
  configComponent: CameraFeedConfigPanel,
  // kerbcast.cameras is pulled direct from the kerbcast DataSource via
  // custom hooks: not listed here to avoid a duplicate subscription.
  // CommNet topics are listed so the orchestrator knows to subscribe them
  // for signal strength / connection status / one-way signal delay (the
  // always-on delay + quality badges in the feed header).
  dataRequirements: ["vessel.comms", "comms.link", "comms.delay"],
  // Exposes an overlay slot, drawn over the video and passed the feed's pixel
  // dimensions and displayed camera id. No first-party augment fills it yet.
  augmentSlots: ["camera-feed.overlay"],
  defaultConfig: {
    flightId: null,
    showDebugInfo: false,
  },
  actions: cameraFeedActions,
  pushable: true,
  owner: KERBCAST,
});

export type { CameraFeedConfig };
export { CameraFeed, cameraFeedActions, isPartCamera };
