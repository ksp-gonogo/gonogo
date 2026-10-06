import {
  Button,
  CheckIcon,
  HeldFigure,
  HistoryIcon,
  HoverCard,
  InfoIcon,
  MissionDate,
  Stack,
  Text,
} from "@ksp-gonogo/ui-kit";
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
  deliveryAckUtFor,
  deliveryPhaseFor,
  heardUtOf,
  isSettled,
  type MessageStatus,
  messageStatusFor,
} from "./reveal";
import type { Delivery, OutboundMessage, RecipientId } from "./types";
import type { CommcastEntry } from "./useCommcastFeed";

/** One message in this vantage's log: something heard, or something settled. */
export function CommcastMessageRow({
  entry,
  utNow,
  log,
  nameFor,
  separations,
}: {
  entry: CommcastEntry;
  utNow: number | undefined;
  log: CommcastLog;
  nameFor: (id: RecipientId) => string;
  separations: ReadonlyMap<RecipientId, number | null>;
}) {
  const { msg, out } = entry;
  return (
    <Commcast__Message>
      <Commcast__Meta>
        <Author $pilot={msg.authorSeat === "pilot"}>{msg.authorName}</Author>
        {out ? (
          <SentVerdict out={out} utNow={utNow} nameFor={nameFor} />
        ) : (
          <HeardVerdict msg={msg} />
        )}
      </Commcast__Meta>
      <Commcast__Body $change={msg.kind === "members"}>
        {messageText(msg, nameFor)}
      </Commcast__Body>
      {out && (
        <UnconfirmedActions
          out={out}
          utNow={utNow}
          log={log}
          nameFor={nameFor}
          separations={separations}
        />
      )}
    </Commcast__Message>
  );
}

/** When something arrived HERE: every stamp in the log is an instant at this vantage, so they compare down a column. */
function HeardVerdict({ msg }: { msg: CommcastEntry["msg"] }) {
  return (
    <Text size="xs" level="faint">
      <MissionDate value={heardUtOf(msg)} />
    </Text>
  );
}

const STATUS_ICON = {
  received: CheckIcon,
  "in-transit": HistoryIcon,
  unconfirmed: InfoIcon,
} as const;

const STATUS_LABEL: Record<MessageStatus, string> = {
  received: "Received by everyone",
  "in-transit": "In transit",
  unconfirmed: "Unconfirmed",
};

/**
 * What came back about something this screen said, as one verdict for the
 * whole send; hovering lists every recipient. Unconfirmed is a state rather
 * than an error.
 */
function SentVerdict({
  out,
  utNow,
  nameFor,
}: {
  out: OutboundMessage;
  utNow: number | undefined;
  nameFor: (id: RecipientId) => string;
}) {
  const now = utNow ?? Number.NEGATIVE_INFINITY;
  const status = messageStatusFor(out, now);
  const Icon = STATUS_ICON[status];
  const answeredUt = lastAnswerUt(out, now);
  return (
    <>
      {status === "received" && answeredUt !== undefined && (
        <Text size="xs" level="faint">
          <MissionDate value={answeredUt} />
        </Text>
      )}
      <HoverCard
        ariaLabel={STATUS_LABEL[status]}
        trigger={<Icon size="var(--icon-size-control)" aria-hidden="true" />}
      >
        <Stack as="ul">
          {out.deliveries.map((delivery) => (
            <li key={delivery.to}>
              <RecipientState
                delivery={delivery}
                out={out}
                now={now}
                name={nameFor(delivery.to)}
              />
            </li>
          ))}
        </Stack>
      </HoverCard>
      {out.msg.attempts > 1 && (
        <Text size="xs" level="faint">
          attempt {out.msg.attempts}
        </Text>
      )}
    </>
  );
}

/** When the last recipient's answer reached here, once every recipient has answered. */
function lastAnswerUt(out: OutboundMessage, now: number): number | undefined {
  let latest: number | undefined;
  for (const delivery of out.deliveries) {
    const ut = deliveryAckUtFor(out, delivery);
    if (ut === undefined || ut > now) return undefined;
    if (latest === undefined || ut > latest) latest = ut;
  }
  return latest;
}

/**
 * One recipient in the hover list. An answer and a missing path are heard or
 * known; "on the way" and "not received" are worked out from the frozen
 * separation, so they carry the modelled mark.
 */
function RecipientState({
  delivery,
  out,
  now,
  name,
}: {
  delivery: Delivery;
  out: OutboundMessage;
  now: number;
  name: string;
}) {
  const phase = deliveryPhaseFor(out, delivery, now);
  const state =
    phase === "confirmed"
      ? "received"
      : delivery.neverLeft
        ? "never left, no path"
        : isSettled(phase)
          ? "not received"
          : "on the way";
  const modelled = phase !== "confirmed" && !delivery.neverLeft;
  return (
    <Text size="xs">
      {name}{" "}
      {modelled ? (
        <HeldFigure kind="modelled" caption="modelled">
          {state}
        </HeldFigure>
      ) : (
        state
      )}
    </Text>
  );
}

/** Send again, once per recipient whose wait is over without an answer; the recipient dedupes on the message id, so a resend also answers whether it arrived. */
function UnconfirmedActions({
  out,
  utNow,
  log,
  nameFor,
  separations,
}: {
  out: OutboundMessage;
  utNow: number | undefined;
  log: CommcastLog;
  nameFor: (id: RecipientId) => string;
  separations: ReadonlyMap<RecipientId, number | null>;
}) {
  const now = utNow ?? Number.NEGATIVE_INFINITY;
  const waiting = out.deliveries.filter((d) => {
    const phase = deliveryPhaseFor(out, d, now);
    return phase !== "confirmed" && isSettled(phase);
  });
  if (waiting.length === 0) return null;
  const several = out.deliveries.length > 1;
  return (
    <Commcast__Actions>
      {waiting.map((delivery) => {
        const separation = separations.get(delivery.to) ?? null;
        const noPath = separation === null;
        const name = several ? ` to ${nameFor(delivery.to)}` : "";
        return (
          <Button
            key={delivery.to}
            type="button"
            disabled={utNow === undefined || noPath}
            onClick={() => {
              if (utNow === undefined) return;
              log.resend(out.msg.id, [delivery.to], utNow, separations);
            }}
          >
            {noPath ? `No path to resend${name}` : `Send again${name}`}
          </Button>
        );
      })}
    </Commcast__Actions>
  );
}
