import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ARES,
  ackedByAres,
  ackedByKsc,
  CommcastScene,
  type Held,
  KSC,
  LIGHT_TIME,
  RECOVERY,
  ROW,
  toAres,
  toKsc,
  WOOMERA,
} from "../../commcastScenes";
import { withGonogoFrame } from "../../frame";

const GROUP = "kennedy-ares-woomera";

/** Kennedy opening a group with the craft and the range, then speaking in it. */
const GROUP_SENT: Held[] = [
  {
    from: KSC,
    to: [KSC, ARES, WOOMERA],
    authorName: "Kennedy Flight",
    authorSeat: "mission-control",
    body: "",
    sentAt: -3000,
    separationSeconds: LIGHT_TIME,
    acks: ackedByAres(-3000),
    group: GROUP,
    members: [KSC, ARES, WOOMERA],
    added: [ARES, WOOMERA],
  },
  {
    from: KSC,
    to: [KSC, ARES, WOOMERA],
    authorName: "Kennedy Flight",
    authorSeat: "mission-control",
    body: "Ares, Woomera, Kennedy. Handover at the next pass.",
    sentAt: -2400,
    separationSeconds: LIGHT_TIME,
    acks: ackedByAres(-2400),
    group: GROUP,
  },
];

/** The range answering, and the craft bringing the recovery ship in. */
const GROUP_RECEIVED: Held[] = [
  {
    from: WOOMERA,
    to: [KSC, ARES, WOOMERA],
    authorName: "Woomera Range",
    authorSeat: "mission-control",
    body: "Kennedy, Woomera. Ready for the handover.",
    sentAt: -1800,
    separationSeconds: 12,
    group: GROUP,
  },
  {
    from: ARES,
    to: [KSC, ARES, WOOMERA, RECOVERY],
    authorName: "Jeb",
    authorSeat: "pilot",
    body: "",
    sentAt: -1200,
    separationSeconds: LIGHT_TIME,
    group: GROUP,
    members: [KSC, ARES, WOOMERA, RECOVERY],
    added: [RECOVERY],
  },
  {
    from: ARES,
    to: [KSC, ARES, WOOMERA, RECOVERY],
    authorName: "Jeb",
    authorSeat: "pilot",
    body: "Recovery is on the loop for splashdown.",
    sentAt: -1100,
    separationSeconds: LIGHT_TIME,
    group: GROUP,
  },
];

const BURN_GO = "Ares, Kennedy. You are go for the insertion burn.";
const BURN_COPY = "Copy go. Starting the sequence.";
const RESIDUALS = "Ares, Kennedy. Confirm residuals when you have them.";

const KENNEDY = {
  seat: "mission-control",
  vantage: KSC,
  name: "Kennedy Flight",
  oneWaySeconds: LIGHT_TIME,
  w: 12,
  h: 14,
} as const;

const meta = {
  title: "Widgets/commcast",
  component: CommcastScene,
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
  argTypes: {
    sent: { control: false },
    received: { control: false },
    crossing: { control: false },
    presses: { control: false },
    w: { control: { type: "range", min: 4, max: 36, step: 1 } },
    h: { control: { type: "range", min: 5, max: 40, step: 1 } },
  },
} satisfies Meta<typeof CommcastScene>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Kennedy's inbox: a conversation with the craft that still has a message
 * climbing to it, one with the range, and a group all three are in.
 */
export const Inbox: Story = {
  args: {
    ...KENNEDY,
    sent: [
      { ...toAres(BURN_GO, -3600), acks: ackedByAres(-3600) },
      toAres(RESIDUALS, -60),
      ...GROUP_SENT,
    ],
    received: [
      toKsc(BURN_COPY, -3000),
      {
        from: WOOMERA,
        to: [KSC],
        authorName: "Woomera Range",
        authorSeat: "mission-control",
        body: "Kennedy, Woomera. We have the pass, tracking is locked.",
        sentAt: -900,
        separationSeconds: 12,
      },
      ...GROUP_RECEIVED,
    ],
  },
};

/**
 * Inside the conversation with the craft, four light-minutes out: an exchange
 * that completed with the round trip it took, and a message still in transit,
 * held in the uplink queue until the craft's acknowledgement comes back.
 */
export const ThreadInTransit: Story = {
  name: "Thread, message in transit",
  args: {
    ...KENNEDY,
    sent: [
      { ...toAres(BURN_GO, -900), acks: ackedByAres(-900) },
      toAres(RESIDUALS, -60),
    ],
    received: [toKsc(BURN_COPY, -600)],
    presses: [{ text: "Ares 4", selector: ROW }],
  },
};

/**
 * The same exchange aboard the craft, at the same instant. Kennedy's latest
 * message is still crossing, so it is not here at all.
 */
export const AboardTheCraft: Story = {
  name: "Thread, aboard the craft",
  args: {
    seat: "pilot",
    vantage: ARES,
    name: "Jeb",
    oneWaySeconds: LIGHT_TIME,
    w: 12,
    h: 14,
    received: [toAres(BURN_GO, -900)],
    sent: [{ ...toKsc(BURN_COPY, -600), acks: ackedByKsc(-600) }],
    crossing: [toAres(RESIDUALS, -60)],
    presses: [{ text: "Kennedy", selector: ROW }],
  },
};

/**
 * Messages nobody acknowledged: one sent into silence, one that never left
 * because there was no path, and one already resent once.
 */
export const Unconfirmed: Story = {
  args: {
    ...KENNEDY,
    sent: [
      { ...toAres(BURN_GO, -3000), acks: ackedByAres(-3000) },
      toAres("Ares, Kennedy. Do you copy.", -1200),
      {
        ...toAres("Ares, Kennedy. Attitude looks wrong from here.", -900),
        separationSeconds: null,
        neverLeft: true,
      },
      {
        ...toAres("Ares, Kennedy. Say again your status.", -1800),
        lastSentAt: -700,
        attempts: 2,
      },
    ],
    presses: [{ text: "Ares 4", selector: ROW }],
  },
};

/**
 * A group's thread: opened by Kennedy with the craft and the range, grown by
 * the craft adding the recovery ship, and every member's words in one place.
 */
export const GroupThread: Story = {
  name: "Group thread",
  args: {
    ...KENNEDY,
    sent: GROUP_SENT,
    received: GROUP_RECEIVED,
    presses: [{ text: "Recovery 1", selector: ROW }],
  },
};

/** The link is confirmed lost: the log ends at a marker saying where knowledge stops. */
export const NoSignal: Story = {
  name: "No signal",
  args: {
    ...KENNEDY,
    linkLost: true,
    sent: [
      {
        ...toAres(
          "Ares, Kennedy. Expect loss of signal on the far side.",
          -1800,
        ),
        acks: ackedByAres(-1800),
      },
    ],
    received: [toKsc("Kennedy, Ares. Copy, see you on the other side.", -1500)],
    presses: [{ text: "Ares 4", selector: ROW }],
  },
};

/** Choosing who a new group is with: any number of the roster may be picked. */
export const Compose: Story = {
  name: "New message, choosing the group",
  args: {
    ...KENNEDY,
    presses: [
      { text: "New message" },
      { text: "Ares 4", selector: ROW },
      { text: "Woomera Range", selector: ROW },
    ],
  },
};

/** A staffed roster and nothing said yet. */
export const NoConversations: Story = {
  name: "No conversations yet",
  args: { ...KENNEDY },
};

const WOOMERA_LEFT = {
  id: WOOMERA,
  displayName: "Woomera Range",
  kind: "GroundStation",
  lastReachableAt: -5400,
};

/** The range has left the roster: its thread keeps its name, greyed, and sending to it is refused. */
export const UnreachableThread: Story = {
  name: "Thread, addressee unreachable",
  args: {
    ...KENNEDY,
    departed: [WOOMERA_LEFT],
    sent: [],
    received: [
      {
        from: WOOMERA,
        to: [KSC],
        authorName: "Woomera Range",
        authorSeat: "mission-control",
        body: "Kennedy, Woomera. We have the pass, tracking is locked.",
        sentAt: -6000,
        separationSeconds: 12,
      },
    ],
    presses: [{ text: "Woomera Range", selector: ROW }],
  },
};

/** One correspondent remembered with a last-reachable time, one the mod never saw. */
export const UnreachableInbox: Story = {
  name: "Inbox, addressees unreachable",
  args: {
    ...KENNEDY,
    departed: [WOOMERA_LEFT],
    forgotten: [RECOVERY],
    sent: [{ ...toAres(BURN_GO, -3600), acks: ackedByAres(-3600) }],
    received: [
      {
        from: WOOMERA,
        to: [KSC],
        authorName: "Woomera Range",
        authorSeat: "mission-control",
        body: "Kennedy, Woomera. We have the pass, tracking is locked.",
        sentAt: -6000,
        separationSeconds: 12,
      },
      {
        from: RECOVERY,
        to: [KSC],
        authorName: "Recovery 1",
        authorSeat: "mission-control",
        body: "Kennedy, Recovery. On station.",
        sentAt: -4000,
        separationSeconds: 0.4,
      },
    ],
  },
};
