/** Why a running countdown stopped, as the station concerned and what it did. */
export interface CountdownHold {
  cause: "dropped" | "no-go" | "withdrawn" | "reset" | "launch";
  /** The station that caused it; absent for a reset and a launch. */
  station?: string;
}

/** What the poll last did that every screen shows until the next countdown starts or the poll is reset. */
export type GoNoGoNotice =
  | ({ kind: "held" } & CountdownHold)
  | {
      kind: "outcome";
      /** The display name of the action fired at T-0, or `null` when nothing fires. */
      action: string | null;
      sent: boolean;
    };

const HOLD_TEXT: Record<CountdownHold["cause"], string> = {
  dropped: "dropped",
  "no-go": "voted NO-GO",
  withdrawn: "withdrew GO",
  reset: "reset",
  launch: "launch detected",
};

/** The one line a screen draws for a notice. */
export function noticeLabel(notice: GoNoGoNotice): string {
  if (notice.kind === "outcome") {
    if (notice.action === null) return "T-0: no action";
    return `${notice.action} ${notice.sent ? "sent" : "not sent"}`;
  }
  const what = HOLD_TEXT[notice.cause];
  return notice.station ? `Held: ${notice.station} ${what}` : `Held: ${what}`;
}
