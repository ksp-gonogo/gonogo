import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
  DataSourceStatus,
} from "@gonogo/core";
import {
  registerComponent,
  useActionInput,
  useStream,
  useStreamList,
} from "@gonogo/core";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Panel,
  Placeholder,
  PrimaryButton,
  Select,
} from "@gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

type CameraFeedConfig = {
  mode?: "single" | "cycle";
  /** Camera id for single mode. Empty / undefined → first available. */
  cameraId?: string;
  /** Dwell time per camera in cycle mode (ms). */
  cycleIntervalMs?: number;
  /** Show camera name + status dot + mode badge. Default on. */
  showOverlay?: boolean;
  /** Show speed + altitude chips over the video. Default off. */
  showMetadata?: boolean;
};

// The ocisly stream source puts these on StreamInfo.metadata when the proxy
// forwards them. All three can be absent before the first metadata frame.
type OcislyCameraMeta = {
  cameraName?: string;
  speed?: string;
  altitude?: string;
};

const DEFAULT_CYCLE_MS = 5000;

const cameraFeedActions = [
  {
    id: "nextCamera",
    label: "Next camera",
    accepts: ["button"],
    description:
      "Switch to the next camera. In cycle mode advances the rotation; in single mode saves the new camera to the widget config.",
  },
  {
    id: "prevCamera",
    label: "Previous camera",
    accepts: ["button"],
    description: "Switch to the previous camera.",
  },
  {
    id: "pauseCycle",
    label: "Pause cycle",
    accepts: ["button"],
    description: "Pause automatic camera rotation (cycle mode only).",
  },
  {
    id: "resumeCycle",
    label: "Resume cycle",
    accepts: ["button"],
    description: "Resume automatic camera rotation (cycle mode only).",
  },
] as const satisfies readonly ActionDefinition[];

export type CameraFeedActions = typeof cameraFeedActions;

function CameraFeedComponent({
  config,
  onConfigChange,
}: Readonly<ComponentProps<CameraFeedConfig>>) {
  const streams = useStreamList("ocisly");
  const mode = config?.mode ?? "single";
  const showOverlay = config?.showOverlay !== false;
  const showMetadata = config?.showMetadata === true;

  // In cycle mode, rotate through the active camera list; bounded by the
  // current list length so adds/removals don't wedge the index.
  const [cycleIndex, setCycleIndex] = useState(0);
  const [cyclePaused, setCyclePaused] = useState(false);
  useEffect(() => {
    if (mode !== "cycle" || streams.length <= 1 || cyclePaused) return;
    const intervalMs = Math.max(
      1000,
      config?.cycleIntervalMs ?? DEFAULT_CYCLE_MS,
    );
    const id = setInterval(() => {
      setCycleIndex((i) => (i + 1) % Math.max(1, streams.length));
    }, intervalMs);
    return () => clearInterval(id);
  }, [mode, streams.length, config?.cycleIntervalMs, cyclePaused]);

  const selectedId = useMemo(() => {
    if (streams.length === 0) return null;
    if (mode === "cycle") {
      const safeIndex = cycleIndex % streams.length;
      return streams[safeIndex].id;
    }
    return config?.cameraId ?? streams[0].id;
  }, [mode, cycleIndex, streams, config?.cameraId]);

  const { stream, status } = useStream("ocisly", selectedId);
  const selectedStream = streams.find((s) => s.id === selectedId);
  const meta = selectedStream?.metadata as OcislyCameraMeta | undefined;

  const currentIndex = selectedId
    ? streams.findIndex((s) => s.id === selectedId)
    : -1;

  useActionInput<CameraFeedActions>({
    nextCamera: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      if (streams.length === 0) return;
      const base = currentIndex >= 0 ? currentIndex : 0;
      const next = (base + 1) % streams.length;
      if (mode === "cycle") {
        setCycleIndex(next);
      } else {
        onConfigChange?.({ ...config, cameraId: streams[next].id });
      }
    },
    prevCamera: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      if (streams.length === 0) return;
      const base = currentIndex >= 0 ? currentIndex : 0;
      const prev = (base - 1 + streams.length) % streams.length;
      if (mode === "cycle") {
        setCycleIndex(prev);
      } else {
        onConfigChange?.({ ...config, cameraId: streams[prev].id });
      }
    },
    pauseCycle: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      setCyclePaused(true);
    },
    resumeCycle: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      setCyclePaused(false);
    },
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (!stream) return;
    // play() can reject when srcObject is reassigned before the promise
    // resolves (StrictMode double-mount, camera switch). Swallow — a later
    // play() always succeeds; the ones that land are what matter.
    void video.play().catch(() => {});
  }, [stream]);

  if (!selectedId) {
    return (
      <Panel>
        <Placeholder>
          {placeholderText(status, "No cameras active")}
        </Placeholder>
      </Panel>
    );
  }

  const displayName = selectedStream?.name ?? selectedId;
  const modeBadge =
    mode === "cycle"
      ? cyclePaused
        ? `PAUSED ${streams.length}×`
        : `CYCLE ${streams.length}×`
      : null;

  return (
    <Feed>
      <Video ref={videoRef} autoPlay muted playsInline />
      {showOverlay && (
        <Overlay>
          <TopRow>
            <CameraLabel>{displayName}</CameraLabel>
            <RightGroup>
              {modeBadge && <ModeBadge>{modeBadge}</ModeBadge>}
              <StatusDot $status={status} title={status} />
            </RightGroup>
          </TopRow>
          {showMetadata && meta && (meta.speed || meta.altitude) && (
            <BottomRow>
              {meta.speed && (
                <MetaChip>SPD {formatNumber(meta.speed)}</MetaChip>
              )}
              {meta.altitude && (
                <MetaChip>ALT {formatNumber(meta.altitude)}</MetaChip>
              )}
            </BottomRow>
          )}
        </Overlay>
      )}
      {!stream && (
        <Centered>
          <Placeholder>
            {placeholderText(status, `Waiting for ${displayName}…`)}
          </Placeholder>
        </Centered>
      )}
    </Feed>
  );
}

function placeholderText(status: DataSourceStatus, fallback: string): string {
  if (status === "disconnected") return "Proxy disconnected";
  if (status === "error") return "Proxy error";
  if (status === "reconnecting") return "Connecting to proxy…";
  return fallback;
}

function formatNumber(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return n.toFixed(1);
}

function CameraFeedConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<CameraFeedConfig>>) {
  const streams = useStreamList("ocisly");
  const [mode, setMode] = useState<"single" | "cycle">(
    config?.mode ?? "single",
  );
  const [cameraId, setCameraId] = useState(config?.cameraId ?? "");
  const [cycleSeconds, setCycleSeconds] = useState(
    String(Math.round((config?.cycleIntervalMs ?? DEFAULT_CYCLE_MS) / 1000)),
  );
  const [showOverlay, setShowOverlay] = useState(config?.showOverlay !== false);
  const [showMetadata, setShowMetadata] = useState(
    config?.showMetadata === true,
  );

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="camera-mode">Mode</FieldLabel>
        <Select
          id="camera-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as "single" | "cycle")}
        >
          <option value="single">Single camera</option>
          <option value="cycle">Cycle through all</option>
        </Select>
      </Field>

      {mode === "single" && (
        <Field>
          <FieldLabel htmlFor="camera-select">Camera</FieldLabel>
          <Select
            id="camera-select"
            value={cameraId}
            onChange={(e) => setCameraId(e.target.value)}
          >
            <option value="">Auto (first available)</option>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <FieldHint>
            Camera IDs come from the OCISLY server; active cameras appear when
            KSP is running with Hullcams installed.
          </FieldHint>
        </Field>
      )}

      {mode === "cycle" && (
        <Field>
          <FieldLabel htmlFor="cycle-interval">Seconds per camera</FieldLabel>
          <Input
            id="cycle-interval"
            type="number"
            min={1}
            value={cycleSeconds}
            onChange={(e) => setCycleSeconds(e.target.value)}
          />
          <FieldHint>Rotates through every active camera in turn.</FieldHint>
        </Field>
      )}

      <Field>
        <FieldLabel htmlFor="show-overlay">
          <CheckboxRow>
            <input
              id="show-overlay"
              type="checkbox"
              checked={showOverlay}
              onChange={(e) => setShowOverlay(e.target.checked)}
            />
            <span>Show overlay (camera name + status)</span>
          </CheckboxRow>
        </FieldLabel>
      </Field>

      <Field>
        <FieldLabel htmlFor="show-metadata">
          <CheckboxRow>
            <input
              id="show-metadata"
              type="checkbox"
              checked={showMetadata}
              onChange={(e) => setShowMetadata(e.target.checked)}
            />
            <span>Show telemetry chips (SPD / ALT)</span>
          </CheckboxRow>
        </FieldLabel>
      </Field>

      <PrimaryButton
        onClick={() => {
          const seconds = Math.max(1, Number(cycleSeconds) || 5);
          onSave({
            mode,
            cameraId: mode === "single" ? cameraId || undefined : undefined,
            cycleIntervalMs: seconds * 1000,
            showOverlay,
            showMetadata,
          });
        }}
      >
        Save
      </PrimaryButton>
    </ConfigForm>
  );
}

registerComponent<CameraFeedConfig>({
  id: "camera-feed",
  name: "Camera Feed",
  description: "Live video from an OCISLY Hullcam, streamed via the proxy.",
  tags: ["camera", "telemetry"],
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 4, h: 3 },
  component: CameraFeedComponent,
  configComponent: CameraFeedConfigComponent,
  defaultConfig: { mode: "single", showOverlay: true, showMetadata: false },
  actions: cameraFeedActions,
  // Mobile: 6 * ROW_HEIGHT (150 px) was rendering at ~2:0.5 aspect on
  // portrait phones — far flatter than a hullcam's natural 16:9. 240 px
  // at ~360 px full-mobile width gives ~3:2, a reasonable balance of
  // visible area + vertical room for the dashboard below.
  mobileHeight: 240,
});

export { CameraFeedComponent };

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const Feed = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--color-text-inverse);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Video = styled.video`
  width: 100%;
  height: 100%;
  object-fit: contain;
`;

const Overlay = styled.div`
  position: absolute;
  inset: 6px 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  pointer-events: none;
`;

const TopRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const RightGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const BottomRow = styled.div`
  display: flex;
  gap: 6px;
  align-self: flex-start;
`;

const CameraLabel = styled.span`
  font-size: 11px;
  color: var(--color-text-primary);
  background: rgba(0, 0, 0, 0.6);
  padding: 2px 6px;
  letter-spacing: 0.05em;
`;

const ModeBadge = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-status-info-fg);
  background: rgba(0, 0, 0, 0.6);
  padding: 2px 6px;
  letter-spacing: 0.1em;
`;

const MetaChip = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  background: rgba(0, 0, 0, 0.65);
  padding: 2px 6px;
  letter-spacing: 0.05em;
`;

const StatusDot = styled.span<{ $status: DataSourceStatus }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $status }) =>
    $status === "connected"
      ? "var(--color-accent-fg)"
      : $status === "reconnecting"
        ? "var(--color-status-warning-bg)"
        : $status === "error"
          ? "var(--color-status-nogo-bg)"
          : "var(--color-text-faint)"};
`;

const Centered = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const CheckboxRow = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
`;
