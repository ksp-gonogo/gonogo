/**
 * Turns the raw AsyncAPI document into what the page draws: the connection's
 * own frames, then each namespace with its telemetry channels and commands,
 * then every named schema. Each channel carries the frame the request console
 * sends for it.
 */

import { createSchemas } from "./schema.mjs";

const CHANNEL_REF = "#/channels/";
const SCHEMA_REF = "#/components/schemas/";

/**
 * The order frames are listed in: the three every channel and command card
 * depends on come first, then the rest of each direction.
 */
const FRAME_ORDER = [
  "command-request",
  "subscribe",
  "unsubscribe",
  "set-vantage",
  "claim",
  "ping",
  "command-group",
  "stream-data",
  "command-response",
  "command-accepted",
  "event",
  "error",
  "hello",
  "game-state",
  "pong",
  "stream-binary",
];
const MESSAGE_REF = "#/components/messages/";
const SESSION = "session";

function unescapePointer(segment) {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** Titles for the frame types the document has no message of their own for. */
const FRAME_TITLES = {
  "command-request": "Send one command",
  "stream-data": "A subscribed channel's value",
  "command-response": "The answer to a command",
};

export function buildModel(doc) {
  const schemas = createSchemas(doc);
  const messages = doc.components?.messages ?? {};

  const message = (ref) =>
    typeof ref?.$ref === "string" && ref.$ref.startsWith(MESSAGE_REF)
      ? messages[ref.$ref.slice(MESSAGE_REF.length)]
      : ref;

  /** The narrowed property an envelope's second `allOf` part fixes, such as a stream frame's `payload`. */
  const narrowed = (msg, property) =>
    msg?.payload?.allOf?.find((part) => part.properties?.[property])
      ?.properties[property];

  const namespaceOf = new Map();
  for (const operation of Object.values(doc.operations ?? {})) {
    const ref = operation.channel?.$ref ?? "";
    if (!ref.startsWith(CHANNEL_REF)) continue;
    const key = unescapePointer(ref.slice(CHANNEL_REF.length));
    const tag = operation.tags?.[0]?.name;
    if (tag && !namespaceOf.has(key)) namespaceOf.set(key, tag);
  }

  /** The `meta` of the document's own example frame, so every example shares one. */
  const exampleMeta =
    schemas.named.StreamData?.examples?.[0]?.meta ??
    schemas.example(schemas.named.Meta);

  const tags = doc.info?.tags ?? [];
  const namespaces = new Map(
    tags
      .filter((tag) => tag.name !== SESSION)
      .map((tag) => [
        tag.name,
        { name: tag.name, description: tag.description ?? "", channels: [] },
      ]),
  );

  let sessionDescription = "";
  for (const [key, channel] of Object.entries(doc.channels ?? {})) {
    if (key === SESSION) {
      sessionDescription = channel.description ?? "";
      continue;
    }
    const entry = buildChannel(key, channel);
    const name = namespaceOf.get(key) ?? key.split(".")[0];
    if (!namespaces.has(name))
      namespaces.set(name, { name, description: "", channels: [] });
    namespaces.get(name).channels.push(entry);
  }

  for (const namespace of namespaces.values())
    namespace.channels.sort((a, b) => a.address.localeCompare(b.address));

  function buildChannel(key, channel) {
    const request = message(channel.messages?.commandRequest);
    const stream = message(channel.messages?.streamData);
    const attributes = {
      delayed: channel["x-sitrep-delayed"],
      delivery: channel["x-sitrep-delivery"],
      delayRole: channel["x-sitrep-delay-role"],
      sampleKind: channel["x-sitrep-sample-kind"],
      keyframeIntervalUt: channel["x-sitrep-keyframe-interval-ut"],
      heldAtHome: channel["x-sitrep-held-at-home"],
      absenceIsData: channel["x-sitrep-absence-is-data"],
    };
    const address = channel.address ?? key;
    if (request) {
      const args = narrowed(request, "args");
      return {
        kind: "command",
        address,
        description: channel.description ?? "",
        attributes,
        payload: args,
        result: narrowed(message(channel.messages?.commandResponse), "result"),
        acknowledged: Boolean(channel.messages?.commandAccepted),
        frame: {
          type: "command-request",
          requestId: "",
          command: address,
          label: address,
          topic: "",
          args: schemas.placeholder(args, { requiredOnly: true }) ?? {},
          sentAt: 0,
        },
      };
    }
    return {
      kind: "telemetry",
      address,
      description: channel.description ?? "",
      attributes,
      payload: stream ? narrowed(stream, "payload") : undefined,
      frame: { type: "subscribe", topic: address },
      example: stream
        ? {
            type: "stream-data",
            topic: address,
            payload: schemas.placeholder(narrowed(stream, "payload")),
            meta: exampleMeta,
          }
        : undefined,
    };
  }

  /**
   * Every frame type: each schema whose `type` is a constant. The mod sends
   * the ones `InboundFrame` lists, and a client sends the rest.
   */
  function buildFrames() {
    const fromMod = new Set(
      (schemas.named.InboundFrame?.oneOf ?? [])
        .map((option) => option.$ref?.slice(SCHEMA_REF.length))
        .filter(Boolean),
    );
    const titles = new Map(
      Object.values(messages)
        .filter((msg) => !msg.payload?.allOf)
        .map((msg) => [msg.name, msg.title]),
    );
    const examples = new Map(
      Object.values(messages)
        .filter((msg) => msg.examples?.[0]?.payload)
        .map((msg) => [msg.name, msg.examples[0].payload]),
    );
    const frames = [];
    for (const [schemaName, schema] of Object.entries(schemas.named)) {
      const type = schema.properties?.type?.const;
      if (typeof type !== "string") continue;
      const direction = fromMod.has(schemaName) ? "mod" : "client";
      frames.push({
        type,
        schemaName,
        title: titles.get(type) ?? FRAME_TITLES[type] ?? "",
        direction,
        payload: { $ref: `${SCHEMA_REF}${schemaName}` },
        frame:
          direction === "client"
            ? (examples.get(type) ?? schemas.example(schema))
            : undefined,
      });
    }
    const rank = (type) => {
      const at = FRAME_ORDER.indexOf(type);
      return at === -1 ? FRAME_ORDER.length : at;
    };
    return frames.sort((a, b) => rank(a.type) - rank(b.type));
  }

  const frames = buildFrames();
  const channelList = [...namespaces.values()].flatMap((ns) => ns.channels);
  const commandRequest = frames.find((f) => f.type === "command-request");
  const sampleCommand =
    channelList.find((c) => c.address === "time.setPaused") ??
    channelList.find((c) => c.kind === "command");
  if (commandRequest && sampleCommand)
    commandRequest.frame = sampleCommand.frame;

  const server = Object.values(doc.servers ?? {})[0];

  return {
    title: doc.info?.title ?? "API",
    version: doc.info?.version ?? "",
    description: doc.info?.description ?? "",
    externalDocs: doc.info?.externalDocs,
    license: doc.info?.license,
    server,
    session: {
      description: sessionDescription,
      sent: frames.filter((frame) => frame.direction === "client"),
      received: frames.filter((frame) => frame.direction === "mod"),
    },
    frames,
    exampleMeta,
    namespaces: [...namespaces.values()].filter(
      (namespace) => namespace.channels.length > 0,
    ),
    schemas,
  };
}
