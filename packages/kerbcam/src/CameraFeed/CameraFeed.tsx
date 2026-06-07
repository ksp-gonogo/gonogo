import type { ActionDefinition, ComponentProps } from "@gonogo/core";
import { useActionInput, useDataValue, useExecuteAction } from "@gonogo/core";
import { ChevronDownIcon, IconButton, Panel } from "@gonogo/ui";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import styled, { css } from "styled-components";
import { buildCameraLabeler } from "../cameraLabels";
import { useKerbcamCameras } from "../hooks/useKerbcamCameras";
import { useKerbcamStream } from "../hooks/useKerbcamStream";
import { isCameraDestroyed } from "../lifecycle";

// ── Pan / zoom control tuning ───────────────────────────────────────────────
// Two control idioms, by input type:
//  - DISCRETE (on-screen arrow + zoom buttons): each press = one fixed *_NUDGE_DEG
//    step via an *absolute* set-pan / set-fov against an optimistic accumulator.
//    No velocity, no hold — a press moves exactly one unit. Absolute commands are
//    reliable (they carry a position the plugin slews to), unlike rate commands.
//  - ANALOG (drag ball, serial stick axes): deflection maps to a normalised
//    velocity (−1…1) sent as set-pan-rate; the plugin integrates + slews. Centre
//    / release sends rate 0 to stop.
const PAN_NUDGE_DEG = 5; // one discrete pan step
const FOV_NUDGE_DEG = 5; // one discrete zoom-button keyboard step
const PAN_BALL_RADIUS = 15; // ball's pixel deflection bound (full = rate 1)
// The FoV slider declares a precise absolute FoV. We debounce the drag and only
// send the *settled* value, so a drag doesn't stream intermediate set-fov.
const FOV_SLIDER_DEBOUNCE_MS = 120;
// Analog deadzone: a physical stick dithering near centre would otherwise emit
// a stream of tiny non-zero rates, each a command + a sliver of integrated
// drift. Snap small magnitudes to zero.
const ANALOG_DEADZONE = 0.05;

const clampPan = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

const applyDeadzone = (v: number): number =>
  Math.abs(v) < ANALOG_DEADZONE ? 0 : v;

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
    description: "Zoom in one step (reduces field of view by 5°).",
  },
  {
    id: "zoomOut",
    label: "Zoom out",
    accepts: ["button"],
    description: "Zoom out one step (increases field of view by 5°).",
  },
  {
    id: "panYaw",
    label: "Pan yaw axis",
    accepts: ["analog"],
    description:
      "Analog yaw pan rate. Positive = pan right, negative = pan left. Maps −1…1 to the camera's max pan speed.",
  },
  {
    id: "panPitch",
    label: "Pan pitch axis",
    accepts: ["analog"],
    description:
      "Analog pitch pan rate. Positive = pan up, negative = pan down. No-op if the camera does not support pitch. Maps −1…1 to the camera's max pan speed.",
  },
] as const satisfies readonly ActionDefinition[];

export type CameraFeedActions = typeof cameraFeedActions;

/** Round n to the nearest even integer, minimum 2 (H.264 chroma requirement). */
function toEvenPx(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function CameraFeed({
  config,
  onConfigChange,
}: Readonly<ComponentProps<CameraFeedConfig>>) {
  const cameras = useKerbcamCameras();
  const requested = config?.flightId ?? null;

  // --------------------------------------------------------------------------
  // Selection model.
  //
  // `config.flightId` is the single source of truth for an *explicit* pick;
  // `null` means "auto". Resolution order:
  //   1. Explicit pick, if still present in the list (destroyed or not) — the
  //      operator chose it, so we honour it even after the part blows up.
  //   2. Auto: *latch* onto whatever's currently on screen. Once a camera is
  //      displayed we keep showing it even if it becomes destroyed, so a feed
  //      the operator is watching never silently jumps to a sibling or vanishes
  //      when its part is destroyed. The latch only releases when that camera
  //      leaves the list entirely (vessel change).
  //   3. Fresh auto-pick (nothing latched / latched camera gone): prefer the
  //      first *live* camera — a destroyed one makes a poor default. Fall back
  //      to the first camera overall only if every camera is destroyed, so the
  //      widget shows a SIGNAL LOST feed rather than "no cameras".
  //
  // The latch needs a render-time ref read (what's currently displayed is
  // historical state, not derivable from cameras+config alone); it's committed
  // in an effect below.
  // --------------------------------------------------------------------------
  const displayedRef = useRef<number | null>(null);
  const requestedStillPresent =
    requested !== null && cameras.some((c) => c.flightId === requested);

  let flightId: number | null;
  if (requestedStillPresent) {
    flightId = requested;
  } else {
    const latched = displayedRef.current;
    const latchedPresent =
      latched !== null && cameras.some((c) => c.flightId === latched);
    flightId = latchedPresent
      ? latched
      : (cameras.find((c) => !isCameraDestroyed(c))?.flightId ??
        cameras[0]?.flightId ??
        null);
  }

  const camera =
    flightId !== null
      ? (cameras.find((c) => c.flightId === flightId) ?? null)
      : null;

  // Commit the on-screen camera for the auto-mode latch above.
  useEffect(() => {
    displayedRef.current = flightId;
  }, [flightId]);

  // Connection status is intentionally NOT shown here — it lives in the Data
  // Sources widget (and a disconnect surfaces as a banner). This widget only
  // shows cameras-or-none, so the operator isn't asked to reason about
  // transport details at the feed level.

  const stream = useKerbcamStream(flightId);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const isDestroyed = camera ? isCameraDestroyed(camera) : false;

  const executeKerbcam = useExecuteAction("kerbcam");

  // --------------------------------------------------------------------------
  // Camera selection — picker + Next/Prev. All paths persist through
  // onConfigChange so the choice survives a remount, mirroring CameraFeed.
  // --------------------------------------------------------------------------
  // Per-widget "show debug info" toggle, edited from the gear modal's Settings
  // tab (see CameraFeedConfigPanel); here we only read it to gate the readout.
  const showDebugInfo = config?.showDebugInfo ?? false;

  // The camera pick carries the *full* config (both fields), defaulting any the
  // caller's config object happens to be missing, so it can't strip the sibling
  // `showDebugInfo` field on persist.
  const selectCamera = useCallback(
    (nextFlightId: number | null) => {
      onConfigChange?.({
        flightId: nextFlightId,
        showDebugInfo: config?.showDebugInfo ?? false,
      });
    },
    [config, onConfigChange],
  );

  const currentIndex = useMemo(
    () =>
      flightId !== null
        ? cameras.findIndex((c) => c.flightId === flightId)
        : -1,
    [cameras, flightId],
  );

  const stepCamera = useCallback(
    (delta: number) => {
      if (cameras.length === 0) return;
      const base = currentIndex >= 0 ? currentIndex : 0;
      const next = (base + delta + cameras.length) % cameras.length;
      selectCamera(cameras[next]?.flightId ?? null);
    },
    [cameras, currentIndex, selectCamera],
  );

  useActionInput<CameraFeedActions>({
    nextCamera: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      stepCamera(1);
    },
    prevCamera: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      stepCamera(-1);
    },
    zoomIn: (payload) => {
      // Hold-to-zoom: press starts a zoom-in velocity, release (value false)
      // stops it. +rate = zoom in (FoV decreases), per the kerbcam contract.
      if (payload.kind !== "button") return;
      if (!showZoom) return;
      sendZoomRate(payload.value === true ? 1 : 0);
    },
    zoomOut: (payload) => {
      if (payload.kind !== "button") return;
      if (!showZoom) return;
      sendZoomRate(payload.value === true ? -1 : 0);
    },
    panYaw: (payload) => {
      if (payload.kind !== "analog") return;
      if (!showPan) return;
      setPanAxis("yaw", payload.value as number);
    },
    panPitch: (payload) => {
      if (payload.kind !== "analog") return;
      if (!showPan || !supportsPitch) return;
      setPanAxis("pitch", payload.value as number);
    },
  });

  // --------------------------------------------------------------------------
  // Feature: Render-size feedback (ResizeObserver, 500ms debounce)
  // --------------------------------------------------------------------------
  const wrapRef = useRef<HTMLDivElement>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (flightId === null) return;
    const el = wrapRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width } = entry.contentRect;
      if (resizeTimerRef.current !== null) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        // Always request a 16:9 frame (height derived from width) so KSP renders
        // a widescreen feed regardless of the widget's grid proportions, rather
        // than an arbitrary aspect that'd letterbox or distort in the player.
        const w = toEvenPx(width);
        const h = toEvenPx((width * 9) / 16);
        void executeKerbcam(`kerbcam.set-render-size[${flightId},${w},${h}]`);
      }, 500);
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (resizeTimerRef.current !== null) clearTimeout(resizeTimerRef.current);
    };
  }, [flightId, executeKerbcam]);

  // --------------------------------------------------------------------------
  // Feature: CommNet signal degrade (500ms debounce)
  // --------------------------------------------------------------------------
  const signalStrength = useDataValue<number>("data", "comm.signalStrength");
  const commConnected = useDataValue<boolean>("data", "comm.connected");
  const degradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (flightId === null) return;
    // If both values are undefined, CommNet data isn't available — skip
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
      void executeKerbcam(`kerbcam.set-degrade[${flightId},${level}]`);
    }, 500);

    return () => {
      if (degradeTimerRef.current !== null)
        clearTimeout(degradeTimerRef.current);
    };
  }, [flightId, signalStrength, commConnected, executeKerbcam]);

  // --------------------------------------------------------------------------
  // Feature: Pan + zoom velocity controls.
  //
  // Continuous controls (ball drag, arrow/button hold, serial axes) send a
  // normalised rate via set-pan-rate / set-zoom-rate; the plugin integrates it
  // per frame and slews smoothly. We hold the last-*sent* rate in a ref and
  // dedupe identical sends, so a held control needs no further traffic.
  //
  // Discrete keyboard nudges (Enter/Space — pointer `detail === 0`) use the
  // absolute set-pan / set-fov path against an optimistic accumulator
  // (localPanRef / localFovRef), synced from the camera's echoed absolute only
  // while idle — so rapid key-repeat doesn't collapse on the lagging echo.
  // --------------------------------------------------------------------------

  // Pitch is adjustable only when the camera reports a non-zero pitch range.
  const supportsPitch = !!camera && camera.panPitchMax - camera.panPitchMin > 0;

  const panRateRef = useRef({ yaw: 0, pitch: 0 }); // last pan rate SENT
  const zoomRateRef = useRef(0); // last zoom rate SENT
  const ballDragRef = useRef({ active: false, startX: 0, startY: 0 });
  const [ballPos, setBallPos] = useState({ x: 0, y: 0 });
  // Optimistic accumulators for the discrete keyboard nudge path only.
  const localPanRef = useRef({ yaw: 0, pitch: 0 });
  const localFovRef = useRef(0);
  // FoV slider drag state: while dragging, the thumb follows the pointer
  // optimistically (not the lagging camera echo); on release, echo-sync resumes.
  const fovSliderDraggingRef = useRef(false);
  // Optimistic FoV thumb position — follows the pointer while dragging, then the
  // camera echo when idle.
  const [sliderFov, setSliderFov] = useState<number>(60);
  // Debounced slider-commit state (declared here so the echo-sync effect below
  // can see a pending send): while a send is pending the thumb is the operator's,
  // not the camera echo's.
  const fovDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFovRef = useRef<number | null>(null);
  // Always-fresh snapshot so the send helpers never read a stale closure.
  const panEnvRef = useRef({
    flightId: null as number | null,
    execute: executeKerbcam,
  });
  useEffect(() => {
    panEnvRef.current = { flightId, execute: executeKerbcam };
  }, [flightId, executeKerbcam]);

  // Sync the nudge accumulators and slider positions from sidecar state while
  // idle, so the next discrete nudge starts from the camera's true pan / FoV,
  // and the slider thumb reflects reality when nobody is dragging.
  useEffect(() => {
    if (!camera) return;
    if (
      !ballDragRef.current.active &&
      panRateRef.current.yaw === 0 &&
      panRateRef.current.pitch === 0
    ) {
      localPanRef.current = { yaw: camera.panYaw, pitch: camera.panPitch };
    }
    if (
      zoomRateRef.current === 0 &&
      !fovSliderDraggingRef.current &&
      pendingFovRef.current === null
    ) {
      localFovRef.current = camera.fov;
      setSliderFov(camera.fov);
    }
  }, [camera]);

  // Send a normalised pan velocity, deduped against the last sent and with the
  // analog deadzone applied. Updates the ref only on an actual send, so the ref
  // always reflects what the plugin last heard.
  const sendPanRate = useCallback((yaw: number, pitch: number) => {
    const env = panEnvRef.current;
    if (env.flightId === null) return;
    const y = applyDeadzone(clampPan(yaw, -1, 1));
    const p = applyDeadzone(clampPan(pitch, -1, 1));
    const last = panRateRef.current;
    if (y === last.yaw && p === last.pitch) return;
    panRateRef.current = { yaw: y, pitch: p };
    void env.execute(`kerbcam.set-pan-rate[${env.flightId},${y},${p}]`);
  }, []);

  // Update one axis, preserving the other — so two independent serial axes (or
  // an axis + the ball) compose instead of clobbering each other.
  const setPanAxis = useCallback(
    (axis: "yaw" | "pitch", value: number) => {
      const cur = panRateRef.current;
      if (axis === "yaw") sendPanRate(value, cur.pitch);
      else sendPanRate(cur.yaw, value);
    },
    [sendPanRate],
  );

  const sendZoomRate = useCallback((rate: number) => {
    const env = panEnvRef.current;
    if (env.flightId === null) return;
    const r = applyDeadzone(clampPan(rate, -1, 1));
    if (r === zoomRateRef.current) return;
    zoomRateRef.current = r;
    void env.execute(`kerbcam.set-zoom-rate[${env.flightId},${r}]`);
  }, []);

  // Absolute FoV — the vertical zoom slider declares a precise target FoV and
  // the server slews there (accurate target-based control, vs. chasing the frame).
  const sendAbsoluteFov = useCallback(
    (fov: number) => {
      const env = panEnvRef.current;
      if (env.flightId === null || !camera) return;
      const clamped = clampPan(fov, camera.fovMin, camera.fovMax);
      localFovRef.current = clamped;
      void env.execute(`kerbcam.set-fov[${env.flightId},${clamped}]`);
    },
    [camera],
  );

  // Debounced slider commit: while dragging we update the thumb optimistically
  // but only send the *settled* FoV (no intermediate stream). flushFovSlider
  // sends immediately (on pointer release); scheduleFovSlider sends after the
  // drag pauses (covers keyboard arrow-stepping too, which has no pointer-up).
  const flushFovSlider = useCallback(() => {
    if (fovDebounceRef.current !== null) {
      clearTimeout(fovDebounceRef.current);
      fovDebounceRef.current = null;
    }
    if (pendingFovRef.current !== null) {
      sendAbsoluteFov(pendingFovRef.current);
      pendingFovRef.current = null;
    }
  }, [sendAbsoluteFov]);
  const scheduleFovSlider = useCallback(
    (fov: number) => {
      pendingFovRef.current = fov;
      if (fovDebounceRef.current !== null) clearTimeout(fovDebounceRef.current);
      fovDebounceRef.current = setTimeout(
        flushFovSlider,
        FOV_SLIDER_DEBOUNCE_MS,
      );
    },
    [flushFovSlider],
  );
  useEffect(
    () => () => {
      if (fovDebounceRef.current !== null) clearTimeout(fovDebounceRef.current);
    },
    [],
  );

  const showPan = camera?.supportsPan && !isDestroyed;
  const showZoom = camera?.supportsZoom && !isDestroyed;

  // Stop any active rate when the streamed camera changes or the widget
  // unmounts. The KerbcamDataSource outlives this widget and the sidecar's
  // disconnect deadman only fires on PEER loss — so without this cleanup an
  // unmount mid-pan leaves the plugin integrating the last non-zero rate to its
  // bounds. Captures the flightId the rates were sent for (the cleanup closure
  // sees the value from when the effect ran, not the new one).
  useEffect(() => {
    if (flightId === null) return;
    return () => {
      // Best-effort: a stop racing a teardown may hit an already-closed
      // control channel (execute rejects). There's nothing left to stop then,
      // so swallow it rather than leak an unhandled rejection.
      const stop = (action: string) =>
        void executeKerbcam(action).catch(() => {});
      if (panRateRef.current.yaw !== 0 || panRateRef.current.pitch !== 0) {
        stop(`kerbcam.set-pan-rate[${flightId},0,0]`);
        panRateRef.current = { yaw: 0, pitch: 0 };
      }
      if (zoomRateRef.current !== 0) {
        stop(`kerbcam.set-zoom-rate[${flightId},0]`);
        zoomRateRef.current = 0;
      }
    };
  }, [flightId, executeKerbcam]);

  // Hard stop if a control hides mid-hold (signal lost / support dropped): the
  // captured pointer's release never reaches us then. sendPanRate/sendZoomRate
  // dedupe, so these are no-ops when nothing is active.
  useEffect(() => {
    if (!showPan) {
      ballDragRef.current.active = false;
      setBallPos({ x: 0, y: 0 });
      sendPanRate(0, 0);
    }
  }, [showPan, sendPanRate]);
  useEffect(() => {
    if (!showZoom) sendZoomRate(0);
  }, [showZoom, sendZoomRate]);

  // --------------------------------------------------------------------------
  // Discrete keyboard nudges — absolute set-pan / set-fov against the
  // optimistic accumulators. Bumps land via the plugin's per-field sequence
  // counter even after a rate has drifted the target.
  // --------------------------------------------------------------------------
  const onFovChange = useCallback(
    (newFov: number) => {
      if (flightId === null || !camera) return;
      const clamped = clampPan(newFov, camera.fovMin, camera.fovMax);
      localFovRef.current = clamped;
      void executeKerbcam(`kerbcam.set-fov[${flightId},${clamped}]`);
    },
    [flightId, camera, executeKerbcam],
  );
  // deltaSign: -1 = zoom in (FoV down), +1 = zoom out (FoV up).
  const nudgeZoom = useCallback(
    (deltaSign: number) => {
      onFovChange(localFovRef.current + deltaSign * FOV_NUDGE_DEG);
    },
    [onFovChange],
  );
  const nudgePan = useCallback(
    (yawSign: number, pitchSign: number) => {
      if (flightId === null || !camera) return;
      const loc = localPanRef.current;
      loc.yaw = clampPan(
        loc.yaw + yawSign * PAN_NUDGE_DEG,
        camera.panYawMin,
        camera.panYawMax,
      );
      loc.pitch = clampPan(
        loc.pitch + pitchSign * PAN_NUDGE_DEG,
        camera.panPitchMin,
        camera.panPitchMax,
      );
      void executeKerbcam(
        `kerbcam.set-pan[${flightId},${loc.yaw},${loc.pitch}]`,
      );
    },
    [flightId, camera, executeKerbcam],
  );

  // On-screen pan ARROWS are discrete: nudgePan moves one fixed step per click
  // (mouse or keyboard) — exactly one unit, no held velocity. Zoom buttons, by
  // contrast, hold a constant velocity (wired in JSX); their keyboard path is a
  // discrete nudgeZoom step.

  // Ball: drag deflection ∝ rate; release springs to centre and stops.
  // Vertical (pitch) is locked when pitch isn't supported.
  const handleBallDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (flightId === null) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      ballDragRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
      };
    },
    [flightId],
  );
  const handleBallMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = ballDragRef.current;
      if (!drag.active) return;
      let dx = e.clientX - drag.startX;
      let dy = supportsPitch ? e.clientY - drag.startY : 0;
      const mag = Math.hypot(dx, dy);
      if (mag > PAN_BALL_RADIUS) {
        const k = PAN_BALL_RADIUS / mag;
        dx *= k;
        dy *= k;
      }
      setBallPos({ x: dx, y: dy });
      sendPanRate(dx / PAN_BALL_RADIUS, -dy / PAN_BALL_RADIUS);
    },
    [supportsPitch, sendPanRate],
  );
  const handleBallUp = useCallback(() => {
    ballDragRef.current.active = false;
    setBallPos({ x: 0, y: 0 });
    sendPanRate(0, 0);
  }, [sendPanRate]);

  // --------------------------------------------------------------------------
  // Derived subtitle parts
  // --------------------------------------------------------------------------
  const bitrateLabel =
    camera && camera.encoderBitrateBps > 0
      ? ` · ${Math.round(camera.encoderBitrateBps / 1000)}kbps`
      : "";
  const adaptiveLabel =
    camera && camera.renderWidth < camera.operatorWidth ? " · adaptive" : "";

  const hasCameras = cameras.length > 0;
  const canStep = cameras.length > 1;

  // Unique per widget instance so two CameraFeeds on one dashboard don't
  // produce duplicate ids (the menu trigger ↔ menu association).
  const menuId = useId();

  // The chrome (title / metadata / menu + the controls) overlays the feed and
  // is hover-revealed on desktop. Touch has no hover, so tapping the video pins
  // the chrome visible (tap again to hide) — see Stage's $pinned rule.
  const [chromePinned, setChromePinned] = useState(false);

  // --------------------------------------------------------------------------
  // Camera menu — the title IS the trigger. Clicking it opens a dropdown of
  // selectable cameras plus the "show debug info" toggle at the bottom.
  // --------------------------------------------------------------------------
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  // Escape closes the menu (and returns focus to the trigger); an outside
  // pointer-down dismisses it too. Both are no-ops while the menu is closed.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !menuTriggerRef.current?.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  // Compact title (as a menu trigger) + optional debug metadata, overlaid on
  // the feed (top-left) with the Next/Prev step buttons floated top-right.
  // Shared by the live + empty states.
  // Disambiguate cameras that share a name (e.g. docking-port cams are all
  // "NavCam"); see buildCameraLabeler. Shared with the DistanceToTarget picker.
  const cameraLabel = useMemo(() => buildCameraLabeler(cameras), [cameras]);

  const title = camera ? cameraLabel(camera) : "Camera Feed";
  const topOverlay = (
    <TopOverlay>
      <TitleRow>
        {/* The title text IS the menu trigger. The <h3> keeps the heading
            role (so the camera name is still a landmark + queryable heading);
            the inner <button> carries the menu semantics. */}
        <TopTitle>
          {hasCameras ? (
            <TitleButton
              ref={menuTriggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <TitleButton__Text>{title}</TitleButton__Text>
              <ChevronDownIcon aria-hidden="true" />
            </TitleButton>
          ) : (
            title
          )}
        </TopTitle>
        {hasCameras && (
          <StepButtons>
            <OverlayIconButton
              type="button"
              aria-label="Previous camera"
              disabled={!canStep}
              onClick={() => stepCamera(-1)}
            >
              ‹
            </OverlayIconButton>
            <OverlayIconButton
              type="button"
              aria-label="Next camera"
              disabled={!canStep}
              onClick={() => stepCamera(1)}
            >
              ›
            </OverlayIconButton>
          </StepButtons>
        )}
      </TitleRow>

      {menuOpen && hasCameras && (
        <CameraMenu ref={menuRef} id={menuId} role="menu" aria-label="Camera">
          {cameras.map((c) => (
            <CameraMenuItem
              key={c.flightId}
              type="button"
              role="menuitemradio"
              aria-checked={c.flightId === flightId}
              $selected={c.flightId === flightId}
              onClick={() => {
                selectCamera(c.flightId);
                setMenuOpen(false);
                menuTriggerRef.current?.focus();
              }}
            >
              {cameraLabel(c)} ({c.vesselName})
              {isCameraDestroyed(c) ? " — signal lost" : ""}
            </CameraMenuItem>
          ))}
        </CameraMenu>
      )}

      {showDebugInfo &&
        (camera ? (
          <TopMeta>
            {camera.vesselName} · {camera.renderWidth}×{camera.renderHeight}
            {bitrateLabel}
            {adaptiveLabel}
          </TopMeta>
        ) : (
          <TopMeta>no cameras on this vessel</TopMeta>
        ))}
    </TopOverlay>
  );

  return (
    <Stage ref={wrapRef} $pinned={chromePinned}>
      {flightId === null ? (
        <>
          <Empty>
            No camera feeds — start a vessel with Hullcam parts installed
          </Empty>
          {topOverlay}
        </>
      ) : (
        <>
          {/* Tapping the feed pins/unpins the chrome on touch (no hover). */}
          <StyledVideo
            ref={videoRef}
            autoPlay
            playsInline
            muted
            controls={false}
            onClick={() => setChromePinned((v) => !v)}
          />
          {topOverlay}
          {isDestroyed && (
            <SignalLostOverlay role="status" aria-label="Signal lost">
              <SignalLostText>SIGNAL LOST</SignalLostText>
            </SignalLostOverlay>
          )}
          {showZoom && (
            // One integrated zoom control (Google-Maps style): + button, a
            // vertical slider, − button — visually joined into a single rod.
            // BUTTONS hold a constant zoom velocity (press = steady linear
            // zoom, release = stop; +rate = zoom in). SLIDER declares a precise
            // absolute FoV across the camera's full range, debounced so only
            // the settled value is sent. Keyboard activation of a button does a
            // discrete step (can't "hold" a keypress). Top of the slider /
            // the + button are zoomed-in (narrow FoV).
            <ZoomControlsWrap>
              <ZoomButton
                type="button"
                aria-label="Zoom in"
                $pos="top"
                onPointerDown={() => sendZoomRate(1)}
                onPointerUp={() => sendZoomRate(0)}
                onPointerLeave={() => sendZoomRate(0)}
                onPointerCancel={() => sendZoomRate(0)}
                onClick={(e) => {
                  if (e.detail === 0) nudgeZoom(-1); // keyboard: one step in
                }}
              >
                +
              </ZoomButton>
              <FovSlider
                type="range"
                aria-label="Zoom"
                min={camera.fovMin}
                max={camera.fovMax}
                step={0.5}
                value={sliderFov}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSliderFov(v); // optimistic thumb
                  scheduleFovSlider(v); // send the settled value
                }}
                onPointerDown={() => {
                  fovSliderDraggingRef.current = true;
                }}
                onPointerUp={() => {
                  fovSliderDraggingRef.current = false;
                  flushFovSlider(); // commit immediately on release
                }}
                onPointerCancel={() => {
                  fovSliderDraggingRef.current = false;
                  flushFovSlider();
                }}
              />
              <ZoomButton
                type="button"
                aria-label="Zoom out"
                $pos="bottom"
                onPointerDown={() => sendZoomRate(-1)}
                onPointerUp={() => sendZoomRate(0)}
                onPointerLeave={() => sendZoomRate(0)}
                onPointerCancel={() => sendZoomRate(0)}
                onClick={(e) => {
                  if (e.detail === 0) nudgeZoom(1); // keyboard: one step out
                }}
              >
                −
              </ZoomButton>
            </ZoomControlsWrap>
          )}
          {showPan && (
            <PanControl role="group" aria-label="Pan camera">
              {/* Arrows are discrete single steps — one click = one unit. */}
              <PanArrow
                type="button"
                $dir="up"
                aria-label="Pan up"
                disabled={!supportsPitch}
                onClick={() => nudgePan(0, 1)}
              >
                ▲
              </PanArrow>
              <PanArrow
                type="button"
                $dir="down"
                aria-label="Pan down"
                disabled={!supportsPitch}
                onClick={() => nudgePan(0, -1)}
              >
                ▼
              </PanArrow>
              <PanArrow
                type="button"
                $dir="left"
                aria-label="Pan left"
                onClick={() => nudgePan(-1, 0)}
              >
                ◀
              </PanArrow>
              <PanArrow
                type="button"
                $dir="right"
                aria-label="Pan right"
                onClick={() => nudgePan(1, 0)}
              >
                ▶
              </PanArrow>
              <PanBall
                aria-hidden="true"
                title="Drag to pan"
                onPointerDown={handleBallDown}
                onPointerMove={handleBallMove}
                onPointerUp={handleBallUp}
                onPointerCancel={handleBallUp}
                style={{
                  transform: `translate(${ballPos.x}px, ${ballPos.y}px)`,
                }}
              />
            </PanControl>
          )}
        </>
      )}
    </Stage>
  );
}

// ZoomControlsWrap and PanControl defined BEFORE VideoWrap so VideoWrap
// can reference them in hover/focus-within selectors.

// Pan directional pad — four bare arrow glyphs around a small draggable rate
// ball. A dark drop-shadow (not a box) keeps the white glyphs + ball legible
// over a bright frame. Revealed on hover/focus like the zoom control.
const PanControl = styled.div`
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 52px;
  height: 52px;
  opacity: 0;
  transition: opacity 0.15s;
  touch-action: none;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const PanArrow = styled.button<{ $dir: "up" | "down" | "left" | "right" }>`
  position: absolute;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 11px;
  line-height: 1;
  color: #fff;
  opacity: 0.5;
  background: none;
  border: none;
  cursor: pointer;
  touch-action: none;
  /* Dark halo keeps the white glyph legible over a bright frame, no box. */
  text-shadow:
    0 0 3px rgba(0, 0, 0, 0.9),
    0 1px 2px rgba(0, 0, 0, 0.8);

  ${(p) =>
    p.$dir === "up"
      ? "top: 0; left: 50%; transform: translateX(-50%);"
      : p.$dir === "down"
        ? "bottom: 0; left: 50%; transform: translateX(-50%);"
        : p.$dir === "left"
          ? "left: 0; top: 50%; transform: translateY(-50%);"
          : "right: 0; top: 50%; transform: translateY(-50%);"}

  @media (hover: hover) {
    &:hover:not(:disabled) {
      opacity: 1;
      color: #00ff88;
    }
  }
  &:disabled {
    opacity: 0.3;
    cursor: default;
  }
  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: 2px;
  }
`;

const PanBall = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffffff, #d6dbe1);
  /* Thin dark ring for contrast over a bright frame + a faint glow over dark. */
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.5),
    0 0 4px rgba(255, 255, 255, 0.4);
  cursor: grab;
  touch-action: none;

  &:active {
    cursor: grabbing;
  }
`;

// Map-style zoom: a compact +/- stack tucked into the bottom-left corner,
// revealed on hover/focus like the pan pad — not a slider across the stream.
// One integrated rod: + button, slider, − button joined with no gaps, a single
// square-cornered dark container with a thin white border. White (not green)
// accents throughout so it reads as one map-style zoom control.
const ZoomControlsWrap = styled.div`
  position: absolute;
  bottom: 8px;
  left: 8px;
  width: 30px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.5);
  opacity: 0;
  transition: opacity 0.15s;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

// Square, borderless +/− glyphs that share a thin divider with the slider so the
// three pieces read as one rod. White glyph, subtle white hover wash.
const ZoomButton = styled(IconButton)<{ $pos: "top" | "bottom" }>`
  width: 100%;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  color: #fff;
  font-size: 1rem;
  ${(p) =>
    p.$pos === "top"
      ? "border-bottom: 1px solid rgba(255, 255, 255, 0.3);"
      : "border-top: 1px solid rgba(255, 255, 255, 0.3);"}

  @media (hover: hover) {
    &:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.15);
    }
  }

  &:focus-visible {
    outline: 2px solid #fff;
    outline-offset: -2px;
  }
`;

// Top overlay — title + metadata + camera picker, floated over the feed and
// hidden until revealed. Defined before Stage so Stage can target it.
const TopOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px 14px;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0));
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

// Title row: the menu-trigger title on the left, the Next/Prev step buttons
// floated to the upper-right corner.
const TitleRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
`;

const TopTitle = styled.h3`
  margin: 0;
  min-width: 0;
  font-size: var(--font-size-xs, 11px);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
`;

// The title rendered as the dropdown trigger: camera name + a chevron. Bare
// (no box) so it reads as the heading text, with a clear focus ring.
const TitleButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  margin: 0;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  text-shadow: inherit;
  text-align: left;

  svg {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    transition: transform 0.15s;
  }

  &[aria-expanded="true"] svg {
    transform: rotate(180deg);
  }

  @media (prefers-reduced-motion: reduce) {
    svg {
      transition: none;
    }
  }

  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: 2px;
  }
`;

const TitleButton__Text = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

// Next/Prev step buttons, floated to the upper-right corner of the overlay.
const StepButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
`;

// Dropdown menu of selectable cameras + the debug toggle, anchored under the
// title. Dark wash to stay legible over a bright frame.
const CameraMenu = styled.div`
  margin-top: 4px;
  max-width: 260px;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  overflow: hidden;
`;

const CameraMenuItem = styled.button<{ $selected: boolean }>`
  display: block;
  width: 100%;
  padding: 6px 8px;
  text-align: left;
  background: ${(p) => (p.$selected ? "rgba(0, 255, 136, 0.15)" : "transparent")};
  border: none;
  cursor: pointer;
  color: #fff;
  font-size: 11px;
  letter-spacing: 0.04em;

  @media (hover: hover) {
    &:hover {
      background: rgba(255, 255, 255, 0.15);
    }
  }

  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: -2px;
  }
`;

const TopMeta = styled.div`
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.78);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
`;

// Full-bleed video stage: the feed fills the whole widget; every piece of chrome
// (the top overlay + the zoom/pan controls) floats on top and stays hidden until
// the operator hovers (desktop) or taps to pin ($pinned, for touch). Reuses
// Panel for the widget frame but drops its padding/gap so nothing steals
// vertical space from the feed.
const Stage = styled(Panel)<{ $pinned: boolean }>`
  padding: 0;
  gap: 0;
  position: relative;
  background: #000;
  align-items: center;
  justify-content: center;

  &:hover ${TopOverlay},
  &:focus-within ${TopOverlay},
  &:hover ${ZoomControlsWrap},
  &:focus-within ${ZoomControlsWrap},
  &:hover ${PanControl},
  &:focus-within ${PanControl} {
    opacity: 1;
  }
  &:hover ${TopOverlay},
  &:focus-within ${TopOverlay} {
    pointer-events: auto;
  }

  ${(p) =>
    p.$pinned &&
    css`
      ${TopOverlay} {
        opacity: 1;
        pointer-events: auto;
      }
      ${ZoomControlsWrap},
      ${PanControl} {
        opacity: 1;
      }
    `}
`;

const Empty = styled.div`
  color: #888;
  font-size: 13px;
  font-style: italic;
  padding: 1rem;
  text-align: center;
`;

// IconButton restyled for legibility over the video (dark wash, white glyph).
const OverlayIconButton = styled(IconButton)`
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 3px;
  color: #fff;

  &:disabled {
    opacity: 0.4;
  }
`;

const StyledVideo = styled.video`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
`;

/**
 * Full-frame overlay shown when the sidecar reports `lifecycle: "destroyed"`.
 * The kerbcam SDK keeps the camera's noise pipeline alive when a part is
 * destroyed, driving it to full static on the same `mediaStream`, so the video
 * element behind this overlay shows live signal-loss static rather than a
 * frozen last frame. The "SIGNAL LOST" label sits over that static behind a
 * light scrim for legibility.
 */
const SignalLostOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.25);
`;

const SignalLostText = styled.span`
  color: #ff4444;
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  text-shadow:
    0 0 8px rgba(255, 68, 68, 0.7),
    0 1px 2px rgba(0, 0, 0, 0.9);

  /* Suppress the pulse animation when the user prefers reduced motion. */
  @media (prefers-reduced-motion: no-preference) {
    animation: signal-lost-pulse 2s ease-in-out infinite;
  }

  @keyframes signal-lost-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }
`;

// ── Range sliders (pan yaw / pitch / zoom) ──────────────────────────────────
// Rendered below the video — not overlaid — so the operator can see both the
// slider position and the live feed at once. Each row shows: label · min
// bound · slider · max bound · current numeric value. The slider is a native
// <input type="range"> (role="slider") for keyboard accessibility and easy
// querying in tests. Styled to match the widget's dark/compact aesthetic.

// Vertical zoom slider, flush between the +/− buttons so the three form one rod.
// `writing-mode: vertical-lr` orients the native range input vertically; min
// (narrow FoV / zoomed in) at the top by the +, max (wide / zoomed out) at the
// bottom by the −. If a browser renders the ends flipped, that's a one-line
// `direction: rtl` toggle. White accent to match the buttons.
const FovSlider = styled.input`
  writing-mode: vertical-lr;
  width: 100%;
  height: 54px;
  margin: 0;
  padding: 3px 0;
  cursor: pointer;
  accent-color: #fff;

  &:focus-visible {
    outline: 2px solid #fff;
    outline-offset: -2px;
  }
`;
