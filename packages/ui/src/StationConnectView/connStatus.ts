/** Connection lifecycle states on the connect screen, mirroring PeerClientService's `ConnStatus` as a plain union so the view imports nothing from the peer layer. */
export type StationConnStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export function describeConnStatus(
  status: StationConnStatus,
  hostNotFound: boolean,
  everConnected: boolean,
  brokerUnreachable = false,
): string {
  // Ranked above hostNotFound: a station that never reached the broker learned nothing about the host.
  if (brokerUnreachable) {
    return "Can't reach the peer broker: this device needs internet access.";
  }
  if (hostNotFound) {
    return everConnected
      ? "Host reconnecting: waiting for the main screen to come back..."
      : "Broker doesn't know that code. Retrying in case it comes back...";
  }
  switch (status) {
    case "idle":
      return "Waiting for a host ID.";
    case "connecting":
      return "Reaching the broker and opening a peer channel...";
    case "connected":
      return "Connected.";
    case "reconnecting":
      return "Reconnecting: the host or broker may be briefly unavailable.";
    case "disconnected":
      return "No connection. Use Download logs if this persists.";
  }
}

export function statusTone(
  status: StationConnStatus,
  hostNotFound: boolean,
  everConnected: boolean,
  brokerUnreachable = false,
): "neutral" | "info" | "go" | "nogo" {
  if (brokerUnreachable) return "nogo";
  // A reclaim window after a prior connection is transient info, not the hard nogo of a wrong code.
  if (hostNotFound) return everConnected ? "info" : "nogo";
  switch (status) {
    case "idle":
      return "neutral";
    case "connecting":
    case "reconnecting":
      return "info";
    case "connected":
      return "go";
    case "disconnected":
      return "nogo";
  }
}

/** The steps of one connect attempt, in the order they complete. */
export type ConnectStage = "broker" | "host" | "data";

/** Facts about the connect in flight; `entered` holds the epoch ms each stage began during the current attempt. */
export interface ConnectProgress {
  startedAt: number;
  attempt: number;
  entered: Partial<Record<ConnectStage, number>>;
}

/** Time without a connection after which the connect screen reports a stall rather than waiting. */
export const CONNECT_STALL_MS = 30_000;

export const CONNECT_STAGES: ReadonlyArray<{
  stage: ConnectStage;
  label: string;
}> = [
  { stage: "broker", label: "Broker" },
  { stage: "host", label: "Host channel" },
  { stage: "data", label: "Host data" },
];

export type StageState = "done" | "active" | "pending";

/** The state of every stage given which one the attempt has reached. */
export function stageStates(
  progress: ConnectProgress,
): Array<{ stage: ConnectStage; label: string; state: StageState }> {
  const reached = CONNECT_STAGES.filter(
    ({ stage }) => progress.entered[stage] !== undefined,
  ).length;
  return CONNECT_STAGES.map(({ stage, label }, i) => ({
    stage,
    label,
    state: i < reached - 1 ? "done" : i === reached - 1 ? "active" : "pending",
  }));
}

/** Seconds with one decimal under ten, whole above. */
export function formatSeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
}
