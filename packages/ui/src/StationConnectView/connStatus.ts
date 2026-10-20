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
      return "Reaching the main screen...";
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
  /** The direct path never opened and the station is now trying through the relay. */
  viaRelay?: boolean;
  /** The open connection is carried by the relay. */
  relayed?: boolean;
  entered: Partial<Record<ConnectStage, number>>;
}

/** Time without a connection after which the connect screen reports a stall rather than waiting. */
export const CONNECT_STALL_MS = 30_000;

/** Time in the main-screen stage after which a direct attempt is reported as failing, matching when the main screen starts offering the relay. */
export const DIRECT_PATH_GRACE_MS = 6_000;

/**
 * The one-line plain-words stage of a connect that may fall back to the relay,
 * or null when nothing beyond the generic status applies.
 */
export function describeRelayStage(
  status: StationConnStatus,
  progress: ConnectProgress | undefined,
  now: number,
  relayAvailable: boolean,
): string | null {
  if (!progress) return null;
  if (status === "connected") {
    return progress.relayed ? "Connected through the relay." : null;
  }
  if (status !== "connecting" && status !== "reconnecting") return null;
  if (progress.viaRelay) return "No direct path, switching to the relay...";
  const began = progress.entered.host;
  if (began === undefined) return null;
  if (relayAvailable && now - began >= DIRECT_PATH_GRACE_MS) {
    return "No direct path yet, switching to the relay...";
  }
  return "Trying a direct connection...";
}

export const CONNECT_STAGES: ReadonlyArray<{
  stage: ConnectStage;
  label: string;
}> = [
  { stage: "broker", label: "Connection service" },
  { stage: "host", label: "Main screen" },
  { stage: "data", label: "Main screen data" },
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
