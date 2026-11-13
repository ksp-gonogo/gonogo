import {
  type HeldCommand,
  heldCommandOf,
  useHeldCommandActions,
  useLatestValue,
} from "@ksp-gonogo/sitrep-sdk/spine";
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
import { type RecipientAbout, recipientWords } from "./recipientWords";
import {
  deliveryAckUtFor,
  deliveryAnswerUtFor,
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
  aboutFor,
}: {
  entry: CommcastEntry;
  utNow: number | undefined;
  log: CommcastLog;
  nameFor: (id: RecipientId) => string;
  separations: ReadonlyMap<RecipientId, number | null>;
  /** What the contact plan and the roster say about a recipient. */
  aboutFor: (id: RecipientId) => RecipientAbout;
}) {
  const { msg, out } = entry;
  return (
    <Commcast__Message>
      <Commcast__Meta>
        <Author $pilot={msg.authorSeat === "pilot"}>{msg.authorName}</Author>
        {out && msg.kind === "members" ? (
          <Text size="xs" level="faint">
            <MissionDate value={msg.sentUt} />
          </Text>
        ) : out ? (
          <SentVerdict
            out={out}
            utNow={utNow}
            nameFor={nameFor}
            aboutFor={aboutFor}
          />
        ) : (
          <HeardVerdict msg={msg} />
        )}
      </Commcast__Meta>
      <Commcast__Body $change={msg.kind === "members"}>
        {messageText(msg, nameFor)}
      </Commcast__Body>
      {out && msg.kind === "text" && (
        <CancelActions out={out} utNow={utNow} nameFor={nameFor} />
      )}
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

/** When something arrived here: every stamp in the log is an instant at this vantage, so they compare down a column. */
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
  "not-sent": InfoIcon,
} as const;

const STATUS_LABEL: Record<MessageStatus, string> = {
  received: "Received by everyone",
  "in-transit": "In transit",
  unconfirmed: "Unconfirmed",
  "not-sent": "Not sent",
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
  aboutFor,
}: {
  out: OutboundMessage;
  utNow: number | undefined;
  nameFor: (id: RecipientId) => string;
  aboutFor: (id: RecipientId) => RecipientAbout;
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
        aria-label={STATUS_LABEL[status]}
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
                about={aboutFor(delivery.to)}
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
    const ut = deliveryAnswerUtFor(out, delivery);
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
  about,
}: {
  delivery: Delivery;
  out: OutboundMessage;
  now: number;
  name: string;
  about: RecipientAbout;
}) {
  const phase = deliveryPhaseFor(out, delivery, now);
  const read = deliveryAckUtFor(out, delivery) !== undefined;
  const state = recipientWords(phase, delivery, about, read);
  // A refusal is the mod's own word, not a worked-out state, so it carries no mark and wraps like any sentence.
  const modelled =
    phase !== "confirmed" &&
    !delivery.neverLeft &&
    !delivery.refused &&
    !delivery.queued;
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

/**
 * Withdraw a message that has not yet reached a recipient, from the thread it
 * was said in: it is the same cancel the uplink queue offers for any command,
 * addressed through the queue's own entry for that recipient's copy.
 */
/** A message of this screen's own still crossing or waiting, drawn as the controls that cancel it, since nothing has arrived to make a row of yet; its words are in the queue below. */
export function CrossingMessage({
  out,
  utNow,
  nameFor,
}: {
  out: OutboundMessage;
  utNow: number | undefined;
  nameFor: (id: RecipientId) => string;
}) {
  return <CancelActions out={out} utNow={utNow} nameFor={nameFor} />;
}

function CancelActions({
  out,
  utNow,
  nameFor,
}: {
  out: OutboundMessage;
  utNow: number | undefined;
  nameFor: (id: RecipientId) => string;
}) {
  const queue = useLatestValue<unknown>("system.uplink.pending");
  const actions = useHeldCommandActions();
  const now = utNow ?? Number.NEGATIVE_INFINITY;
  const heldFor = (to: RecipientId): HeldCommand | undefined => {
    const entries =
      typeof queue === "object" &&
      queue !== null &&
      "pending" in queue &&
      Array.isArray(queue.pending)
        ? queue.pending
        : [];
    for (const entry of entries) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        "craft" in entry &&
        entry.craft === to &&
        "label" in entry &&
        entry.label === out.msg.body
      ) {
        return heldCommandOf(entry);
      }
    }
    return undefined;
  };
  const cancellable = out.deliveries.filter((d) => {
    if (d.delivered || d.refused) return false;
    const phase = deliveryPhaseFor(out, d, now);
    return (phase === "in-transit" || d.queued === true) && heldFor(d.to);
  });
  if (cancellable.length === 0) return null;
  const several = out.deliveries.length > 1;
  return (
    <Commcast__Actions>
      {cancellable.map((delivery) => {
        const held = heldFor(delivery.to);
        const name = several ? ` to ${nameFor(delivery.to)}` : "";
        return (
          <Button
            key={delivery.to}
            type="button"
            onClick={() => {
              if (held) void actions.cancel(held, false);
            }}
          >
            {`Cancel${name}`}
          </Button>
        );
      })}
    </Commcast__Actions>
  );
}
