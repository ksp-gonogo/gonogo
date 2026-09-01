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

## This is not a list of every channel on the wire

It cannot become one. A DYNAMIC namespace (\`fleet.\`, \`silence.\`,
\`currency.\`, per-vessel part actions, and each Uplink's own) is registered at
RUNTIME and materialises its channels per subject, so no statically declared type
exists for the generator to find and nothing about it appears here. Asking this
document "is there a per-vessel X" gets a confident no about a channel that has
been published all along. An Uplink's own channels and commands are likewise
absent: they live in the Uplink's contract slice, not in the core one this
document is generated from.

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

  channels.session = {
    title: "Connection session",
    description: SESSION_DESCRIPTION,
    servers: [{ $ref: `#/servers/${SERVER_KEY}` }],
    messages: {
      subscribe: { $ref: "#/components/messages/subscribe" },
      unsubscribe: { $ref: "#/components/messages/unsubscribe" },
      setVantage: { $ref: "#/components/messages/setVantage" },
      event: { $ref: "#/components/messages/event" },
      error: { $ref: "#/components/messages/error" },
    },
  };

  messages.subscribe = {
    name: "subscribe",
    title: "Open delivery on a topic",
    payload: schemas.ref("Subscribe"),
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
    payload: schemas.ref("EventMsg"),
  };
  messages.error = {
    name: "error",
    title: "A refusal or a fault",
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
    title: "Open or close delivery, or change vantage",
    messages: [
      { $ref: "#/channels/session/messages/subscribe" },
      { $ref: "#/channels/session/messages/unsubscribe" },
      { $ref: "#/channels/session/messages/setVantage" },
    ],
  };
  operations["session.notices"] = {
    action: "receive",
    channel: { $ref: "#/channels/session" },
    title: "Connection-scoped events and errors",
    messages: [
      { $ref: "#/channels/session/messages/event" },
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
        type: "object",
        description:
          `The \`stream-data\` envelope carrying \`${topic}\`. \`meta\` is stamped ` +
          "by the mod on every frame and describes the delivery, not the value.",
        required: ["type", "topic", "payload", "meta"],
        properties: {
          type: { type: "string", const: "stream-data" },
          topic: { type: "string", const: topic },
          payload,
          meta: schemas.ref("Meta"),
        },
      },
    };
    channels[topic] = {
      address: topic,
      title: topic,
      description: channelDescription(contract, type, topic),
      servers: [{ $ref: `#/servers/${SERVER_KEY}` }],
      ...dispositionExtensions(dispositions.get(topic)),
      messages: { streamData: { $ref: `#/components/messages/${messageKey}` } },
    };
    operations[`read:${topic}`] = {
      action: "receive",
      channel: { $ref: `#/channels/${escapeRefToken(topic)}` },
      title: `Read ${topic}`,
      description: `Delivered only after \`subscribe\` names \`${topic}\` on the session channel.`,
      messages: [
        { $ref: `#/channels/${escapeRefToken(topic)}/messages/streamData` },
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
    const correlationId = {
      description:
        "A dispatch and its answer are correlated on `requestId`, never on order: " +
        "responses may arrive out of the order the requests were sent, and a " +
        "delayed command's answer can be minutes behind it.",
      location: "$message.payload#/requestId",
    };

    messages[requestKey] = {
      name: "command-request",
      title: `Dispatch ${command}`,
      contentType: "application/json",
      correlationId,
      payload: {
        type: "object",
        description: `The \`command-request\` envelope for \`${command}\`, with its typed \`args\`.`,
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
          type: { type: "string", const: "command-request" },
          requestId: schemas.fieldSchema(
            fieldOf(contract, "CommandRequest", "requestId"),
          ),
          command: { type: "string", const: command },
          label: schemas.fieldSchema(
            fieldOf(contract, "CommandRequest", "label"),
          ),
          topic: schemas.fieldSchema(
            fieldOf(contract, "CommandRequest", "topic"),
          ),
          vantage: schemas.fieldSchema(
            fieldOf(contract, "CommandRequest", "vantage"),
          ),
          args: schemas.typeSchema(argsType, `command ${command} args`),
          sentAt: schemas.fieldSchema(
            fieldOf(contract, "CommandRequest", "sentAt"),
          ),
        },
      },
    };
    messages[responseKey] = {
      name: "command-response",
      title: `Reply to ${command}`,
      contentType: "application/json",
      correlationId,
      payload: {
        type: "object",
        description:
          `The \`command-response\` envelope for \`${command}\`. A resolved response ` +
          "is a command that RAN; a refusal arrives as `success: false` with an " +
          "`errorCode`, and a fault arrives as an `error` frame on the session channel.",
        required: ["type", "requestId", "result", "meta"],
        properties: {
          type: { type: "string", const: "command-response" },
          requestId: schemas.fieldSchema(
            fieldOf(contract, "CommandResponse", "requestId"),
          ),
          result: schemas.typeSchema(replyType, `command ${command} reply`),
          meta: schemas.ref("Meta"),
        },
      },
    };

    channels[command] = {
      address: command,
      title: command,
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
      messages: sortKeys(messages),
      schemas: schemas.components(),
    },
  };
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
