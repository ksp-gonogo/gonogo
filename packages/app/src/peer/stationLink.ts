/**
 * One connection between the main screen and a station, from either end:
 * a PeerJS data connection when the two join directly, or a link through
 * the relay's endpoint. Messages are the peer protocol's, packed the same
 * way on both paths.
 */
export interface StationLink {
  /** The broker peer id of the other end. */
  readonly peer: string;
  readonly open: boolean;
  send(data: unknown): void;
  /** `flush` lets messages already sent reach the other end first. */
  close(options?: { flush?: boolean }): void;
  on(event: "open" | "close", cb: () => void): unknown;
  on(event: "data", cb: (data: unknown) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
}
