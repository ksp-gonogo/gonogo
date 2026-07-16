import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getDataSource,
  useActionInput,
  useDataValue,
} from "@ksp-gonogo/core";
import {
  type CameraFeedHandle,
  KerbcastProvider,
  type KerbcastSubscriptions,
  CameraFeed as SharedCameraFeed,
} from "@ksp-gonogo/kerbcast-react";
import { logger } from "@ksp-gonogo/logger";
import { Badge, type BadgeTone, formatDuration } from "@ksp-gonogo/ui-kit";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KerbcastDataSource } from "../KerbcastDataSource";
import {
  useDelayedKerbcastStream,
  useDelayedPlaybackStatus,
} from "./useDelayedKerbcastStream";

export interface CameraFeedConfig extends Record<string, unknown> {
  /**
   * KSP `Part.flightID` of the camera to stream. `null` (the
   * default) auto-picks the first available — handy for "drop the
   * widget on a dashboard and it just works", and the natural state
   * before the operator has explicitly picked one. Once the operator
   * selects a camera (via the in-widget picker or a Next/Previous
   * input) the chosen flightId is persisted here.
   */
  flightId: number | null;
  /**
   * When true, the feed renders the technical readouts (resolution +
   * encoder bitrate) in the top overlay. Defaults to `false` so the
   * default chrome stays uncluttered; toggled from the camera menu.
   */
  showDebugInfo: boolean;
}

// ---------------------------------------------------------------------------
// Augment slots (Uplink architecture spec §4). CameraFeed is PRIMARILY an
// augment itself (it fills `distance-to-target.camera`) and secondarily a HOST
// widget that exposes two slots. No first-party augment fills either here — the
// package move + Kerbalism/RA fillers are a later phase — so each renders
// nothing until an Uplink registers into it.
// ---------------------------------------------------------------------------

/**
 * Props for `camera-feed.overlay` — an OVERLAY slot (spec §4.8), rendered in a
 * layer absolutely positioned OVER the video element. Data-over-video augments
 * (a telemetry HUD painted on the feed at key moments) draw here in the feed's
 * pixel space, so the slot passes the rendered video-container dimensions and
 * the flightID of the camera currently on screen. `width`/`height` are CSS px
 * (0 before the first measure); `flightId` reflects what the SDK actually shows
 * — auto-picks included — via `onDisplayedCameraChange`, not the requested id.
 *
 * NOTE: richer projection (the SDK's internal pan/zoom transform) isn't
 * readable from this wrapper; exposing it waits on the widget's move into
 * `@ksp-gonogo/kerbcast` (P3), where it can read the SDK feed handle directly.
 */
export interface CameraOverlayContext {
  /** flightID of the displayed camera (auto-picks included); null before one resolves. */
  flightId: number | null;
  /** Rendered width of the video container, CSS px (0 before first measure). */
  width: number;
  /** Rendered height of the video container, CSS px. */
  height: number;
}

/**
 * Props for `camera-feed.badges` — the widget's BROAD escape-hatch slot (spec
 * §4.8 composable badges), rendered as a small chip strip in the feed header.
 * Badge augments read their own Topics via hooks, so the only context passed
 * down is the displayed camera's flightID for labelling.
 */
export interface CameraBadgesContext {
  flightId: number | null;
}

// Co-located declaration-merge of this widget's slot ids → their props (spec
// §4.6). Kept next to the widget (not a central registry file) so parallel slot
// work on other widgets never collides on this seam.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "camera-feed.overlay": CameraOverlayContext;
    "camera-feed.badges": CameraBadgesContext;
  }
}

/** Component actions exposed to the serial-input platform. */
export const cameraFeedActions = [
  {
    id: "nextCamera",
    label: "Next camera",
    accepts: ["button"],
    description:
      "Switch to the next available camera, persisting the choice to the widget config (wraps round at the end of the list).",
  },
  {
    id: "prevCamera",
    label: "Previous camera",
    accepts: ["button"],
    description: "Switch to the previous available camera (wraps round).",
  },
  {
    id: "zoomIn",
    label: "Zoom in",
    accepts: ["button"],
    description: "Zoom in one step (reduces field of view by 5 degrees).",
  },
  {
    id: "zoomOut",
    label: "Zoom out",
    accepts: ["button"],
    description: "Zoom out one step (increases field of view by 5 degrees).",
  },
  {
    id: "panYaw",
    label: "Pan yaw axis",
    accepts: ["analog"],
    description:
      "Analog yaw pan rate. Positive = pan right, negative = pan left. Maps -1..1 to the camera's max pan speed.",
  },
  {
    id: "panPitch",
    label: "Pan pitch axis",
    accepts: ["analog"],
    description:
      "Analog pitch pan rate. Positive = pan up, negative = pan down. No-op if the camera does not support pitch. Maps -1..1 to the camera's max pan speed.",
  },
] as const satisfies readonly ActionDefinition[];

export type CameraFeedActions = typeof cameraFeedActions;

export function CameraFeed({
  config,
  onConfigChange,
}: Readonly<ComponentProps<CameraFeedConfig>>) {
  const ds = getDataSource("kerbcast") as KerbcastDataSource | undefined;
  const client = ds?.getClient();

  // Ensure the sidecar connection is open before we render.
  useEffect(() => {
    ds?.ensureConnected();
  }, [ds]);

  // Diagnostic: which client instance does the provider hold right now? Pairs
  // with the connected-client `kerbcast:clock` logs — if this `instanceId`
  // differs from the one logging advancing `captureUt`, a reconnect/TURN
  // rebuild orphaned the clock onto an instance the provider no longer reads.
  useEffect(() => {
    if (!client) return;
    const instanceId = (client as unknown as { __kcInstanceId?: number })
      .__kcInstanceId;
    logger
      .tag("kerbcast:clock")
      .debug("CameraFeed provider client", { instanceId });
  }, [client]);

  // Build the subscriptions adapter once per data source so acquire/release
  // calls are stable across re-renders.
  const subscriptions: KerbcastSubscriptions | undefined = useMemo(
    () =>
      ds
        ? {
            acquire: ds.subscribeCamera.bind(ds),
            release: ds.unsubscribeCamera.bind(ds),
          }
        : undefined,
    [ds],
  );

  const requested = config?.flightId ?? null;
  const showDebugInfo = config?.showDebugInfo ?? false;

  // Internal ref driving the shared component's handle (pan/zoom serial
  // actions). Nothing outside this component holds a ref to CameraFeed.
  const feedRef = useRef<CameraFeedHandle>(null);

  // ---- Overlay-slot geometry ----
  // The `camera-feed.overlay` slot passes the rendered video-container size so
  // an overlay augment can lay out in the feed's pixel space. Measured off the
  // positioned wrapper via a callback ref + ResizeObserver, so it re-attaches
  // cleanly across the `!client` early-return (the wrapper only mounts once the
  // stream is ready). ResizeObserver is stubbed in tests (installDomStubs).
  const [feedSize, setFeedSize] = useState({ width: 0, height: 0 });
  const overlayObserverRef = useRef<ResizeObserver | null>(null);
  const attachOverlayWrap = useCallback((el: HTMLDivElement | null) => {
    overlayObserverRef.current?.disconnect();
    overlayObserverRef.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setFeedSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    overlayObserverRef.current = ro;
  }, []);
  useEffect(() => () => overlayObserverRef.current?.disconnect(), []);

  // ---- Serial-input actions ----
  // stepCamera, setZoomRate and setPanAxis are guarded internally by the
  // shared component (showZoom / showPan / supportsPitch checks), so the
  // handlers here can call them unconditionally.
  useActionInput<CameraFeedActions>({
    nextCamera: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      feedRef.current?.stepCamera(1);
    },
    prevCamera: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      feedRef.current?.stepCamera(-1);
    },
    zoomIn: (payload) => {
      if (payload.kind !== "button") return;
      feedRef.current?.setZoomRate(payload.value === true ? 1 : 0);
    },
    zoomOut: (payload) => {
      if (payload.kind !== "button") return;
      feedRef.current?.setZoomRate(payload.value === true ? -1 : 0);
    },
    panYaw: (payload) => {
      if (payload.kind !== "analog") return;
      feedRef.current?.setPanAxis("yaw", payload.value as number);
    },
    panPitch: (payload) => {
      if (payload.kind !== "analog") return;
      feedRef.current?.setPanAxis("pitch", payload.value as number);
    },
  });

  // ---- CommNet degrade (500ms debounce) ----
  // In auto mode (config.flightId === null) the shared component picks the
  // displayed camera itself, and that pick can differ from config.flightId.
  // Rather than re-derive the same auto-latch resolution here, let the shared
  // component report what it actually shows via onDisplayedCameraChange so
  // degrade always targets the feed on screen (auto-picks included).
  const [effectiveFlightId, setEffectiveFlightId] = useState<number | null>(
    requested,
  );

  const signalStrength = useDataValue<number>("data", "comm.signalStrength");
  const commConnected = useDataValue<boolean>("data", "comm.connected");
  // One-way light-time delay for THIS downlink (the footage left the craft
  // this long ago) — NOT round-trip. Round-trip doubling only applies to
  // interactive command/response paths (e.g. the kOS terminal), which this
  // feed is not. `comm.signalDelay` maps to `comms.delay.oneWaySeconds`
  // (gonogo's own SignalDelay authority) — same clean-name convention as
  // `comm.signalStrength`/`comm.connected` above.
  const signalDelay = useDataValue<number | null>("data", "comm.signalDelay");
  const degradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (effectiveFlightId === null || !client) return;
    // If both values are undefined, CommNet data isn't available -- skip.
    if (signalStrength === undefined && commConnected === undefined) return;

    let level: number;
    if (commConnected === false) {
      level = 1.0;
    } else if (typeof signalStrength === "number") {
      level = Math.max(0, Math.min(1, 1 - signalStrength));
    } else {
      return;
    }

    if (degradeTimerRef.current !== null) clearTimeout(degradeTimerRef.current);
    degradeTimerRef.current = setTimeout(() => {
      void client.camera(effectiveFlightId as number).setDegrade(level);
    }, 500);

    return () => {
      if (degradeTimerRef.current !== null)
        clearTimeout(degradeTimerRef.current);
    };
  }, [effectiveFlightId, signalStrength, commConnected, client]);

  // Cross-browser kerbcast video-delay design (2026-07-16), decision 5:
  // "can't delay -> no video". `useDelayedKerbcastStream` (passed to the SDK
  // below as `useStream`) can only return `MediaStream | null` — it has no
  // channel back to THIS component to say "delay was expected here but no
  // backend could build a pipeline". `useDelayedPlaybackStatus` is that
  // side channel (see that hook's module doc): when it reports
  // `"unavailable"`, render an explicit "delayed feed unavailable" state
  // INSTEAD of the SDK's own feed — never the live stream underneath it.
  // Called unconditionally, alongside every other hook above, BEFORE the
  // `!client` early return below (rules of hooks).
  const playoutStatus = useDelayedPlaybackStatus(effectiveFlightId);
  const unavailableReason =
    playoutStatus.kind === "unavailable" ? playoutStatus.reason : null;

  if (!client || !subscriptions) return null;

  // Slot props (spec §4.4). Both carry the displayed camera's flightID; the
  // overlay additionally carries the measured video-container size so an
  // overlay augment can draw in the feed's pixel space.
  const overlayContext: CameraOverlayContext = {
    flightId: effectiveFlightId,
    width: feedSize.width,
    height: feedSize.height,
  };
  const badgesContext: CameraBadgesContext = { flightId: effectiveFlightId };

  // Always-on status chips, intrinsic to a delayed downlink feed (not a
  // cross-mod augment) — every camera feed shows both, unobtrusively, next to
  // whatever a `camera-feed.badges` augment contributes.
  const delayBadge = describeSignalDelay(signalDelay);
  const qualityBadge = describeSignalQuality(commConnected, signalStrength);

  // Inject gonogo's delayed-playout stream source through the SDK's `useStream`
  // seam (kerbcam §3.4). `useDelayedKerbcastStream` is a stable module-scope
  // hook, satisfying the seam's rules-of-hooks contract. Its signature matches
  // the SDK's `CameraStreamHook` type, so the prop is passed plainly.
  //
  // The feed is wrapped in a positioned box that hosts the augment slots: an
  // OVERLAY layer painted over the video (pointer-events off so the SDK's own
  // controls stay reachable; an augment re-enables pointer events on its own
  // interactive elements) and a top-of-feed BADGES strip. Both are empty until
  // an Uplink registers, adding nothing to the stock feed.
  return (
    <KerbcastProvider client={client} subscriptions={subscriptions}>
      <div ref={attachOverlayWrap} style={FEED_WRAP_STYLE}>
        <SharedCameraFeed
          ref={feedRef}
          useStream={useDelayedKerbcastStream}
          flightId={requested}
          onSelectCamera={(nextFlightId) =>
            onConfigChange?.({
              flightId: nextFlightId,
              showDebugInfo: config?.showDebugInfo ?? false,
            })
          }
          onDisplayedCameraChange={setEffectiveFlightId}
          showDebugInfo={showDebugInfo}
          enableFullscreen
          enablePictureInPicture
        />
        {unavailableReason && (
          <div role="status" aria-live="polite" style={FEED_UNAVAILABLE_STYLE}>
            <Badge tone="nogo" aria-label="Delayed feed unavailable">
              DELAYED FEED UNAVAILABLE
            </Badge>
            <span style={FEED_UNAVAILABLE_REASON_STYLE}>
              {unavailableReason}
            </span>
          </div>
        )}
        <div style={FEED_OVERLAY_STYLE}>
          <AugmentSlot name="camera-feed.overlay" props={overlayContext} />
        </div>
        <div style={FEED_BADGES_STYLE}>
          {delayBadge && (
            <Badge tone="neutral" aria-label={delayBadge.ariaLabel}>
              {delayBadge.label}
            </Badge>
          )}
          {qualityBadge && (
            <Badge tone={qualityBadge.tone} aria-label={qualityBadge.ariaLabel}>
              {qualityBadge.label}
            </Badge>
          )}
          <AugmentSlot name="camera-feed.badges" props={badgesContext} />
        </div>
      </div>
    </KerbcastProvider>
  );
}

interface StatusBadgeInfo {
  label: string;
  ariaLabel: string;
}

interface QualityBadgeInfo extends StatusBadgeInfo {
  tone: BadgeTone;
}

// Signal-delay badge: ONE-WAY light-time only. This is a downlink — the
// footage on screen left the craft `signalDelay` seconds ago — so unlike an
// interactive command/response path (e.g. the kOS terminal) there is no
// round-trip to double. Hidden at 0/null/undefined (LAN, no measurable
// path, or no delay authority mounted — comms-delay-nullable-when-no-path
// fix), matching the "unobtrusive" brief: nothing to show, show nothing.
function describeSignalDelay(
  signalDelay: number | null | undefined,
): StatusBadgeInfo | null {
  if (
    typeof signalDelay !== "number" ||
    !Number.isFinite(signalDelay) ||
    signalDelay <= 0
  ) {
    return null;
  }
  // A delay is a READOUT, not a countdown, so keep one decimal where it
  // matters (sub-minute — the common case) instead of formatDuration's
  // whole-unit truncation (3.8s must not read as "3s"). Above a minute the
  // decimal is noise, so hand off to the shared scaled formatter.
  const label =
    signalDelay < 60
      ? `${signalDelay.toFixed(1)}s`
      : formatDuration(signalDelay);
  return { label, ariaLabel: `Signal delay: ${label} one-way` };
}

// Signal-quality badge: craft-side CommNet strength, 0..1 -> percentage.
// `connected === false` always wins (a lost link has no meaningful strength
// percentage, even if a stale value is still cached). Hidden only when
// neither key has ever arrived — the same "no CommNet data" guard the
// degrade effect above uses — so the badge appears as soon as there's
// anything to say.
function describeSignalQuality(
  connected: boolean | undefined,
  signalStrength: number | undefined,
): QualityBadgeInfo | null {
  if (connected === undefined && signalStrength === undefined) return null;
  // NO SIGNAL when the link is down OR the strength has decayed to
  // effectively zero (0%): a 0% link carries nothing, so it reads as no
  // signal rather than a "0%" quality badge (comms-delay-model-consistency
  // spec, Phase 3). The tiny epsilon is a float-noise guard, not a "weak
  // link" threshold — a real 1% link still shows its percentage.
  const zeroSignal =
    typeof signalStrength === "number" &&
    Number.isFinite(signalStrength) &&
    signalStrength <= 1e-6;
  if (connected === false || zeroSignal) {
    return {
      label: "NO SIGNAL",
      tone: "nogo",
      ariaLabel: "Signal quality: no signal",
    };
  }
  if (typeof signalStrength !== "number" || !Number.isFinite(signalStrength)) {
    return null;
  }
  const pct = Math.round(Math.max(0, Math.min(1, signalStrength)) * 100);
  const tone: BadgeTone = pct >= 66 ? "go" : pct >= 33 ? "warn" : "nogo";
  return { label: `${pct}%`, tone, ariaLabel: `Signal quality: ${pct}%` };
}

// Positioned wrapper that lets the augment slots layer over the SDK feed. The
// feed's own root (`Stage`) fills this box, so absolutely-positioned children
// cover the video exactly.
const FEED_WRAP_STYLE: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  display: "flex",
};

// Full-area overlay layer; pointer-events off so it never steals clicks from
// the feed's controls beneath. Augments opt back in on their own elements.
const FEED_OVERLAY_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

// Header badge strip, top-of-feed. Positioned to the right of the SDK's own
// (hover-gated) title so chips stay clear of it. Container is click-through;
// individual badges re-enable pointer events as needed.
const FEED_BADGES_STYLE: CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  display: "flex",
  gap: 4,
  padding: 4,
  pointerEvents: "none",
};

// Cross-browser kerbcast video-delay design (2026-07-16), decision 5:
// "can't delay -> no video" — a full-cover scrim replacing the SDK's own
// feed whenever `useDelayedPlaybackStatus` reports `"unavailable"`. Opaque
// (unlike FEED_OVERLAY_STYLE) and above every other layer: the whole point
// is that the operator must never see live, undelayed pixels here — the
// dark background + centred reason IS the "no signal" visual language this
// package already uses for a disconnected feed, reused for the "can't
// delay" case rather than invented fresh.
const FEED_UNAVAILABLE_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: 16,
  textAlign: "center",
  background: "rgba(0, 0, 0, 0.92)",
  pointerEvents: "auto",
};

const FEED_UNAVAILABLE_REASON_STYLE: CSSProperties = {
  color: "#c9c9c9",
  fontSize: "0.8rem",
  maxWidth: "80%",
};
