import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import type { CommsLink } from "@ksp-gonogo/sitrep-sdk";
import { observedValue } from "@ksp-gonogo/sitrep-sdk";
import { useLatestValue, useUtNow } from "@ksp-gonogo/sitrep-sdk/spine";
import { Badge, EmptyState, Panel, Section, Text } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { StationNameEditor, useStationNameOptional } from "../stationIdentity";
import { CommcastComposeView } from "./CommcastComposeView";
import {
  CommcastProvider,
  useCommcastLog,
  useLocalParticipant,
  useMyVantage,
  useRecipients,
  useSeparationMatrix,
} from "./CommcastContext";
import { CommcastInboxView } from "./CommcastInboxView";
import { CommcastThreadView } from "./CommcastThreadView";
import { Commcast__Frame, Commcast__Identity } from "./commcastStyles";
import { RadioIndicator } from "./radio/RadioIndicator";
import { useRadio } from "./radio/useRadio";
import { type Separation, separationBetween } from "./reveal";
import { threadFor, threadsOf } from "./threads";
import type { RecipientId } from "./types";
import { useCommcastFeed } from "./useCommcastFeed";
import { useDroppedCount } from "./useDroppedCount";

/** Which of the widget's three screens the operator is on: each correspondence is separate, and only its own two ends hold it. */
type CommcastView =
  | { kind: "inbox" }
  /** Choosing who to start a conversation with. */
  | { kind: "compose" }
  /** Inside one conversation, with the ends it is with. */
  | { kind: "thread"; with: readonly RecipientId[] };

function CommcastComponent(_props: Readonly<ComponentProps>) {
  const log = useCommcastLog();
  const named = useStationNameOptional();
  const me = useMyVantage();
  const utNow = useUtNow();
  const pairs = useSeparationMatrix();
  const local = useLocalParticipant();
  const recipients = useRecipients(me);
  const [view, setView] = useState<CommcastView>({ kind: "inbox" });
  const feed = useCommcastFeed(log, me, pairs);
  const dropped = useDroppedCount(log);
  const threads = threadsOf(feed, me);
  /*
   * The craft-to-ground path, standing in for a pair the separation matrix
   * has not reached. Observed only: this number is frozen into a message
   * record that is later read back as what the link WAS.
   */
  const pathHome =
    observedValue(useTelemetry("comms.delay"))?.oneWaySeconds?.magnitude ??
    null;
  /*
   * A confirmed loss of line of sight, and only that: no link data yet reads
   * as connected. Read ungated because `comms.link` already reveals at the
   * light-time horizon, and a second gate would hold a lost link another
   * light-time.
   */
  const noSignal = useLatestValue<CommsLink>("comms.link")?.connected === false;

  // A vantage id is an address; it reaches the screen only when the roster has not named that vantage.
  const nameFor = (id: RecipientId) =>
    recipients.find((r) => r.id === id)?.name ?? id;
  // The one end a message goes to: group delivery is not carried, though the envelope, thread key and reveal all take a list.
  const target = view.kind === "thread" ? (view.with[0] ?? null) : null;
  const separation = separationBetween(
    me.vantageId,
    target ?? undefined,
    pathHome,
    pairs,
  );
  const separationSeconds = secondsOf(separation);
  // On the widget, not in a thread, so it hears every conversation; target and separation are only for transmitting.
  const radio = useRadio({
    log,
    me,
    pairs,
    local,
    target,
    separationSeconds,
  });
  // In every view's bar, because the transmission may be on a conversation that is not on screen.
  const indicator = (
    <RadioIndicator
      live={radio.reception.live}
      nameFor={nameFor}
      onOpen={(ids) => setView({ kind: "thread", with: ids })}
    />
  );

  if (!log) {
    return (
      <Panel
        panelTitle="Commcast"
        sections={<EmptyState layout="fill">No log yet</EmptyState>}
      />
    );
  }

  const identity = (
    <Commcast__Identity>
      {/* The editor needs an identity provider; without one the seat's name is shown flat. */}
      {named === undefined ? (
        <Text size="xs">{local.name}</Text>
      ) : (
        <StationNameEditor compact />
      )}
      {/* No severity: a seat is an identity, neither good nor bad. */}
      <Badge size="sm">
        {me.seat === "pilot" ? "Aboard" : "Mission control"}
      </Badge>
    </Commcast__Identity>
  );

  const body = (
    // `fill`, because the log is the tile.
    <Section fill>
      {/* Three views in one frame with the same geometry, so switching view never resizes the tile. */}
      <Commcast__Frame>
        {view.kind === "inbox" && (
          <CommcastInboxView
            threads={threads}
            dropped={dropped}
            nameFor={nameFor}
            canCompose={recipients.length > 0}
            radio={radio}
            indicator={indicator}
            onOpen={(ids) => setView({ kind: "thread", with: ids })}
            onCompose={() => setView({ kind: "compose" })}
          />
        )}
        {view.kind === "compose" && (
          <CommcastComposeView
            recipients={recipients}
            indicator={indicator}
            onBack={() => setView({ kind: "inbox" })}
            onOpen={(ids) => setView({ kind: "thread", with: ids })}
          />
        )}
        {view.kind === "thread" && (
          <CommcastThreadView
            thread={threadFor(threads, view.with)}
            me={me}
            utNow={utNow}
            pairs={pairs}
            log={log}
            noSignal={noSignal}
            nameFor={nameFor}
            local={local}
            radio={radio}
            indicator={indicator}
            separation={separation}
            separationSeconds={separationSeconds}
            target={target}
            onBack={() => setView({ kind: "inbox" })}
          />
        )}
      </Commcast__Frame>
    </Section>
  );

  return <Panel panelTitle="Commcast" panelAside={identity} sections={body} />;
}

function secondsOf(separation: Separation): number | null {
  if (separation.kind === "no-path") return null;
  if (separation.kind === "light-time") return separation.seconds;
  return 0;
}

/** Mounts its own provider so the widget works on a screen that never wired one. */
function CommcastWidget(props: Readonly<ComponentProps>) {
  return (
    <CommcastProvider>
      <CommcastComponent {...props} />
    </CommcastProvider>
  );
}

registerComponent({
  id: "commcast",
  name: "Commcast",
  description:
    "Addressed messages between the command centres and craft on this mission. An inbox of conversations, each one crossing the light-time to the vantage it names and acknowledged back, so your own words appear only once that acknowledgement returns and the wait you feel is the wait that is really there.",
  tags: ["mission-control", "comms"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 4, h: 5 },
  component: CommcastWidget,
  /*
   * The roster is who can be addressed and the separation how far away each
   * is; `comms.delay` is the fallback for a pair the matrix has not reached,
   * and `comms.link` terminates the log.
   */
  channels: [
    "commandCentre.roster",
    "commandCentre.separation",
    "comms.delay",
    "comms.link",
  ],
  defaultConfig: {},
  actions: [],
  pushable: false,
});

export { CommcastWidget };
