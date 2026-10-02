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
