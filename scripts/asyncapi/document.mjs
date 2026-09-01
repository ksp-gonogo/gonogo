// The AsyncAPI 3.0.0 document for the Sitrep contract's CORE surface.
//
// ## Why AsyncAPI and not OpenAPI
//
// OpenAPI is HTTP-shaped: paths, verbs, status codes, a request paired with a
// response. None of that describes a socket that PUSHES. AsyncAPI was built for
// it, and carries the two halves this contract actually has: channels a client
// receives on, and a command with a typed reply. Payloads are JSON Schema in
// both, so nothing about the schemas is lost by choosing one.
//
// ## Whose document this is
//
// AsyncAPI operations are written from the point of view of ONE application, and
// the choice is load-bearing rather than cosmetic: `send` and `receive` invert
// depending on which end you stand at. This document stands at the CLIENT, the
// dashboard or an Uplink's client bundle, because that is who reads it. So a
// telemetry channel is `receive` and a command is `send`, and the mod is the
// server in `servers`.

const SERVER_KEY = "mod";

/**
 * The document-level prose.
 *
 * Everything here is a property of the PROTOCOL rather than of a message shape,
 * which is exactly the set a schema has no slot for. It is written down because
 * a reader who takes a schema catalogue as the whole contract gets four things
 * wrong, and every one of them is a runtime failure rather than a type error.
 */
function infoDescription(counts) {
  return `The wire contract of the Gonogo mod's telemetry socket: ${counts.topics} telemetry
channels a client subscribes to, and ${counts.commands} commands it dispatches, with the payload
schema and the contract's own prose for each.

**Generated.** Emitted by \`scripts/asyncapi-doc.mjs\` from the committed
TypeScript contract under \`mod/sitrep-sdk/src/__generated__/\`, which
\`mod/codegen.sh\` in turn generates from the C# in \`mod/Sitrep.Contract/\`. The
C# is the source of truth. Do not hand-edit this file; change the C# doc comment
or the declaration and regenerate.

**Point of view.** Operations are written from the CLIENT's side: a telemetry
channel is \`receive\` and a command is \`send\`. The mod is the server.

## One socket, many channels

Every channel below is multiplexed over a single WebSocket. A channel's
\`address\` is the value of the \`topic\` field on a \`stream-data\` frame, or of
the \`command\` field on a \`command-request\`; it is not a URL path, and there is
no second connection to open. The \`session\` channel carries the frames that
belong to the connection rather than to any one channel.

Everything the mod sends is one of four frame types, unioned as
\`components.schemas.InboundFrame\`: \`stream-data\`, \`command-response\`,
\`event\` and \`error\`. Write that router first: every per-channel message below
narrows one of its arms, and none of them adds a fifth.

Route on the \`type\` field. Each arm pins it with a \`const\`, so a plain JSON
Schema validator discriminates the union without help, and the \`discriminator\`
keyword on \`InboundFrame\` is a label on that rather than the thing doing the
work. \`InboundFrame\` is a named union nothing \`$ref\`s: it exists to be read,
and the two arms that are frames in their own right carry their vocabularies on
their schemas, \`EventMsg\` for the two \`name\` values and \`ErrorMsg\` for the
three \`code\` values. The same prose reaches you through
\`components.messages.event\` and \`components.messages.error\`, which is where
the channels point.

## Nothing arrives before you ask for it

Delivery is subscription-gated. A client receives a topic only after sending
\`subscribe\` for it, and a frame the mod emits with no subscriber is DROPPED
rather than queued: connecting and waiting yields silence forever. This is a
property of the protocol and appears nowhere in a message shape, so a
schema-first reader will not find it.

## A quantity crosses as a bare number

The generated TypeScript types every quantity as \`Value<"m">\`, an object with a
magnitude and a unit. That is the shape AFTER the SDK hydrates it. The wire
carries a bare JSON number, and the schemas here say so, with the unit token on
\`x-sitrep-unit\`. Send \`{ magnitude, unit }\` and the mod will not understand
it.

## An enum crosses as its ordinal

Never as its name. Where the member set is a real constraint it is a \`oneOf\` of
\`const\` values carrying each member's name and prose. A \`[Flags]\` bitmask has
no member set to validate against, because the wire carries an OR of members, so
those carry the member table on \`x-sitrep-enum\` and constrain only
\`integer\`. \`x-sitrep-enum-kind\` says which of the two an enum is.

## The \`x-sitrep-*\` annotations

Facts the contract states that JSON Schema and AsyncAPI have no slot for. Each
is read off the declaration site rather than written here, so an annotation that
is absent means the declaration did not state it.

- \`x-sitrep-unit\`, on a schema: the token the value crosses in, from the
  contract's \`[SitrepUnit]\`. \`text\`, \`flag\`, \`id\`, \`enum\` and \`n/a\`
  are tokens in this vocabulary too and mean what they say, so absent, \`n/a\`
  and \`1\` are three different things
- \`x-sitrep-enum\` and \`x-sitrep-enum-kind\`, on an enum's schema: see the
  section above
- \`x-sitrep-delivery\`, on a telemetry channel: which outbox lane its samples
  ride. \`lossy-latest\` coalesces to the freshest sample per topic, so a client
  that falls behind sees the latest state and never the ones it skipped.
  \`reliable-ordered\` delivers every sample, in order, never coalesced. This is
  not a tuning knob: the \`reliable-ordered\` channels are the DISCRETE
  occurrences, and a client that treats \`flight.started\` as lossy misses a
  launch whose frame a later one replaced
- \`x-sitrep-delay-role\`, on a telemetry channel: \`delayed\` rides the
  light-time clock, so the value is what the vantage KNEW rather than what is
  true now. \`true-now\` bypasses it, and is for a ground-side fact with no
  analogue in flight, such as whether the SCANsat assembly is installed at all
- \`x-sitrep-keyframe-interval-ut\`, on a telemetry channel: the UT seconds
  after which it re-emits unconditionally, with nothing changed. It is what
  makes a late subscriber, a quickload and a rejoin recoverable without waiting
  for the next real change. The seconds are GAME seconds and the two clocks are
  not proportional: UT runs at up to 100000x wall-clock under timewarp and does
  not advance at all while the game is paused. So this is not a wall-clock
  duration, and a wall-clock timer sized off it fires long before the keyframe
  under warp and never fires at all while paused. Measure staleness in the same
  clock the number is in, by watching \`Meta.validAt\` advance; if you need a
  wall-clock bound, convert with the live \`warpRate\` on \`time.warp\` and treat
  its \`paused\` as "no keyframe is due"
- \`x-sitrep-absence-is-data\`, on a telemetry channel: \`true\` means an empty
  value is a real answer and arrives as a tombstone from the first tick (no
  target selected, no crew aboard). Without it a channel is held back until it
  has had a real value, so silence there means "not yet" rather than "none"
- \`x-sitrep-delayed\`, on a command channel: whether the write rides the
  uplink instead of taking effect when it is pressed
- \`x-sitrep-empty\`, on a schema: the shape IS the absence of one, as
  \`NoCommandArgs\` is, rather than a shape whose fields were dropped

## This is not a list of every channel on the wire

It cannot become one. A DYNAMIC namespace is registered at RUNTIME and
materialises its channels per subject, so no statically declared type exists for
the generator to find and nothing about it appears here: \`silence.<guid>.*\`,
\`currency.<guid>.<currency>\`, per-vessel part actions, and each Uplink's own.
Asking this document "is there a per-vessel X" gets a confident no about a
channel that has been published all along. An Uplink's own channels and commands
are likewise absent: they live in the Uplink's contract slice, not in the core
one this document is generated from.

The prefix alone does not tell you which half a channel is in, and \`fleet.\` is
the case that proves it: \`fleet.silence\` is STATICALLY declared and is in this
document, while \`fleet.<guid>.<field>\` is dynamic and is not. Reading the one
as evidence about the other goes wrong in both directions.

## What a schema cannot say about this contract

- **Absence and staleness are a CLIENT-side projection.** A reader hook answers
  with a state machine over never-seen, not-ours, known-absent, fresh, stale, and
  stale-with-a-model. None of that is in a message shape: it is what the client's
  timeline store makes of the frames it has. A schema-first author will assume a
  payload is either present or missing, and it is neither
- **The delay model.** A value is relative to a VANTAGE, a command centre, and
  arrives light-time late. That is why \`validAt\` and \`deliveredAt\` are
  different numbers, why a command is delayed and a fact about the local station
  is not, and why a stale value can still be worth acting on. The tokens fit in a
  schema; what they cost an operator is a paragraph
- **Why a field is shaped as it is.** The reasoning behind the shapes is in the
  contract's own doc comments, which is why this document carries every one of
  them into a \`description\` rather than emitting a list of names`;
}

const SESSION_DESCRIPTION = `Frames that belong to the connection rather than to any one channel.

\`subscribe\` and \`unsubscribe\` name a topic and are how a client opens and
closes delivery on it: see the subscription gate in the document description.
\`set-vantage\` selects the command centre this connection commands from and
observes at, which governs both what it reads and how long its commands take.
An \`error\` frame carries a code and, when it answers a dispatch, the
\`requestId\` it refers to.

This channel has no \`address\` because these frames are not routed by one: they
are typed by their own \`type\` field and belong to the socket itself.`;

/**
 * The distinction between an `error` frame and a failed `command-response`, and
 * the three codes the mod puts in `code`.
 *
 * Written out because it is the question the surface could not answer and the
 * one an author has to get right to handle a write at all: the two are not
 * degrees of the same thing.
 *
 * Attached to the SCHEMA rather than to the message, via `schemas.describe`. The
 * contract declares no doc comment for `ErrorMsg`, and a reader routing off
 * `InboundFrame` never passes through the message at all, so on the message this
 * reached one of the two ways in.
 */
const ERROR_DESCRIPTION = `A fault, never a refusal, and the difference decides how a client handles it.

An \`error\` frame means the request was never CARRIED: an unknown command, a
command whose provider has fail-softed, a result the codec could not serialise,
or a \`set-vantage\` naming a command centre that is not active. No handler ran,
so there is nothing to report about what the game thought.

A command the game REFUSED ran and said no. That arrives as a
\`command-response\` with \`success: false\` and an \`errorCode\`, correlated on
\`requestId\` like any other answer, and it is not an error frame.

\`code\` is an open vocabulary rather than an enumeration, and the mod emits
three values into it: \`unknown-vantage\`, a \`set-vantage\` naming a centre that
is not active; \`E_UNAVAILABLE\`, a dispatch that reached no handler; and
\`result-serialization-error\`, a command that ran and whose result could not be
written. A client's own transport mints codes into the same field, so an
unrecognised code is still a fault and \`message\` is what to show for it.
\`CommandErrorCode\`, enumerated in full under \`components.schemas\`, is a
different vocabulary: it names REFUSALS and never appears here.`;

/**
 * What an `event` frame is, and why it is on the topic channels rather than on
 * the session.
 *
 * The frame's own payload requires a `topic`, and both names the mod emits are
 * per-subscription. Written here rather than in the C# because it is a fact
 * about the protocol, and attached to the `EventMsg` SCHEMA for the reason
 * `ERROR_DESCRIPTION` gives.
 */
const EVENT_DESCRIPTION = `Something that happened to a SUBSCRIPTION, on the topic it happened to.

Two names are emitted, and each names one topic this connection is subscribed
to:

- \`subscribed\` acknowledges a \`subscribe\`, once per subscribe, on the
  reliable lane. It is the frame to wait for rather than the first
  \`stream-data\`: a channel with nothing to say yet sends the ack and then
  nothing. A \`subscribe\` naming a topic no declared channel and no registered
  dynamic namespace owns is answered with NOTHING, not an error, so a missing
  ack is how a client learns a topic is unowned
- \`timeline-reset\` says the game quickloaded and UT rewound. It is sent to
  every session for every topic it holds, and the delayed view built from
  frames before it is abandoned rather than reconciled

An event carries no payload of its own: \`name\` is the whole of what happened,
and \`meta\` describes the delivery as it does on any other frame. Events on a
DYNAMIC topic are emitted the same way and are absent here for the reason the
document description gives.`;

const STREAM_DATA_DESCRIPTION = `The envelope every telemetry frame arrives in.

\`topic\` is the channel's \`address\` and \`payload\` is that channel's own
shape; each channel's \`stream-data\` message pins both, so this is the shape to
route on and that one is the shape to read. \`meta\` is stamped by the mod on
every frame and describes the DELIVERY rather than the value, which is where
\`validAt\`, \`deliveredAt\` and staleness live.`;

const COMMAND_REQUEST_DESCRIPTION = `The envelope every dispatch is sent in.

\`command\` is the channel's \`address\` and \`args\` is that command's own args
type; each command's \`command-request\` message pins both. The answer comes back
as a \`command-response\` correlated on \`requestId\`, or as an \`error\` frame if
the dispatch was never carried.`;

const COMMAND_RESPONSE_DESCRIPTION = `The envelope every answer to a dispatch arrives in.

\`result\` is the command's own reply type, pinned by that command's
\`command-response\` message. A resolved response is a command that RAN: a
refusal arrives here with \`success: false\` and an \`errorCode\`, and a fault
arrives as an \`error\` frame on the session channel instead.

There is no \`command\` field. \`requestId\` is the only link back to the
dispatch, and a delayed command's answer can be minutes behind it.`;

const INBOUND_FRAME_DESCRIPTION = `Every frame the mod sends, discriminated on \`type\`.

The first thing a client writes is a router over these four, and they are the
whole of the inbound surface: \`stream-data\` carries a subscribed topic's value,
\`command-response\` answers a dispatch, \`event\` reports something that happened
to a subscription, and \`error\` reports a request that could not be carried.
Every per-channel message below narrows one of these; none of them adds a fifth
\`type\`.

Each arm pins \`type\` with a \`const\`, and that is what the discrimination is
made of: a plain JSON Schema validator picks the right arm from the constants
alone. The \`discriminator\` beside this is the AsyncAPI Schema keyword, a bare
string naming that property, and it is a LABEL on the constants rather than the
mechanism. Two things follow. It is not OpenAPI 3's \`discriminator\` object, so
\`propertyName\` and \`mapping\` do not belong here and the object form does not
validate. And a JSON Schema tool that has never heard of it loses nothing,
because the constants are still there.`;

const CORRELATION_DESCRIPTION =
  "A dispatch and its answer are correlated on `requestId`, never on order: " +
  "responses may arrive out of the order the requests were sent, and a " +
  "delayed command's answer can be minutes behind it.";

/** A `Meta` the examples share, so all three read as one frame's worth of traffic. */
const EXAMPLE_META = {
  source: "gonogo",
  validAt: 1_842_006.5,
  seq: 918,
  deliveredAt: 1_842_006.5,
  vantage: "ksc",
  quality: 1,
  active: true,
  staleness: 0,
  timelineEpoch: 3,
};

/*
 * The two frames a client has to CONSTRUCT, worked in full.
 *
 * Both are pinned to a real subject, `vessel.flight` and
 * `vessel.control.setThrottle`, and both carry every field those subjects
 * require rather than an abbreviated sketch. `EXAMPLE_TOPIC` and
 * `EXAMPLE_COMMAND` are here because `assertExamplesMatchTheirSchemas` in
 * `asyncapi-doc.mjs` resolves the message for each and checks the example
 * against it.
 *
 * Written out in full because the shorter version was WRONG and shipped for
 * months: the command example sent `args: { throttle: 0.4 }` against a
 * `SetThrottleArgs` whose one required field is `value`, and the telemetry
 * example sent `payload: { altitude, verticalSpeed }` against a `VesselFlight`
 * that requires fourteen fields and has no `altitude` among them (it has
 * `altitudeAsl` and `altitudeTerrain`, which is the distinction the sketch
 * collapsed). Nothing caught it: `StreamData.payload` and `CommandRequest.args`
 * are deliberately unconstrained on the base envelope, since the narrowing lives
 * on the per-channel message, so an example on the base validated against a slot
 * that accepts anything. These are the only two examples of the only two frames
 * a client sends or reads, so a reader copies them, and both failed silently.
 */
export const EXAMPLE_TOPIC = "vessel.flight";
export const EXAMPLE_COMMAND = "vessel.control.setThrottle";

const EXAMPLE_STREAM_DATA = {
  type: "stream-data",
  topic: EXAMPLE_TOPIC,
  payload: {
    latitude: -0.0972,
    longitude: -74.5577,
    altitudeAsl: 72840.31,
    altitudeTerrain: 72837.02,
    verticalSpeed: -4.2,
    surfaceSpeed: 2287.4,
    orbitalSpeed: 2301.8,
    gForce: 0.02,
    dynamicPressureKPa: 0.0004,
    mach: 7.63,
    atmDensity: 0.0000012,
    externalTemperature: 231.4,
    atmosphericTemperature: 228.9,
    meta: { source: "vessel:8f2c1d40-97ab-4a2e-9c1f-6d0b3e5a7c11", quality: 1 },
  },
  meta: EXAMPLE_META,
};

const EXAMPLE_COMMAND_REQUEST = {
  type: "command-request",
  requestId: "0f3c9a12",
  command: EXAMPLE_COMMAND,
  label: "Throttle 40%",
  topic: "vessel.control",
  vantage: "ksc",
  args: { value: 0.4 },
  /*
   * Zero, and not a placeholder. `CommandRequest.sentAt`'s own doc comment says
   * every client sends 0 today, so an example carrying a UT here would teach a
   * habit the contract does not have.
   */
  sentAt: 0,
};

/**
 * Bindings the ORIGINAL declaration site knows and the generated contract does
 * not carry: how a channel is delivered, whether its value is delayed, and how
 * often it is emitted.
 *
 * Absent for a channel whose declaration could not be read. Absent is reported
 * as absent, never as a default, because "not declared" and "the generator could
 * not see it" are different facts and one of them is a bug.
 */
function dispositionExtensions(disposition) {
  if (!disposition) return {};
  const out = {};
  if (disposition.delivery) out["x-sitrep-delivery"] = disposition.delivery;
  if (disposition.delay) out["x-sitrep-delay-role"] = disposition.delay;
  if (disposition.keyframeIntervalUt !== undefined) {
    out["x-sitrep-keyframe-interval-ut"] = disposition.keyframeIntervalUt;
  }
  if (disposition.absenceIsData !== undefined) {
    out["x-sitrep-absence-is-data"] = disposition.absenceIsData;
  }
  return out;
}

/**
 * The three envelopes as named schemas, plus the union of every frame the mod
 * sends.
 *
 * Each envelope is generic over one slot in the contract, so the walk has no
 * single shape to emit for it: the slot is described here and each channel's
 * message narrows it with an `allOf`. Naming them is what lets a client write a
 * frame router before it has read a channel, which is the first thing it has to
 * do and the one thing 178 inlined copies of the same envelope never said.
 */
function defineEnvelopes(schemas, contract) {
  const field = (typeName, fieldName) =>
    schemas.fieldSchema(fieldOf(contract, typeName, fieldName), typeName);

  const streamData = schemas.define("StreamData", {
    type: "object",
    description: STREAM_DATA_DESCRIPTION,
    required: ["type", "topic", "payload", "meta"],
    properties: {
      type: schemas.constSchema("StreamData", "type", "stream-data"),
      topic: field("StreamData", "topic"),
      payload: {
        description:
          "The topic's own value. Each channel's `stream-data` message narrows " +
          "this to that channel's payload schema.",
      },
      meta: schemas.ref("Meta"),
    },
    examples: [EXAMPLE_STREAM_DATA],
  });

  const commandRequest = schemas.define("CommandRequest", {
    type: "object",
    description: COMMAND_REQUEST_DESCRIPTION,
    required: [
      "type",
      "requestId",
      "command",
      "label",
      "topic",
      "args",
      "sentAt",
    ],
    properties: {
      type: schemas.constSchema("CommandRequest", "type", "command-request"),
      requestId: field("CommandRequest", "requestId"),
      command: field("CommandRequest", "command"),
      label: field("CommandRequest", "label"),
      topic: field("CommandRequest", "topic"),
      vantage: field("CommandRequest", "vantage"),
      args: {
        description:
          "The command's own arguments. Each command's `command-request` " +
          "message narrows this to that command's args schema.",
      },
      sentAt: field("CommandRequest", "sentAt"),
    },
    examples: [EXAMPLE_COMMAND_REQUEST],
  });

  const commandResponse = schemas.define("CommandResponse", {
    type: "object",
    description: COMMAND_RESPONSE_DESCRIPTION,
    required: ["type", "requestId", "result", "meta"],
    properties: {
      type: schemas.constSchema("CommandResponse", "type", "command-response"),
      requestId: field("CommandResponse", "requestId"),
      result: {
        description:
          "The command's own reply. Each command's `command-response` message " +
          "narrows this to that command's reply schema.",
      },
      meta: schemas.ref("Meta"),
    },
    examples: [
      {
        type: "command-response",
        requestId: "0f3c9a12",
        result: { success: true, errorCode: 0 },
        meta: EXAMPLE_META,
      },
    ],
  });

  schemas.define("InboundFrame", {
    description: INBOUND_FRAME_DESCRIPTION,
    discriminator: "type",
    oneOf: [
      streamData,
      commandResponse,
      schemas.ref("EventMsg"),
      schemas.ref("ErrorMsg"),
    ],
  });

  /*
   * A fresh `$ref` object per call, never the one object 122 times. The YAML
   * writer anchors a repeated object and aliases every later use, so sharing one
   * turned 121 of the messages into `- *a1` and left a reader chasing an anchor
   * to find out which envelope the message narrows. It costs no lines either
   * way: an aliased list item and a `$ref` list item are both one line, and the
   * anchor's own definition is two.
   */
  return {
    streamData: () => ({ ...streamData }),
    commandRequest: () => ({ ...commandRequest }),
    commandResponse: () => ({ ...commandResponse }),
  };
}

/**
 * Assembles the whole document.
 *
 * Every map is built in sorted key order and every list in the order its source
 * declares, so the same inputs produce the same bytes. Determinism is not a
 * nicety here: the file is committed and CI fails on a diff, so a walk-order
 * dependency would show up as a red build on an unrelated change.
 */
export function buildDocument({
  contract,
  topics,
  commandArgs,
  commandReplies,
  dispositions,
  commandDispositions,
  schemas,
  version,
}) {
  const replyOf = new Map(
    commandReplies.map((entry) => [entry.key, entry.type]),
  );

  const channels = {};
  const operations = {};
  const messages = {};

  const envelopes = defineEnvelopes(schemas, contract);

  channels.session = {
    title: "Connection session",
    description: SESSION_DESCRIPTION,
    servers: [{ $ref: `#/servers/${SERVER_KEY}` }],
    messages: {
      subscribe: { $ref: "#/components/messages/subscribe" },
      unsubscribe: { $ref: "#/components/messages/unsubscribe" },
      setVantage: { $ref: "#/components/messages/setVantage" },
      error: { $ref: "#/components/messages/error" },
    },
  };

  messages.subscribe = {
    name: "subscribe",
    title: "Open delivery on a topic",
    payload: schemas.ref("Subscribe"),
    examples: [
      {
        name: "open-vessel-flight",
        summary:
          "The first frame a client sends. Until it does the socket stays silent, " +
          "and the mod answers this one with an `event` named `subscribed` on the " +
          "`vessel.flight` channel.",
        payload: { type: "subscribe", topic: "vessel.flight" },
      },
    ],
  };
  messages.unsubscribe = {
    name: "unsubscribe",
    title: "Close delivery on a topic",
    payload: schemas.ref("Unsubscribe"),
  };
  messages.setVantage = {
    name: "set-vantage",
    title: "Select this connection's command centre",
    payload: schemas.ref("SetVantage"),
  };
  messages.event = {
    name: "event",
    title: "A named occurrence on a topic, carrying no payload of its own",
    payload: schemas.describe("EventMsg", EVENT_DESCRIPTION),
  };
  messages.error = {
    name: "error",
    title: "A dispatch that could not be carried, or a bad session request",
    payload: schemas.describe("ErrorMsg", ERROR_DESCRIPTION),
    correlationId: {
      description:
        "Present when the error answers a dispatch, absent when it is about the connection or a topic.",
      location: "$message.payload#/requestId",
    },
  };

  operations["session.control"] = {
    action: "send",
    channel: { $ref: "#/channels/session" },
    title: "Open or close delivery, or change vantage",
    tags: [{ name: "session" }],
    messages: [
      { $ref: "#/channels/session/messages/subscribe" },
      { $ref: "#/channels/session/messages/unsubscribe" },
      { $ref: "#/channels/session/messages/setVantage" },
    ],
  };
  operations["session.notices"] = {
    action: "receive",
    channel: { $ref: "#/channels/session" },
    title: "Connection-scoped errors",
    description:
      "An `event` frame is NOT here. It names a topic and is only ever emitted " +
      "for one this connection has subscribed to, so it sits on the topic " +
      "channels alongside their `stream-data`.",
    tags: [{ name: "session" }],
    messages: [{ $ref: "#/channels/session/messages/error" }],
  };

  for (const { key: topic, type } of topics) {
    const payload = schemas.typeSchema(type, `topic ${topic}`);
    const messageKey = `streamData.${topic}`;
    messages[messageKey] = {
      name: "stream-data",
      title: `A frame on ${topic}`,
      contentType: "application/json",
      payload: {
        description: `The \`stream-data\` envelope carrying \`${topic}\`.`,
        allOf: [
          envelopes.streamData(),
          { properties: { topic: { const: topic }, payload } },
        ],
      },
    };
    channels[topic] = {
      address: topic,
      description: channelDescription(contract, type, topic),
      servers: [{ $ref: `#/servers/${SERVER_KEY}` }],
      ...dispositionExtensions(dispositions.get(topic)),
      messages: {
        streamData: { $ref: `#/components/messages/${messageKey}` },
        event: { $ref: "#/components/messages/event" },
      },
    };
    operations[`read:${topic}`] = {
      action: "receive",
      channel: { $ref: `#/channels/${escapeRefToken(topic)}` },
      title: `Read ${topic}`,
      description:
        `Delivered only after \`subscribe\` names \`${topic}\` on the session ` +
        "channel, which the mod answers here with an `event` named `subscribed`.",
      tags: [{ name: namespaceOf(topic) }],
      messages: [
        { $ref: `#/channels/${escapeRefToken(topic)}/messages/streamData` },
        { $ref: `#/channels/${escapeRefToken(topic)}/messages/event` },
      ],
    };
  }

  for (const { key: command, type: argsType } of commandArgs) {
    const replyType = replyOf.get(command);
    if (!replyType) {
      throw new Error(
        `asyncapi: command ${command} has args and no reply type. The generated ` +
          "maps disagree with each other, which they cannot if both came from the same reflection.",
      );
    }
    const requestKey = `commandRequest.${command}`;
    const responseKey = `commandResponse.${command}`;
    // A fresh object per message, for the reason `defineEnvelopes` gives.
    const correlationId = () => ({
      $ref: "#/components/correlationIds/requestId",
    });

    messages[requestKey] = {
      name: "command-request",
      title: `Dispatch ${command}`,
      contentType: "application/json",
      correlationId: correlationId(),
      payload: {
        description: `The \`command-request\` envelope for \`${command}\`, with its typed \`args\`.`,
        allOf: [
          envelopes.commandRequest(),
          {
            properties: {
              command: { const: command },
              args: schemas.typeSchema(argsType, `command ${command} args`),
            },
          },
        ],
      },
    };
    messages[responseKey] = {
      name: "command-response",
      title: `Reply to ${command}`,
      contentType: "application/json",
      correlationId: correlationId(),
      payload: {
        description: `The \`command-response\` envelope for \`${command}\`, with its typed \`result\`.`,
        allOf: [
          envelopes.commandResponse(),
          {
            properties: {
              result: schemas.typeSchema(replyType, `command ${command} reply`),
            },
          },
        ],
      },
    };

    channels[command] = {
      address: command,
      description: commandChannelDescription(
        contract,
        argsType,
        command,
        commandDispositions.get(command).delayed,
      ),
      servers: [{ $ref: `#/servers/${SERVER_KEY}` }],
      "x-sitrep-delayed": commandDispositions.get(command).delayed,
      messages: {
        commandRequest: { $ref: `#/components/messages/${requestKey}` },
        commandResponse: { $ref: `#/components/messages/${responseKey}` },
      },
    };
    operations[`dispatch:${command}`] = {
      action: "send",
      channel: { $ref: `#/channels/${escapeRefToken(command)}` },
      title: `Dispatch ${command}`,
      tags: [{ name: namespaceOf(command) }],
      messages: [
        {
          $ref: `#/channels/${escapeRefToken(command)}/messages/commandRequest`,
        },
      ],
      reply: {
        channel: { $ref: `#/channels/${escapeRefToken(command)}` },
        messages: [
          {
            $ref: `#/channels/${escapeRefToken(command)}/messages/commandResponse`,
          },
        ],
      },
    };
  }

  return {
    asyncapi: "3.0.0",
    info: {
      title: "Gonogo Sitrep contract",
      version: `${version.major}.${version.minor}.0`,
      description: infoDescription({
        topics: topics.length,
        commands: commandArgs.length,
      }),
      license: {
        name: "MIT",
        url: "https://github.com/ksp-gonogo/gonogo/blob/main/LICENSE",
      },
      tags: [
        {
          name: "session",
          description:
            "Frames belonging to the connection rather than a channel",
        },
        ...namespaceTags(topics, commandArgs),
      ],
      externalDocs: {
        description:
          "Writing an Uplink: the client half, the mod half, and the codegen between them",
        url: "https://github.com/ksp-gonogo/gonogo/blob/main/docs/creating-an-uplink.md",
      },
    },
    defaultContentType: "application/json",
    servers: {
      [SERVER_KEY]: {
        host: "localhost:8090",
        protocol: "ws",
        title: "The Gonogo mod's telemetry socket",
        description:
          "Served by the mod inside the running game. The host and port are " +
          "configurable per install; `localhost:8090` is the default the client " +
          "falls back to when nothing else is configured. There is no path: the " +
          "URL is `ws://<host>:<port>`.",
      },
    },
    channels: sortKeys(channels),
    operations: sortKeys(operations),
    components: {
      correlationIds: {
        requestId: {
          description: CORRELATION_DESCRIPTION,
          location: "$message.payload#/requestId",
        },
      },
      messages: sortKeys(messages),
      schemas: schemas.components(),
    },
  };
}

/**
 * A subject's namespace: the first dotted segment of its address.
 *
 * The only grouping in the contract that is not this document's invention. It is
 * how the topics are named, how the providers are split, and the axis a rendered
 * sidebar needs, because 122 operations under one alphabetical list is the
 * navigation this document had.
 */
function namespaceOf(subject) {
  const dot = subject.indexOf(".");
  return dot === -1 ? subject : subject.slice(0, dot);
}

/**
 * The tag list, each carrying its own size.
 *
 * A count rather than a sentence about what the namespace is for: the count is a
 * fact off the same maps the channels came from, and a hand-written gloss on
 * twenty-five namespaces would be prose this generator invented.
 */
function namespaceTags(topics, commandArgs) {
  const counts = new Map();
  const bump = (subject, kind) => {
    const name = namespaceOf(subject);
    const entry = counts.get(name) ?? { channels: 0, commands: 0 };
    entry[kind]++;
    counts.set(name, entry);
  };
  for (const { key } of topics) bump(key, "channels");
  for (const { key } of commandArgs) bump(key, "commands");

  const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, { channels, commands }]) => ({
      name,
      description: `${plural(channels, "telemetry channel")}, ${plural(commands, "command")}`,
    }));
}

/** A `$ref` JSON-Pointer token: `/` and `~` are the two characters that must escape. */
function escapeRefToken(key) {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

function sortKeys(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

function fieldOf(contract, typeName, fieldName) {
  const declaration = contract.interfaces.get(typeName);
  const field = declaration?.fields.find((f) => f.name === fieldName);
  if (!field) {
    throw new Error(
      `asyncapi: ${typeName}.${fieldName} is not in the contract`,
    );
  }
  return field;
}

/**
 * A channel's own prose: the payload type's doc comment, which is where the
 * contract explains what the channel is FOR.
 *
 * A channel whose payload type carries none says so rather than showing an empty
 * heading. An undocumented channel is a gap in the C#, and a document that hid
 * it would be hiding the one thing this exercise is for.
 */
function channelDescription(contract, type, topic) {
  const named = namedTypeOf(type);
  const declaration = named ? contract.interfaces.get(named) : undefined;
  const plural = type.k === "array";
  const shape = named
    ? `Carries ${plural ? `an array of \`${named}\`` : `a \`${named}\``}.`
    : "";
  if (declaration?.description) {
    return `${shape}\n\n${declaration.description}`.trim();
  }
  return (
    `${shape}\n\nThe contract carries no doc comment for \`${topic}\`'s payload type. ` +
    "Add a `<summary>` to the C# and it will appear here."
  ).trim();
}

/**
 * A command channel's prose: its args type's doc comment, plus what its
 * declaration says about light-time.
 *
 * The delay sentence is spelled out rather than left to `x-sitrep-delayed`,
 * because it is the fact most likely to surprise: a delayed write does not take
 * effect when it is pressed, and an operator who does not know that is
 * committing to something minutes away.
 */
function commandChannelDescription(contract, argsType, command, delayed) {
  const named = namedTypeOf(argsType);
  const declaration = named ? contract.interfaces.get(named) : undefined;
  const shape = named ? `Takes \`${named}\`.` : "";
  const timing = delayed
    ? "**Delayed.** This command rides the uplink: it takes effect at UT plus " +
      "light-time to the craft, not when it is sent."
    : "**Not delayed.** This command takes effect immediately, because it is " +
      "ground-side bookkeeping rather than a signal to a craft.";
  const prose =
    declaration?.description ??
    `The contract carries no doc comment for \`${command}\`'s args type. ` +
      "Add a `<summary>` to the C# and it will appear here.";
  return `${shape}\n\n${timing}\n\n${prose}`.trim();
}

function namedTypeOf(type) {
  if (type.k === "ref") return type.name;
  if (type.k === "array") return namedTypeOf(type.of);
  return undefined;
}
