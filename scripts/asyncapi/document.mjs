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
  return `The wire contract of the Gonogo mod's telemetry socket: ${counts.topics} telemetry
channels a client subscribes to and ${counts.commands} commands it sends, each with its payload
schema and description.

This document is generated from the contract's C# declarations and their doc
comments. Operations are written from the client's side: a telemetry channel is
\`receive\` and a command is \`send\`. The mod is the server.

## One socket, many channels

Every channel is multiplexed over a single WebSocket. A channel's \`address\` is
the value of the \`topic\` field on a \`stream-data\` frame, or of the \`command\`
field on a \`command-request\`. It is not a URL path, and there is no second
connection to open. The \`session\` channel carries the frames that belong to the
connection itself.

## Frames the mod sends

The mod sends four frame types, unioned as \`components.schemas.InboundFrame\`:
\`stream-data\`, \`command-response\`, \`event\` and \`error\`. Route on the \`type\`
field. Each frame type fixes \`type\` to a constant, so a JSON Schema validator can
tell them apart without the \`discriminator\` keyword. Every per-channel message
in this document is one of these four.

## Subscribing

The mod sends a topic only after the client has sent \`subscribe\` for it. A frame
emitted while nothing is subscribed is dropped, not queued, so a client that
connects and waits receives nothing.

## Units

The generated TypeScript types every quantity as \`Value<"m">\`, an object with a
magnitude and a unit. The SDK builds that object after receiving the frame. On
the wire a quantity is a bare JSON number, and its schema names the unit in
\`x-sitrep-unit\`. A command carries bare numbers as well.

## Enums

An enum is sent as its ordinal, not its name. Where the members are a closed
set, the schema is a \`oneOf\` of \`const\` values, each with the member's name and
description. A \`[Flags]\` enum is a bitwise combination of members, so its schema is an
\`integer\` and the member table is on \`x-sitrep-enum\`. \`x-sitrep-enum-kind\`
says which of the two an enum is.

## The \`x-sitrep-*\` annotations

Facts the contract states that JSON Schema and AsyncAPI have no field for. An
annotation that is absent was not stated by the declaration.

- \`x-sitrep-unit\`, on a schema: the unit the value is sent in. \`text\`,
  \`flag\`, \`id\`, \`enum\` and \`n/a\` are also tokens in this vocabulary and mean
  what they say. Absent, \`n/a\` and \`1\` are three different things
- \`x-sitrep-enum\` and \`x-sitrep-enum-kind\`, on an enum's schema: see Enums
- \`x-sitrep-delivery\`, on a telemetry channel: the outbox lane its samples use.
  \`lossy-latest\` keeps only the newest sample per topic, so a client that falls
  behind sees the latest state and none of the ones it missed.
  \`reliable-ordered\` sends every sample, in order. The \`reliable-ordered\`
  channels carry discrete occurrences such as \`flight.started\`, so a client
  must not treat them as lossy
- \`x-sitrep-delay-role\`, on a telemetry channel: \`delayed\` means the value is
  what the vantage knew one signal delay ago, not what is true now.
  \`true-now\` means it is not delayed, which suits a ground-side fact with no
  equivalent in flight, such as whether the SCANsat assembly is installed
- \`x-sitrep-sample-kind\`, on a telemetry channel: how its samples relate in
  time. \`continuous\` values change between samples, so a client may draw a
  line, interpolate, or carry the value forward with a declared model.
  \`discrete\` values hold until the next sample, so a client draws a step.
  \`event\` is one occurrence per sample, so a client draws points. A field in
  the payload may declare its own kind, which the generated SDK carries per field
- \`x-sitrep-held-at-home\`, on a \`delayed\` telemetry channel: \`true\` means the
  value is held at the home command centre (the career ledger, the space centre's
  records) and not aboard a craft. Each vantage receives a change after its own
  delay to home: zero on the ground network, and a crewed vessel's path home
  otherwise. The frame a vantage holds is already as current as it can be there,
  so a client subtracts no further signal delay
- \`x-sitrep-keyframe-interval-ut\`, on a telemetry channel: the number of UT
  seconds after which the channel sends its value again with nothing changed.
  A late subscriber, a quickload or a reconnect recovers from that frame without
  waiting for a real change. The seconds are game time. UT runs up to 100000
  times faster than wall-clock time under timewarp and stops while the game is
  paused, so a wall-clock timer sized from this number fires early under warp
  and never fires while paused. Measure staleness in UT by watching
  \`Meta.validAt\` advance. For a wall-clock bound, convert with \`warpRate\` on
  \`time.warp\`, and treat \`paused\` there as "no keyframe is due"
- \`x-sitrep-absence-is-data\`, on a telemetry channel: \`true\` means an empty
  value is a real answer and is sent from the first tick (no target selected, no
  crew aboard). Without it the channel sends nothing until it has had a real
  value, so silence means "not yet" and not "none"
- \`x-sitrep-delayed\`, on a command channel: whether the command travels over
  the uplink and takes effect after the signal delay, not when it is sent
- \`x-sitrep-empty\`, on a schema: the schema has no fields because the shape is
  "nothing", as \`NoCommandArgs\` is

## Channels not listed here

This document lists the channels declared in the core contract. Two kinds of
channel are not in it:

- Dynamic channels, whose names contain a subject: \`trackingStation.vessel.<guid>.*\`,
  \`currency.<guid>.<currency>\` and per-vessel part actions. The mod registers
  them at runtime for each subject, so the generator cannot find them in the
  contract. Read one with \`useStream(topic)\` in the SDK
- Each Uplink's own channels and commands, which are in that Uplink's contract
  slice

A shared prefix does not put two channels in the same group:
\`trackingStation.catalog\` is declared and listed here, and
\`trackingStation.vessel.<guid>.<field>\` is dynamic and is not.

## What the client adds to a frame

- A client reads absence and staleness from a state machine: never seen, not
  ours, known absent, fresh, stale, and stale with a model. The state comes from
  the client's timeline store and is not in any message shape
- A value is read relative to a vantage, a command centre, and arrives after the
  signal delay. \`validAt\` and \`deliveredAt\` differ for that reason, a command
  is delayed while a fact about the local station is not, and a stale value can
  still be worth acting on
- The reasons behind a field's shape are in the contract's doc comments, which
  this document carries into each \`description\``;
}

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

const STREAM_DATA_DESCRIPTION = `The envelope every telemetry frame arrives in.

\`topic\` is the channel's \`address\` and \`payload\` is that channel's own
shape. Each channel's \`stream-data\` message fixes both. \`meta\` is stamped by
the mod on every frame and describes the delivery, not the value: \`validAt\`,
\`deliveredAt\` and staleness are there.`;

const COMMAND_REQUEST_DESCRIPTION = `The envelope every command is sent in.

\`command\` is the channel's \`address\` and \`args\` is that command's own args
type. Each command's \`command-request\` message fixes both. The answer comes back
as a \`command-response\` with the same \`requestId\`, or as an \`error\` frame if
the mod could not carry the command.`;

const COMMAND_RESPONSE_DESCRIPTION = `The envelope every answer to a command arrives in.

\`result\` is the command's own reply type, fixed by that command's
\`command-response\` message. A command that ran and was refused arrives here
with \`success: false\` and an \`errorCode\`. A command the mod could not carry
arrives as an \`error\` frame on the session channel.

There is no \`command\` field. \`requestId\` is the only link back to the
command, and a delayed command's answer can arrive minutes after it.`;

const INBOUND_FRAME_DESCRIPTION = `Every frame the mod sends, told apart by \`type\`.

\`stream-data\` carries a subscribed topic's value, \`command-response\` answers a
command, \`event\` reports something that happened to a subscription, and
\`error\` reports a request the mod could not carry. Every per-channel message in
this document is one of these four.

Each one fixes \`type\` to a constant, so a JSON Schema validator selects the
right one from \`type\` alone. The \`discriminator\` beside this is the AsyncAPI
Schema keyword, a plain string naming that property. It is not OpenAPI 3's
\`discriminator\` object, so \`propertyName\` and \`mapping\` do not apply here.`;

const CORRELATION_DESCRIPTION =
  "A command and its answer are matched on `requestId`, not on order: " +
  "responses may arrive in a different order from the commands, and a " +
  "delayed command's answer can arrive minutes after it.";

/** A `Meta` the examples share, so all three read as one frame's worth of traffic. */
const EXAMPLE_META = {
  source: "gonogo",
  validAt: 1_842_006.5,
  seq: 918,
  deliveredAt: 1_842_006.5,
  vantage: "ground:Kerbal Space Center",
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
      claim: { $ref: "#/components/messages/claim" },
      ping: { $ref: "#/components/messages/ping" },
      hello: { $ref: "#/components/messages/hello" },
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
      "Open or close delivery, change vantage, claim earlier commands' answers, or ask whether the connection is alive",
    tags: [{ name: "session" }],
    messages: [
      { $ref: "#/channels/session/messages/subscribe" },
      { $ref: "#/channels/session/messages/unsubscribe" },
      { $ref: "#/channels/session/messages/setVantage" },
      { $ref: "#/channels/session/messages/claim" },
      { $ref: "#/channels/session/messages/ping" },
    ],
  };
  operations["session.notices"] = {
    action: "receive",
    channel: { $ref: "#/channels/session" },
    title: "The greeting, the answer to a ping, and connection-scoped errors",
    description:
      "An `event` frame is not here. It names a topic and is sent only for a " +
      "topic this connection has subscribed to, so it is on the topic channels " +
      "beside their `stream-data`.",
    tags: [{ name: "session" }],
    messages: [
      { $ref: "#/channels/session/messages/hello" },
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
          description: "Frames that belong to the connection, not to a channel",
        },
        ...namespaceTags(topics, commandArgs),
      ],
      externalDocs: {
        description: "Writing an Uplink: the plugin half and the client half",
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
