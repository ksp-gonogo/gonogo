import type { ComponentProps } from "@ksp-gonogo/core";
import {
  registerComponent,
  safeRandomUuid,
  useTelemetry,
} from "@ksp-gonogo/core";
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
import { groupWith } from "./groups";
import { RadioIndicator } from "./radio/RadioIndicator";
import { useRadio } from "./radio/useRadio";
import { groupSeparation, type Separation } from "./reveal";
import { threadFor, threadsOf } from "./threads";
import type { RecipientId } from "./types";
import { useCommcastFeed } from "./useCommcastFeed";
import { useDroppedCount } from "./useDroppedCount";

/** Which of the widget's screens the operator is on: each group is its own thread, and only its members hold it. */
type CommcastView =
  | { kind: "inbox" }
  /** Choosing who to open a group with. */
  | { kind: "compose" }
  /** Inside one group's thread; `with` names its other members where the group itself has not reached here. */
  | { kind: "thread"; groupId: string; with: readonly RecipientId[] }
  /** Choosing who to add to a group this vantage is in. */
  | { kind: "add"; groupId: string; with: readonly RecipientId[] };

function CommcastComponent(_props: Readonly<ComponentProps>) {
  const log = useCommcastLog();
  const named = useStationNameOptional();
  const me = useMyVantage();
  const utNow = useUtNow();
  const pairs = useSeparationMatrix();
  const local = useLocalParticipant();
  const recipients = useRecipients(me);
  // Every roster entry, this vantage's own included, so a change that adds this vantage names it rather than printing its address.
  const roster = useRecipients({ seat: me.seat });
  const [view, setView] = useState<CommcastView>({ kind: "inbox" });
  const feed = useCommcastFeed(log, me, pairs);
  const dropped = useDroppedCount(log);
  // A vantage id is an address; it reaches the screen only when the roster has not named that vantage.
  const nameFor = (id: RecipientId) =>
    roster.find((r) => r.id === id)?.name ?? id;
  const threads = threadsOf(feed, me, nameFor);
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

  const inGroup = view.kind === "thread" || view.kind === "add" ? view : null;
  const groupId = inGroup?.groupId ?? null;
  const members: readonly RecipientId[] = inGroup
    ? (feed.groups.get(inGroup.groupId) ?? withMe(me.vantageId, inGroup.with))
    : [];
  const separation = groupSeparation(me.vantageId, members, pathHome, pairs);
  const separationSeconds = secondsOf(separation);
  // On the widget, not in a thread, so it hears every group; the group and separation are only for transmitting.
  const radio = useRadio({
    log,
    me,
    pairs,
    local,
    groupId,
    members,
    separationSeconds,
  });
  const openThread = (id: string, fallback: readonly RecipientId[]) =>
    setView({ kind: "thread", groupId: id, with: fallback });
  // In every view's bar, because the transmission may be on a conversation that is not on screen.
  const indicator = (
    <RadioIndicator
      live={radio.reception.live}
      nameFor={nameFor}
      onOpen={(light) => openThread(light.threadKey, light.with)}
    />
  );

  /*
   * Opening a group and adding to one are the same change, sent like any
   * message so it reaches each member one light-time from here. It is the only
   * edit a group takes.
   */
  const changeMembers = (
    id: string,
    everyone: readonly RecipientId[],
    added: readonly RecipientId[],
  ) => {
    if (!log || me.vantageId === undefined || utNow === undefined) return;
    log.send(
      {
        stationKey: local.stationKey,
        name: local.name,
        seat: local.seat,
        vantageId: me.vantageId,
      },
      {
        kind: "members",
        groupId: id,
        to: everyone,
        members: everyone,
        added,
        sentUt: utNow,
        separationSeconds: secondsOf(
          groupSeparation(me.vantageId, everyone, pathHome, pairs),
        ),
      },
    );
  };
  // Choosing the same people again reopens their group rather than starting a second thread with them.
  const openGroup = (picked: readonly RecipientId[]) => {
    const everyone = withMe(me.vantageId, picked);
    const held = groupWith(feed.groups, everyone);
    if (held !== undefined) {
      openThread(held, picked);
      return;
    }
    const id = safeRandomUuid();
    changeMembers(id, everyone, picked);
    openThread(id, picked);
  };
  const canChange = me.vantageId !== undefined && utNow !== undefined;

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
      {/* Every view in one frame with the same geometry, so switching view never resizes the tile. */}
      <Commcast__Frame>
        {view.kind === "inbox" && (
          <CommcastInboxView
            threads={threads}
            dropped={dropped}
            nameFor={nameFor}
            canCompose={recipients.length > 0}
            radio={radio}
            indicator={indicator}
            onOpen={(thread) => openThread(thread.key, thread.with)}
            onCompose={() => setView({ kind: "compose" })}
          />
        )}
        {view.kind === "compose" && (
          <CommcastComposeView
            title="New message"
            commitLabel="Open"
            recipients={recipients}
            ready={canChange}
            indicator={indicator}
            onBack={() => setView({ kind: "inbox" })}
            onCommit={openGroup}
          />
        )}
        {view.kind === "add" && (
          <CommcastComposeView
            title="Add to group"
            backLabel="Thread"
            commitLabel="Add"
            recipients={recipients.filter((r) => !members.includes(r.id))}
            ready={canChange}
            indicator={indicator}
            onBack={() => openThread(view.groupId, view.with)}
            onCommit={(picked) => {
              changeMembers(
                view.groupId,
                [...members, ...picked].sort(),
                picked,
              );
              openThread(view.groupId, [...view.with, ...picked]);
            }}
          />
        )}
        {view.kind === "thread" && (
          <CommcastThreadView
            thread={threadFor(
              threads,
              view.groupId,
              view.with,
              feed.groups,
              me,
            )}
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
            members={members}
            onAdd={
              recipients.some((r) => !members.includes(r.id))
                ? () =>
                    setView({
                      kind: "add",
                      groupId: view.groupId,
                      with: view.with,
                    })
                : undefined
            }
            onBack={() => setView({ kind: "inbox" })}
          />
        )}
      </Commcast__Frame>
    </Section>
  );

  return <Panel panelTitle="Commcast" panelAside={identity} sections={body} />;
}

/** A group's whole membership from the others in it, this vantage included once it knows where it is. */
function withMe(
  me: RecipientId | undefined,
  others: readonly RecipientId[],
): readonly RecipientId[] {
  return [...new Set(me === undefined ? others : [me, ...others])].sort();
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
    "Messages and push-to-talk radio between the command centres and craft on this mission, always addressed to a group. An inbox of group threads, each message crossing the light-time to every member and acknowledged back, so your own words appear only once that acknowledgement returns and the wait you feel is the wait that is really there. Anyone in a group can add somebody to it; they hear from the moment word of it reaches them.",
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
