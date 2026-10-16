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
 * The document-level prose: the protocol facts a message schema has no slot for.
 */
function infoDescription(counts) {
  return `The WebSocket API of the Gonogo mod: ${counts.topics} telemetry channels a client
subscribes to and ${counts.commands} commands it sends, each with its payload and what it
means, all over one socket.

## Frames the mod sends

${frameList(FRAMES_FROM_MOD)}

Route on the \`type\` field: each frame type fixes it to a constant. A client
ignores a \`type\` it does not know.

All but \`stream-binary\` are WebSocket frames holding UTF-8 JSON that starts
with \`{\`. A \`stream-binary\` frame starts with the byte \`0x9E\` and a lane byte,
then a two-byte big-endian header length and a JSON header, and the payload
bytes follow the header. The \`stream-binary\` frame type describes that header.
Only \`commcast.radio\` and the channels of an installed Uplink use binary
frames, and neither is listed here.

## Frames a client sends

${frameList(FRAMES_FROM_CLIENT)}

## Subscribing

A channel's name is the \`topic\` of its frames, or the \`command\` of a
\`command-request\`. The mod sends a channel only after the client has sent
\`subscribe\` for it, and answers the subscribe with an \`event\` named
\`subscribed\` on that channel. A subscribe to a channel nothing declares is
answered with an \`error\` frame carrying \`unknownTopic\` and the topic instead.
A frame emitted while nothing is subscribed is dropped, not queued, so a client
that connects and waits receives nothing.

The first \`stream-data\` after \`subscribed\` can be the channel's last value
sent again, with a \`meta.validAt\` older than the \`subscribed\` event's. Order
frames by \`meta.validAt\`, not by when they arrive.

## Game time

No channel carries the current game time (UT). It is the \`meta.validAt\` of the
newest frame, and there is no clock channel. In flight, \`vessel.flight\` sends a
frame about once a second, so its frames keep a clock current. Where nothing
changes, as at the Space Center, frames come only on a change or at each
channel's Repeats interval: between frames, advance the newest \`validAt\` by
\`warpRate\` from \`time.warp\` for each real second, and not at all while its
\`paused\` is true.

## Commands

A \`command-response\` says the command ran, or why it did not. It is not the
change itself: that arrives on the affected channel's next frame, for
\`time.setPaused\` the next \`time.warp\` frame.

## Units

On the wire a quantity is a bare JSON number in the unit its field lists, in
commands as well as in telemetry. A unit of \`1\` is a plain ratio, and \`count\` is
a number of things.
A field that is not a quantity lists what kind of value it holds instead:
\`text\` is words for a person to read, \`id\` is an identifier to match and not
to show, \`flag\` is a boolean and \`enum\` is an enum's ordinal. A field with no
unit listed did not declare one. Each schema carries its unit as
\`x-sitrep-unit\`.

## Enums

Most enums are sent as their integer ordinal. A few, such as \`errorCode\`, are
sent as a string. Each enum's table shows the value sent, beside the member's
name and description. An enum whose members combine as bit flags is an \`integer\`, with
its members listed on the schema.

## Channel properties

Each channel card shows some of these properties, which JSON Schema has no
field for. The key in brackets is the one the AsyncAPI document carries. A
property that is absent was not stated.

- Delivery (\`x-sitrep-delivery\`), on a telemetry channel. "Latest value only"
  (\`lossy-latest\`) keeps only the newest value, so a client that falls behind
  sees the latest state and none of the ones it missed. "Every value, in order"
  (\`reliable-ordered\`) sends every value, in order, and carries occurrences
  such as \`flight.started\` that a client must not drop
- Delay (\`x-sitrep-delay-role\`), on a telemetry channel. "After signal delay"
  (\`delayed\`) means the value is what this connection's command centre knew one
  signal delay ago (see \`set-vantage\`). "Live" (\`true-now\`) means it is not
  delayed, as for a fact on the ground such as whether the SCANsat assembly is
  installed
- Held at home (\`x-sitrep-held-at-home\`), on a delayed telemetry channel: the
  value is held at the home command centre (the career ledger, the space
  centre's records) and not aboard a craft. Each command centre receives a change
  after its own delay to home, so the value it holds is already as current as
  it can be there, and a client subtracts no further signal delay
- Samples (\`x-sitrep-sample-kind\`), on a telemetry channel. "Continuous"
  (\`continuous\`) values change between samples, so a client may draw a line or
  interpolate. "Holds until changed" (\`discrete\`) values hold until the next
  sample, so a client draws a step. "One per event" (\`event\`) is one occurrence
  per sample, so a client draws points
- Repeats (\`x-sitrep-keyframe-interval-ut\`), on a telemetry channel: the
  seconds of game time after which the channel sends its value again with
  nothing changed, so a late subscriber or a reconnect recovers without waiting
  for a change. Game time runs up to 100000 times faster than real time under
  time warp and stops while the game is paused, so measure staleness by
  \`meta.validAt\` and not by a real-time timer
- Empty is an answer (\`x-sitrep-absence-is-data\`), on a telemetry channel: an
  empty value is a real answer and is sent from the first tick (no target
  selected, no crew aboard). Without it the channel sends nothing until it has
  had a real value, so silence means "not yet" and not "none"
- Takes effect (\`x-sitrep-delayed\`), on a command: "when sent", or "after the
  signal delay" for a command that travels from the command centre before it
  runs. The card's description says where it goes
- Receipt, on a delayed command: when its signal delay is more than zero, a
  \`command-accepted\` frame arrives as the command leaves, and the
  \`command-response\` arrives once it has run
- No fields (\`x-sitrep-empty\`), on a schema: the payload is an empty object,
  as for a command that takes no arguments

## Channels not listed here

- Channels named per subject, such as \`trackingStation.vessel.<id>.<field>\`,
  \`currency.<id>.<currency>\` and per-vessel part actions. The mod creates them
  while the game runs, one set per subject, so they cannot be listed here.
  Subscribe to one by its full name, with the subject's id filled in
- Each installed Uplink's own channels and commands, which that Uplink
  documents

A shared prefix does not put two channels in the same group:
\`trackingStation.catalog\` is listed here, and
\`trackingStation.vessel.<id>.<field>\` is named per subject and is not.`;
}

/**
 * Every frame type on the socket, with what it is for.
 *
 * The lists are checked against the contract by {@link assertFramesMatchContract}:
 * a frame interface the contract declares that is in neither list, or a type
 * named here that the contract does not declare, fails the build.
 */
const FRAMES_FROM_MOD = [
  ["stream-data", "a subscribed topic's value"],
  [
    "stream-binary",
    "a subscribed topic's value as raw bytes, for a channel that uses the binary lane",
  ],
  ["event", "something that happened to a subscription"],
  ["command-response", "the result of a command"],
  [
    "command-accepted",
    "the receipt for a delayed command, sent before its result",
  ],
  ["error", "a request the mod refused or could not read"],
  ["hello", "the first frame on every connection"],
  ["game-state", "what the game is doing: loading, ready or no game"],
  ["pong", "the answer to a ping"],
];

const FRAMES_FROM_CLIENT = [
  ["subscribe", "start receiving a channel"],
  ["unsubscribe", "stop receiving a channel"],
  [
    "set-vantage",
    "choose the command centre this connection observes from and commands from",
  ],
  ["claim", "ask for the answers to commands sent on an earlier connection"],
  ["ping", "ask whether the connection is alive"],
  ["command-request", "send one command"],
  ["command-group", "send several delayed commands to one craft as a unit"],
];

/** The frame interfaces of the contract, keyed by the constant their `type` field carries. */
function frameInterfaces(contract) {
  const frames = new Map();
  for (const [name, declaration] of contract.interfaces) {
    const type = declaration.fields.find((f) => f.name === "type");
    if (type?.type.k === "literal") frames.set(type.type.v, name);
  }
  return frames;
}

/** That the two lists above name exactly the frame types the contract declares. */
function assertFramesMatchContract(contract) {
  const declared = new Set(frameInterfaces(contract).keys());
  const listed = new Set([
    ...FRAMES_FROM_MOD.map(([type]) => type),
    ...FRAMES_FROM_CLIENT.map(([type]) => type),
  ]);
  const unlisted = [...declared].filter((type) => !listed.has(type));
  const unknown = [...listed].filter((type) => !declared.has(type));
  if (unlisted.length > 0 || unknown.length > 0) {
    throw new Error(
      `asyncapi: the frame lists in scripts/asyncapi/document.mjs disagree with the contract. ` +
        `Declared but not listed: ${unlisted.join(", ") || "none"}. ` +
        `Listed but not declared: ${unknown.join(", ") || "none"}. ` +
        "Add the frame to FRAMES_FROM_MOD or FRAMES_FROM_CLIENT, and give it a message in the document.",
    );
  }
}

const frameList = (frames) =>
  frames.map(([type, purpose]) => `- \`${type}\`: ${purpose}`).join("\n");

const SESSION_DESCRIPTION = `Frames that belong to the connection and not to any one channel.

\`subscribe\` and \`unsubscribe\` name a topic and open or close delivery on it.
\`set-vantage\` selects the command centre this connection sends commands from
and observes at, which sets what it reads and how long its commands take.
\`claim\` names the commands a reconnecting client is still waiting on, so the
mod sends their answers to the new connection.
The mod opens every connection with a \`hello\` naming the run it has reached,
and answers a \`ping\` with a \`pong\` at once in any scene, even with nothing
subscribed. A client uses that to tell a quiet connection from a dead one.
An \`error\` frame carries a code and, when it answers a dispatch, the
\`requestId\` it refers to.

This channel has no \`address\`. Its frames are told apart by their own \`type\`
field.`;

/** The contract's own summary for an envelope, followed by the protocol detail written here. */
function withContractProse(contract, name, detail) {
  const declared = contract.interfaces.get(name)?.description;
  return declared ? `${declared}\n\n${detail}` : detail;
}

const STREAM_DATA_DESCRIPTION = `\`topic\` is the channel's \`address\` and \`payload\` is that channel's own
shape. Each channel's \`stream-data\` message fixes both. \`meta\` is stamped by
the mod on every frame and describes the delivery, not the value: \`validAt\`,
\`deliveredAt\` and staleness are there.`;

const COMMAND_REQUEST_DESCRIPTION = `\`command\` is the channel's \`address\` and \`args\` is that command's own args
type. Each command's \`command-request\` message fixes both. The answer comes back
as a \`command-response\` with the same \`requestId\`, or as an \`error\` frame if
the mod refused it or could not read it. \`label\` and \`topic\` are required but
free, and \`sentAt\` may be 0.`;

const COMMAND_RESPONSE_DESCRIPTION = `\`result\` is the command's own reply type, fixed by that command's
\`command-response\` message. A command that ran and was refused arrives here
with \`success: false\` and an \`errorCode\`. A command the mod could not read
is answered with an \`error\` frame instead.

There is no \`command\` field. \`requestId\` is the only link back to the
command, and a delayed command's answer can arrive minutes after it.`;

const inboundFrameDescription =
  () => `Every frame the mod sends, told apart by \`type\`.

${frameList(FRAMES_FROM_MOD)}

Each one fixes \`type\` to a constant, so a JSON Schema validator selects the
right one from \`type\` alone. The \`discriminator\` beside this is the AsyncAPI
Schema keyword, a plain string naming that property. It is not OpenAPI 3's
\`discriminator\` object, so \`propertyName\` and \`mapping\` do not apply here.
\`stream-binary\` is described by its JSON header; see the document description
for the bytes that follow it.`;

const CORRELATION_DESCRIPTION =
  "A command and its answer are matched on `requestId`, not on order: " +
  "responses may arrive in a different order from the commands, and a " +
  "delayed command's answer can arrive minutes after it.";

/** A `Meta` the examples share, so all three read as one frame's worth of traffic. */
const EXAMPLE_META = {
  source: "system",
  validAt: 1_842_006.5,
  seq: 918,
  deliveredAt: 1_842_006.5,
  vantage: "ground:Kerbal Space Center",
  quality: 1,
  active: true,
  staleness: 0,
  timelineEpoch: 3,
  sampleId: 4127,
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
    meta: { source: "vessel:8f2c1d40-97ab-4a2e-9c1f-6d0b3e5a7c11" },
  },
  meta: EXAMPLE_META,
};

const EXAMPLE_COMMAND_REQUEST = {
  type: "command-request",
  requestId: "0f3c9a12",
  command: EXAMPLE_COMMAND,
  label: "Throttle 40%",
  topic: "vessel.control",
  vantage: "ground:Kerbal Space Center",
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
  if (disposition.kind) out["x-sitrep-sample-kind"] = disposition.kind;
  if (disposition.keyframeIntervalUt !== undefined) {
    out["x-sitrep-keyframe-interval-ut"] = disposition.keyframeIntervalUt;
  }
  if (disposition.absenceIsData !== undefined) {
    out["x-sitrep-absence-is-data"] = disposition.absenceIsData;
  }
  if (disposition.heldAtHome !== undefined) {
    out["x-sitrep-held-at-home"] = disposition.heldAtHome;
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
  assertFramesMatchContract(contract);
  const frames = frameInterfaces(contract);
  const field = (typeName, fieldName) =>
    schemas.fieldSchema(fieldOf(contract, typeName, fieldName), typeName);

  const streamData = schemas.define("StreamData", {
    type: "object",
    description: withContractProse(
      contract,
      "StreamData",
      STREAM_DATA_DESCRIPTION,
    ),
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
    description: withContractProse(
      contract,
      "CommandRequest",
      COMMAND_REQUEST_DESCRIPTION,
    ),
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
      seenVesselId: field("CommandRequest", "seenVesselId"),
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
    description: withContractProse(
      contract,
      "CommandResponse",
      COMMAND_RESPONSE_DESCRIPTION,
    ),
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
        result: { success: true },
        /* The mod carries the request's `sentAt` onto the reply's `validAt`. */
        meta: {
          ...EXAMPLE_META,
          validAt: EXAMPLE_COMMAND_REQUEST.sentAt,
          seq: EXAMPLE_META.seq + 1,
          deliveredAt: EXAMPLE_META.deliveredAt + 0.4,
        },
      },
    ],
  });

  schemas.define("InboundFrame", {
    description: inboundFrameDescription(),
    discriminator: "type",
    oneOf: FRAMES_FROM_MOD.map(([type]) => {
      const name = frames.get(type);
      return name === "StreamData"
        ? streamData
        : name === "CommandResponse"
          ? commandResponse
          : schemas.ref(name);
    }),
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
  commandSummaries,
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
      claim: { $ref: "#/components/messages/claim" },
      commandGroup: { $ref: "#/components/messages/commandGroup" },
      ping: { $ref: "#/components/messages/ping" },
      hello: { $ref: "#/components/messages/hello" },
      gameState: { $ref: "#/components/messages/gameState" },
      pong: { $ref: "#/components/messages/pong" },
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
          "The first frame a client sends. Until it does the socket carries nothing but the mod's `hello`, " +
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
  messages.claim = {
    name: "claim",
    title: "Claim the answers to commands sent on an earlier connection",
    payload: schemas.ref("ClaimRequest"),
  };
  messages.commandGroup = {
    name: "command-group",
    title: "Send several delayed commands to one craft as a unit",
    payload: schemas.ref("CommandGroupRequest"),
  };
  messages.commandAccepted = {
    name: "command-accepted",
    title: "The receipt for a delayed command, sent before its result",
    payload: schemas.ref("CommandAccepted"),
    correlationId: { $ref: "#/components/correlationIds/requestId" },
  };
  messages.gameState = {
    name: "game-state",
    title: "What the game is doing: loading, ready or no game",
    payload: schemas.ref("GameState"),
  };
  messages.streamBinary = {
    name: "stream-binary",
    title: "A frame on a channel that uses the binary lane",
    contentType: "application/octet-stream",
    payload: schemas.ref("StreamBinary"),
  };
  messages.ping = {
    name: "ping",
    title: "Ask whether the connection is alive",
    payload: schemas.ref("Ping"),
  };
  messages.hello = {
    name: "hello",
    title: "The first frame on a connection, naming the run it reached",
    payload: schemas.ref("Hello"),
  };
  messages.pong = {
    name: "pong",
    title: "The answer to a ping",
    payload: schemas.ref("Pong"),
  };
  messages.event = {
    name: "event",
    title: "A named occurrence on a topic, carrying no payload of its own",
    payload: schemas.ref("EventMsg"),
  };
  messages.error = {
    name: "error",
    title: "A dispatch that could not be carried, or a bad session request",
    payload: schemas.ref("ErrorMsg"),
    correlationId: {
      description:
        "Present when the error answers a dispatch, absent when it is about the connection or a topic.",
      location: "$message.payload#/requestId",
    },
  };

  operations["session.control"] = {
    action: "send",
    channel: { $ref: "#/channels/session" },
    title:
      "Open or close delivery, change vantage, claim earlier commands' answers, send a command group, or ask whether the connection is alive",
    tags: [{ name: "session" }],
    messages: [
      { $ref: "#/channels/session/messages/subscribe" },
      { $ref: "#/channels/session/messages/unsubscribe" },
      { $ref: "#/channels/session/messages/setVantage" },
      { $ref: "#/channels/session/messages/claim" },
      { $ref: "#/channels/session/messages/commandGroup" },
      { $ref: "#/channels/session/messages/ping" },
    ],
  };
  operations["session.notices"] = {
    action: "receive",
    channel: { $ref: "#/channels/session" },
    title:
      "The greeting, the game state, the answer to a ping, and connection-scoped errors",
    description:
      "An `event` frame is not here. It names a topic and is sent only for a " +
      "topic this connection has subscribed to, so it is on the topic channels " +
      "beside their `stream-data`.",
    tags: [{ name: "session" }],
    messages: [
      { $ref: "#/channels/session/messages/hello" },
      { $ref: "#/channels/session/messages/gameState" },
      { $ref: "#/channels/session/messages/pong" },
      { $ref: "#/channels/session/messages/error" },
    ],
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

  const sharedArgs = sharedArgsCommands(commandArgs, commandSummaries);
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
        sharedArgs,
      ),
      servers: [{ $ref: `#/servers/${SERVER_KEY}` }],
      "x-sitrep-delayed": commandDispositions.get(command).delayed,
      messages: {
        commandRequest: { $ref: `#/components/messages/${requestKey}` },
        commandResponse: { $ref: `#/components/messages/${responseKey}` },
        ...(commandDispositions.get(command).delayed
          ? {
              commandAccepted: {
                $ref: "#/components/messages/commandAccepted",
              },
            }
          : {}),
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
          ...(commandDispositions.get(command).delayed
            ? [
                {
                  $ref: `#/channels/${escapeRefToken(command)}/messages/commandAccepted`,
                },
              ]
            : []),
        ],
      },
    };
  }

  return {
    asyncapi: "3.0.0",
    info: {
      title: "Gonogo WebSocket API",
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
          description: "Frames that belong to the connection, not to a channel",
        },
        ...namespaceTags(topics, commandArgs),
      ],
      externalDocs: {
        description: "Building a widget or an Uplink? Use the SDK instead",
        url: "https://ksp-gonogo.github.io/uplink-dev-docs/",
      },
    },
    defaultContentType: "application/json",
    servers: {
      [SERVER_KEY]: {
        host: "localhost:8090",
        protocol: "ws",
        title: "The Gonogo mod's telemetry socket",
        description:
          "Served by the mod inside the running game, by default at " +
          "`localhost:8090`; the host and port can be changed per install. " +
          "Connect to `ws://<host>:<port>`.",
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

/** One plain sentence per namespace: what its channels and commands are about. */
const NAMESPACE_SUMMARIES = {
  alarm: "Alarms set to fire at a game time",
  career: "Contracts, crew hiring, facilities and strategies in career mode",
  commandCentre:
    "The command centres in play and the signal delay between them",
  commcast: "Messages and groups between command centres",
  comms:
    "Antenna links, contacts and what the active vessel can be commanded to do",
  crash: "The most recent vessel crash",
  deployed: "Deployed Breaking Ground bases",
  dv: "Delta-v per stage and in total for the active vessel",
  eva: "Kerbals outside a craft",
  flight: "Flight start, end and vessel changes",
  game: "Which expansions are installed",
  isru: "Resource drills and converters",
  ksp: "Launching, reverting and recovering vessels",
  missions: "The active Making History mission",
  parts: "Rolled-up part data for the active vessel, such as power",
  recovery: "The most recent vessel recovery",
  robotics: "Robotic rotors, hinges and pistons",
  science: "Experiments, the science archive and transmission",
  settings: "The mod's own settings and those of other mods",
  spaceCenter: "Crew, launch sites and parts available at the space centre",
  system: "Reference frames, command gates and the uplink queue",
  target: "What the active vessel can target",
  time: "Game time, warp and pause",
  trackingStation: "Bodies and the vessel catalogue in the tracking station",
  vessel:
    "The active vessel: flight state, orbit, control, staging, resources and parts",
};

/**
 * The tag list: one entry per namespace, with its sentence from
 * {@link NAMESPACE_SUMMARIES}. A namespace with no sentence fails the build, so
 * a new namespace cannot ship without one.
 */
function namespaceTags(topics, commandArgs) {
  const names = new Set(
    [...topics, ...commandArgs].map(({ key }) => namespaceOf(key)),
  );
  const missing = [...names].filter((name) => !(name in NAMESPACE_SUMMARIES));
  if (missing.length > 0) {
    throw new Error(
      `asyncapi: no tag description for namespace ${missing.join(", ")}. Add one to NAMESPACE_SUMMARIES in scripts/asyncapi/document.mjs.`,
    );
  }
  const stale = Object.keys(NAMESPACE_SUMMARIES).filter((n) => !names.has(n));
  if (stale.length > 0) {
    throw new Error(
      `asyncapi: NAMESPACE_SUMMARIES names ${stale.join(", ")}, which no channel uses.`,
    );
  }
  return [...names]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => ({ name, description: NAMESPACE_SUMMARIES[name] }));
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
  if (declaration?.description) return declaration.description;
  return (
    `The contract carries no doc comment for \`${topic}\`'s payload type. ` +
    "Add a `<summary>` to the C# and it will appear here."
  );
}

/**
 * The commands whose argument type another command also uses, each with its
 * own summary. A shared type's doc comment describes the type, so it cannot
 * also say what one of its commands does; such a command must carry a
 * `[SitrepCommand(Summary = ...)]`, and the build fails if one does not.
 */
function sharedArgsCommands(commandArgs, summaries) {
  const byType = new Map();
  for (const { key, type } of commandArgs) {
    const named = namedTypeOf(type);
    if (!named) continue;
    byType.set(named, [...(byType.get(named) ?? []), key]);
  }
  const shared = new Map();
  const missing = [];
  for (const keys of byType.values()) {
    if (keys.length < 2) continue;
    for (const key of keys) {
      if (summaries.has(key)) shared.set(key, summaries.get(key));
      else missing.push(key);
    }
  }
  if (missing.length)
    throw new Error(
      `asyncapi: ${missing.join(", ")} share an args type and carry no summary. ` +
        "Give each its own [SitrepCommand(Summary = ...)] in the contract.",
    );
  return shared;
}

/**
 * A command channel's prose: its args type's doc comment, or for a command
 * that shares its args type, its own summary. Whether it is delayed is
 * `x-sitrep-delayed` on the channel.
 */
function commandChannelDescription(contract, argsType, command, shared) {
  if (shared.has(command)) return shared.get(command);
  const named = namedTypeOf(argsType);
  const declaration = named ? contract.interfaces.get(named) : undefined;
  return (
    declaration?.description ??
    `The contract carries no doc comment for \`${command}\`'s args type. ` +
      "Add a `<summary>` to the C# and it will appear here."
  );
}

function namedTypeOf(type) {
  if (type.k === "ref") return type.name;
  if (type.k === "array") return namedTypeOf(type.of);
  return undefined;
}
