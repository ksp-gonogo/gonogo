import { Button, MissionDate, Text } from "@ksp-gonogo/ui-kit";
import type { CommcastLog } from "./CommcastLog";
import {
  Author,
  Commcast__Actions,
  Commcast__Body,
  Commcast__Message,
  Commcast__Meta,
} from "./commcastStyles";
import { messageText } from "./groups";
import {
  firstAckUtFor,
  revealedAcks,
  revealUtFor,
  type SeparationMatrix,
  sentPhaseFor,
  separationFor,
  type Vantage,
} from "./reveal";
import type { OutboundMessage, RecipientId } from "./types";
import type { CommcastEntry } from "./useCommcastFeed";

/** One message in this vantage's log: something heard, or something settled. */
export function CommcastMessageRow({
  entry,
  me,
  utNow,
  pairs,
  log,
  nameFor,
  separationSeconds,
}: {
  entry: CommcastEntry;
  me: Vantage;
  utNow: number | undefined;
  pairs: SeparationMatrix | undefined;
  log: CommcastLog;
  nameFor: (id: RecipientId) => string;
  separationSeconds: number | null;
}) {
  const { msg, out } = entry;
  return (
    <Commcast__Message>
      <Commcast__Meta>
        <Author $pilot={msg.authorSeat === "pilot"}>{msg.authorName}</Author>
        {out ? (
          <SentVerdict out={out} me={me} utNow={utNow} pairs={pairs} />
        ) : (
          <HeardVerdict msg={msg} me={me} pairs={pairs} />
        )}
      </Commcast__Meta>
      <Commcast__Body $change={msg.kind === "members"}>
        {messageText(msg, nameFor)}
      </Commcast__Body>
      {out && (
        <UnconfirmedActions
          out={out}
          me={me}
          utNow={utNow}
          pairs={pairs}
          log={log}
          separationSeconds={separationSeconds}
        />
      )}
    </Commcast__Message>
  );
}

/** When something arrived HERE: every stamp in the log is an instant at this vantage, so they compare down a column. */
function HeardVerdict({
  msg,
  me,
  pairs,
}: {
  msg: CommcastEntry["msg"];
  me: Vantage;
  pairs: SeparationMatrix | undefined;
}) {
  const at = revealUtFor(msg, me, pairs);
  const sep = separationFor(msg, me, pairs);
  return (
    <>
      {at !== null && (
        <Text size="xs" tone="faint">
          <MissionDate value={at} />
        </Text>
      )}
      {sep.kind === "unmeasured" && (
        <Text size="xs" tone="warn">
          separation unpublished
        </Text>
      )}
    </>
  );
}

/**
 * What came back about something this screen said. Acknowledged shows the
 * instant the confirmation landed here; anything else is unconfirmed, a state
 * rather than an error, split into nothing came back and nothing left.
 */
function SentVerdict({
  out,
  me,
  utNow,
  pairs,
}: {
  out: OutboundMessage;
  me: Vantage;
  utNow: number | undefined;
  pairs: SeparationMatrix | undefined;
}) {
  const now = utNow ?? Number.NEGATIVE_INFINITY;
  const phase = sentPhaseFor(out, me, now, pairs);
  if (phase === "confirmed") {
    const heard = revealedAcks(out, me, now, pairs).length;
    const ackUt = firstAckUtFor(out, me, pairs);
    return (
      <>
        {ackUt !== undefined && (
          <Text size="xs" tone="faint">
            <MissionDate value={ackUt} />
          </Text>
        )}
        {/* Two stations at one centre both answer a message addressed to it. */}
        {heard > 1 && (
          <Text size="xs" tone="faint">
            heard by {heard}
          </Text>
        )}
      </>
    );
  }
  return (
    <>
      <Text size="xs" tone="faint">
        {out.neverLeft ? "never left, no path" : "unconfirmed"}
      </Text>
      {out.msg.attempts > 1 && (
        <Text size="xs" tone="faint">
          attempt {out.msg.attempts}
        </Text>
      )}
    </>
  );
}

/** An unconfirmed message's one action; the recipient dedupes on the message id, so a resend also answers whether it arrived. */
function UnconfirmedActions({
  out,
  me,
  utNow,
  pairs,
  log,
  separationSeconds,
}: {
  out: OutboundMessage;
  me: Vantage;
  utNow: number | undefined;
  pairs: SeparationMatrix | undefined;
  log: CommcastLog;
  separationSeconds: number | null;
}) {
  const phase = sentPhaseFor(out, me, utNow ?? Number.NEGATIVE_INFINITY, pairs);
  if (phase === "confirmed") return null;
  const ready = utNow !== undefined && separationSeconds !== null;
  return (
    <Commcast__Actions>
      <Button
        type="button"
        disabled={!ready}
        onClick={() => {
          if (utNow === undefined) return;
          log.resend(out.msg.id, utNow, separationSeconds);
        }}
      >
        {separationSeconds === null ? "No path to resend" : "Send again"}
      </Button>
    </Commcast__Actions>
  );
}
