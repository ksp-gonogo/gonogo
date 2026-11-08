/**
 * The whole API page as one HTML string: a contents sidebar, the document
 * itself, and the request console, with its stylesheet and script inlined so
 * the page is a single file that also works saved to disk.
 *
 * The document is split into views (the start, the connection frames, one per
 * namespace, the remaining schemas). With scripts on, the page shows the view
 * holding the address in the URL's hash; with scripts off, every view shows.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { channelAnchor, createMarkdown } from "./markdown.mjs";
import { buildModel } from "./model.mjs";
import { escapeHtml, refName, schemaAnchor } from "./schema.mjs";
import { resetRule, tokenDeclarations } from "./style.mjs";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const SITE = "https://ksp-gonogo.github.io/";

/** `x-sitrep-unit` values that name a kind of value rather than a unit, left out of the Unit column. */
const NOT_UNITS = new Set(["id", "text", "flag", "enum", "n/a"]);

const DELIVERY = {
  "lossy-latest": [
    "Latest value only",
    "Only the newest value is kept, so a client that falls behind skips the ones it missed",
  ],
  "reliable-ordered": [
    "Every value, in order",
    "Every value is sent, in order, and none may be dropped",
  ],
};
const DELAY = {
  delayed: [
    "After signal delay",
    "The value is what this connection's command centre knew one signal delay ago",
  ],
  "true-now": ["Live", "The value is not delayed"],
};
const SAMPLES = {
  continuous: [
    "Continuous",
    "Values change between samples, so a line between them is fair",
  ],
  discrete: [
    "Holds until changed",
    "Each value holds until the next sample, so draw a step",
  ],
  event: ["One per event", "Each sample is one occurrence"],
};

const PROPERTIES_HREF = "#overview-channel-properties";

/** Keeps inlined JSON from closing its own script element. */
function scriptJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}

function json(value) {
  return `<pre class="json"><code>${escapeHtml(JSON.stringify(value, null, 2))}</code></pre>`;
}

function namespaceAnchor(name) {
  return `ns-${name}`;
}

function frameAnchor(type) {
  return `frame-${type}`;
}

/** A channel's name inside its own namespace's group, where the prefix is already shown. */
function shortName(address, namespace) {
  return address.startsWith(`${namespace}.`)
    ? address.slice(namespace.length + 1)
    : address;
}

export function renderPage(doc) {
  const model = buildModel(doc);
  const { schemas } = model;
  const channels = model.namespaces.flatMap((namespace) => namespace.channels);
  const frameBySchema = new Map(
    model.frames.map((frame) => [frame.schemaName, frame]),
  );

  /*
   * Where each named schema's fields are shown. A schema one card alone uses
   * is shown in that card, and the card's field block carries the schema's
   * anchor. A schema several cards share (CommandResult, Meta) is shown once
   * under Schemas, and every card links there.
   */
  const uses = new Map();
  const countUse = (schema) => {
    const holder = schema?.type === "array" ? schema.items : schema;
    const name = refName(holder?.$ref);
    if (name) uses.set(name, (uses.get(name) ?? 0) + 1);
  };
  for (const channel of channels) {
    countUse(channel.payload);
    countUse(channel.result);
  }
  const inlined = new Set();
  for (const frame of model.frames) inlined.add(frame.schemaName);

  const md = createMarkdown({
    schemaNames: new Set(Object.keys(schemas.named)),
    channelAddresses: new Set(channels.map((channel) => channel.address)),
    schemaHref: (name) =>
      frameBySchema.has(name)
        ? `#${frameAnchor(frameBySchema.get(name).type)}`
        : `#${schemaAnchor(name)}`,
    schemaDisplay: (name) => frameBySchema.get(name)?.type ?? name,
    enumMember: (name, member) => {
      const found = schemas
        .enumMembers(schemas.named[name])
        ?.find((each) => each.name.toLowerCase() === member.toLowerCase());
      if (!found) return null;
      return typeof found.value === "string"
        ? JSON.stringify(found.value)
        : `${found.value} (${found.name})`;
    },
    frameTypes: new Set(model.frames.map((frame) => frame.type)),
    frameHref: (type) => `#${frameAnchor(type)}`,
  });

  /*
   * The page shows each channel property by its card label, so the document's
   * own key names (which the AsyncAPI file needs) are taken out of the
   * overview it prints.
   */
  const overviewSource = model.description
    .replace(/ \(`x-sitrep-[\w-]+`\)/g, "")
    .replace(
      /The key in brackets is the one the AsyncAPI document carries\.\s*/g,
      "",
    )
    .replace(/\s*Each schema carries its unit as\s+`x-sitrep-unit`\./g, "");
  const firstHeading = overviewSource.search(/^## /m);
  const lede =
    firstHeading === -1
      ? overviewSource
      : overviewSource.slice(0, firstHeading);
  const reference =
    firstHeading === -1 ? "" : overviewSource.slice(firstHeading);

  function unitOf(property) {
    const target = schemas.resolve(property);
    const unit = property["x-sitrep-unit"] ?? target?.["x-sitrep-unit"] ?? "";
    return NOT_UNITS.has(unit) ? "" : unit;
  }

  function fieldCount(schema) {
    const members = schemas.enumMembers(schema);
    if (members) return `${members.length} values`;
    const count = Object.keys(schemas.objectShape(schema).properties).length;
    return count === 1 ? "1 field" : `${count} fields`;
  }

  function fieldsTable(schema, depth = 0) {
    const members = schemas.enumMembers(schema);
    if (members) return enumTable(members);
    const { properties, required } = schemas.objectShape(schema);
    const keys = Object.keys(properties);
    if (keys.length === 0)
      return schemas.resolve(schema)?.["x-sitrep-empty"]
        ? `<p class="type-line">No fields: send an empty object.</p>`
        : "";
    const rows = keys.map((key) => {
      const property = properties[key];
      const optional = required.has(key)
        ? ""
        : ` <span class="optional">optional</span>`;
      return `<tr>
<td class="field">${escapeHtml(key)}${optional}</td>
<td class="type">${schemas.typeHtml(property)}</td>
<td class="unit">${escapeHtml(unitOf(property))}</td>
<td>${md.block(property.description ?? "", { headingOffset: 4 })}${nested(property, depth)}</td>
</tr>`;
    });
    return `<div class="fields-wrap"><table class="fields">
<thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Unit</th><th scope="col">Description</th></tr></thead>
<tbody>${rows.join("")}</tbody></table></div>`;
  }

  /** An inline object, or an array of one, shown as its own table below the field; a named schema is a link instead. */
  function nested(property, depth) {
    if (depth >= 3 || property.$ref) return "";
    const inner =
      property.type === "array" || property.type?.includes?.("array")
        ? property.items
        : property;
    if (!inner || inner.$ref) return "";
    const members = schemas.enumMembers(inner);
    if (members)
      return `<details><summary>Values</summary>${enumTable(members)}</details>`;
    if (!inner.properties && !inner.allOf) return "";
    if (inner.allOf?.length === 1 && !inner.properties) return "";
    const table = fieldsTable(inner, depth + 1);
    return table ? `<details><summary>Fields</summary>${table}</details>` : "";
  }

  function enumTable(members) {
    const rows = members.map(
      (member) => `<tr>
<td class="field">${escapeHtml(JSON.stringify(member.value))}</td>
<td class="field">${escapeHtml(member.name)}</td>
<td>${md.inline(member.description)}</td>
</tr>`,
    );
    return `<div class="fields-wrap"><table class="fields">
<thead><tr><th scope="col">Value</th><th scope="col">Name</th><th scope="col">Description</th></tr></thead>
<tbody>${rows.join("")}</tbody></table></div>`;
  }

  /**
   * A payload's type on one line, then its fields in a block closed by
   * default. A schema other cards share is a link to its one section instead.
   */
  function payloadBlock(label, schema) {
    if (!schema) return "";
    const holder =
      schema.type === "array" && schema.items ? schema.items : schema;
    const name = refName(holder.$ref);
    const line = `<p class="type-line"><span class="type-label">${label}</span> <span class="type">${schemas.typeHtml(schema)}</span></p>`;
    if (name && (uses.get(name) ?? 0) > 1) return line;
    const table = fieldsTable(holder);
    if (!table) return line;
    let id = "";
    if (name && !inlined.has(name)) {
      inlined.add(name);
      id = ` id="${escapeHtml(schemaAnchor(name))}"`;
    }
    return `<details class="fields-block"${id}>
<summary><span class="type-label">${label}</span> <span class="type">${schemas.typeHtml(schema)}</span> <span class="count">${fieldCount(holder)}</span></summary>
${table}
</details>`;
  }

  function collapsedFields(schema) {
    const table = fieldsTable(schema);
    return table
      ? `<details class="fields-block"><summary><span class="type-label">Fields</span> <span class="count">${fieldCount(schema)}</span></summary>
${table}
</details>`
      : "";
  }

  function chip(label, value, title) {
    return `<a class="chip" href="${PROPERTIES_HREF}" title="${escapeHtml(title)}"><span class="chip-label">${escapeHtml(label)}</span> ${escapeHtml(value)}</a>`;
  }

  function facts(channel) {
    const a = channel.attributes;
    const chips = [];
    if (channel.kind === "command") {
      if (a.delayed !== undefined)
        chips.push(
          a.delayed
            ? chip(
                "Takes effect",
                "after the signal delay",
                "The command travels from the command centre and runs when it arrives",
              )
            : chip("Takes effect", "when sent", "The command acts at once"),
        );
      if (channel.acknowledged)
        chips.push(
          chip(
            "Receipt",
            "command-accepted when delayed",
            "When the signal delay is more than zero, a command-accepted frame arrives before the command-response",
          ),
        );
    } else {
      const pick = (table, value, label) => {
        const entry = table[value];
        if (entry) chips.push(chip(label, entry[0], entry[1]));
      };
      pick(DELIVERY, a.delivery, "Delivery");
      pick(DELAY, a.delayRole, "Delay");
      if (a.heldAtHome)
        chips.push(
          chip(
            "Held",
            "at home",
            "Held at the home command centre, not aboard a craft",
          ),
        );
      pick(SAMPLES, a.sampleKind, "Samples");
      if (a.keyframeIntervalUt !== undefined)
        chips.push(
          chip(
            "Repeats",
            `every ${a.keyframeIntervalUt} s of game time`,
            "Sent again with nothing changed after this much game time",
          ),
        );
      if (a.absenceIsData)
        chips.push(
          chip(
            "Empty",
            "is an answer",
            "An empty value is sent from the first tick and means none",
          ),
        );
    }
    return chips.length ? `<p class="facts">${chips.join("")}</p>` : "";
  }

  function tryButton(op, name) {
    return `<button class="try" type="button" data-op="${escapeHtml(op)}" aria-label="Open ${escapeHtml(name)} in the console">Open in console</button>`;
  }

  function channelCard(channel) {
    const blocks =
      channel.kind === "command"
        ? payloadBlock("Arguments", channel.payload) +
          payloadBlock("Result", channel.result)
        : payloadBlock("Payload", channel.payload);
    const example =
      channel.kind === "command" ? channel.frame : channel.example;
    const label =
      channel.kind === "command"
        ? "Shape of its command-request, with placeholder values"
        : "Shape of its stream-data frame, with placeholder values";
    const description = md.block(channel.description, { headingOffset: 4 });
    return `<article class="card channel channel-${channel.kind}" id="${escapeHtml(channelAnchor(channel.address))}">
<header>
<span class="kind kind-${channel.kind}">${channel.kind === "command" ? "Command" : "Telemetry"}</span>
<h4><code>${escapeHtml(channel.address)}</code></h4>
${tryButton(`channel:${channel.address}`, channel.address)}
</header>
${facts(channel)}
<div class="description">${description}</div>
${blocks}
${example ? `<details class="example"><summary>${label}</summary>${json(example)}</details>` : ""}
</article>`;
  }

  function frameCard(frame) {
    const button =
      frame.direction === "client"
        ? tryButton(`frame:${frame.type}`, frame.type)
        : "";
    const schema = schemas.named[frame.schemaName];
    return `<article class="card frame" id="${frameAnchor(frame.type)}">
<header>
<span class="kind kind-${frame.direction === "client" ? "command" : "telemetry"}">${frame.direction === "client" ? "Client sends" : "Mod sends"}</span>
<h4><code>${escapeHtml(frame.type)}</code></h4>
${button}
</header>
<p class="frame-title">${md.inline(frame.title)}</p>
<div class="description">${md.block(schema?.description ?? "", { headingOffset: 4 })}</div>
<div id="${escapeHtml(schemaAnchor(frame.schemaName))}">${fieldsTable(frame.payload)}</div>
</article>`;
  }

  const firstConnection = (() => {
    const [major = "0", minor = "0"] = model.version.split(".");
    const hello = {
      type: "hello",
      bootId: "5b0d6c2e",
      modVersion: "1.0.0",
      contractMajor: Number(major),
      contractMinor: Number(minor),
    };
    const gameState = { type: "game-state", state: "ready", scene: "FLIGHT" };
    const subscribe = { type: "subscribe", topic: "vessel.flight" };
    const subscribed = {
      type: "event",
      topic: "vessel.flight",
      name: "subscribed",
      keyframeIntervalUt: 30,
      meta: { ...model.exampleMeta, seq: model.exampleMeta.seq - 1 },
    };
    const sample = schemas.named.StreamData?.examples?.[0];
    const request = {
      type: "command-request",
      requestId: "pause-1",
      command: "time.setPaused",
      label: "time.setPaused",
      topic: "",
      args: { paused: true },
      sentAt: 0,
    };
    /* The mod carries the request's `sentAt` onto the reply's `meta.validAt`. */
    const exampleResponse = schemas.named.CommandResponse?.examples?.[0] ?? {};
    const response = {
      ...exampleResponse,
      requestId: "pause-1",
      meta: {
        ...(exampleResponse.meta ?? {}),
        validAt: request.sentAt,
        seq: model.exampleMeta.seq + 1,
        deliveredAt: model.exampleMeta.deliveredAt + 0.4,
      },
    };
    const snippet = `const socket = new WebSocket("ws://localhost:8090");
socket.binaryType = "arraybuffer";
const text = new TextDecoder();

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({ type: "subscribe", topic: "vessel.flight" }));
});

socket.addEventListener("message", (event) => {
  const bytes = new Uint8Array(event.data);
  if (bytes[0] === 0x9e) return; // a binary-lane frame, see stream-binary
  const frame = JSON.parse(text.decode(bytes));
  if (frame.type === "stream-data") console.log(frame.topic, frame.payload);
});`;
    return `<h2 id="first-connection">First connection</h2>
<ol class="walkthrough">
<li><p>Open a WebSocket to <code>ws://localhost:8090</code> and set its <code>binaryType</code> to <code>"arraybuffer"</code>: every frame arrives as a binary message holding UTF-8 JSON. The mod sends <a class="code-ref" href="#frame-hello"><code>hello</code></a>, then <a class="code-ref" href="#frame-game-state"><code>game-state</code></a>.</p>
${json(hello)}${json(gameState)}</li>
<li><p>Subscribe to a channel. The mod answers with an <a class="code-ref" href="#frame-event"><code>event</code></a> named <code>subscribed</code>, then sends a <a class="code-ref" href="#frame-stream-data"><code>stream-data</code></a> frame each time the value changes.</p>
${json(subscribe)}${json(subscribed)}${sample ? json(sample) : ""}</li>
<li><p>Send a command with a <code>requestId</code> of your choosing. Its answer is a <a class="code-ref" href="#frame-command-response"><code>command-response</code></a> carrying the same <code>requestId</code>. <code>label</code> and <code>topic</code> are required but free; <code>sentAt</code> may be 0.</p>
${json(request)}${json(response)}</li>
<li><p>The mod sends every frame as a binary WebSocket message holding UTF-8 JSON, so read each one as bytes. In a browser:</p>
<pre class="json"><code>${escapeHtml(snippet)}</code></pre></li>
</ol>`;
  })();

  const overviewHeadings = md.headings(reference);
  const server = model.server;

  const startView = `<section class="view" data-view="start" id="overview" aria-labelledby="overview-title">
<h1 id="overview-title">${escapeHtml(model.title)}</h1>
<div class="lede">${md.block(lede, { headingOffset: 0 })}</div>
${
  model.externalDocs
    ? `<p class="aside">${escapeHtml(model.externalDocs.description ?? "")}: <a href="${escapeHtml(model.externalDocs.url)}">the Uplink developer docs</a>.</p>`
    : ""
}
${
  server
    ? `<div class="server"><strong>${escapeHtml(server.title ?? "Server")}</strong>
<p><code>${escapeHtml(server.protocol)}://${escapeHtml(server.host)}</code></p>
${md.block(server.description ?? "", { headingOffset: 3 })}</div>`
    : ""
}
${firstConnection}
${md.block(reference, { headingOffset: 0, headingIds: "overview" })}
</section>`;

  const framesView = `<section class="view" data-view="frames" id="session" aria-labelledby="session-title">
<h2 id="session-title">Connection frames</h2>
<p class="namespace-description">Every frame on the socket. Each channel and command below travels inside one of these: telemetry in <a class="code-ref" href="#frame-stream-data"><code>stream-data</code></a>, a command in <a class="code-ref" href="#frame-command-request"><code>command-request</code></a> and its answer in <a class="code-ref" href="#frame-command-response"><code>command-response</code></a>.</p>
<h3 id="frames-client">A client sends</h3>
${model.session.sent.map(frameCard).join("\n")}
<h3 id="frames-mod">The mod sends</h3>
${model.session.received.map(frameCard).join("\n")}
</section>`;

  const namespaceViews = model.namespaces
    .map((namespace, index) => {
      const telemetry = namespace.channels.filter((c) => c.kind !== "command");
      const commands = namespace.channels.filter((c) => c.kind === "command");
      const previous = model.namespaces[index - 1];
      const next = model.namespaces[index + 1];
      const pager = `<nav class="pager" aria-label="Namespaces">${
        previous
          ? `<a href="#${namespaceAnchor(previous.name)}">Previous: <code>${escapeHtml(previous.name)}</code></a>`
          : "<span></span>"
      }${
        next
          ? `<a href="#${namespaceAnchor(next.name)}">Next: <code>${escapeHtml(next.name)}</code></a>`
          : ""
      }</nav>`;
      const group = (title, list) =>
        list.length
          ? `<h3 class="group-title">${title} <span class="count" aria-hidden="true">${list.length}</span></h3>\n${list.map(channelCard).join("\n")}`
          : "";
      return `<section class="view" data-view="${escapeHtml(namespaceAnchor(namespace.name))}" id="${escapeHtml(namespaceAnchor(namespace.name))}" aria-labelledby="${escapeHtml(namespaceAnchor(namespace.name))}-title">
<h2 id="${escapeHtml(namespaceAnchor(namespace.name))}-title"><code>${escapeHtml(namespace.name)}</code> <span class="count" aria-hidden="true">${[
        telemetry.length ? `${telemetry.length} telemetry` : "",
        commands.length
          ? `${commands.length} ${commands.length === 1 ? "command" : "commands"}`
          : "",
      ]
        .filter(Boolean)
        .join(", ")}</span></h2>
<p class="namespace-description">${md.inline(namespace.description)}</p>
${group("Telemetry", telemetry)}
${group("Commands", commands)}
${pager}
</section>`;
    })
    .join("\n");

  /* Rendered after the cards, which claim the schemas they show. */
  const remaining = Object.keys(schemas.named)
    .filter((name) => !inlined.has(name))
    .sort((a, b) => a.localeCompare(b));
  const schemaView = `<section class="view" data-view="schemas" id="schemas" aria-labelledby="schemas-title">
<h2 id="schemas-title">Shared types</h2>
<p class="namespace-description">Types that more than one channel uses, or that a field refers to. A type that one channel alone uses is shown in that channel's card.</p>
${remaining
  .map((name) => {
    const schema = schemas.named[name];
    return `<article class="card" id="${schemaAnchor(name)}">
<header><h3><code>${escapeHtml(name)}</code></h3></header>
<p class="type-line"><span class="type">${schemas.typeHtml({ ...schema, description: undefined })}</span></p>
<div class="description">${md.block(schema.description ?? "", { headingOffset: 3 })}</div>
${collapsedFields(schema)}
</article>`;
  })
  .join("\n")}
</section>`;

  const navLink = (href, text, extra = "") =>
    `<a href="${escapeHtml(href)}"${extra}>${text}</a>`;
  const navItem = (name, href, text) =>
    `<li data-name="${escapeHtml(name)}">${navLink(href, text, ` title="${escapeHtml(name)}"`)}</li>`;

  const sidebar = `<nav id="sidebar" aria-label="Contents">
<label class="sr-only" for="nav-filter">Filter the contents</label>
<input type="search" id="nav-filter" placeholder="Filter" autocomplete="off" />
<ul>
<li class="nav-group" data-view="start">${navLink("#overview", "Overview")}<ul>
${navItem("First connection", "#first-connection", "First connection")}
${overviewHeadings.map((h) => navItem(h.text, `#overview-${h.id}`, escapeHtml(h.text))).join("\n")}
</ul></li>
<li class="nav-group" data-view="frames"><details>
<summary>Connection frames</summary>
<p class="nav-sub">A client sends</p>
<ul>
${model.session.sent.map((f) => navItem(f.type, `#${frameAnchor(f.type)}`, `<code>${escapeHtml(f.type)}</code>`)).join("\n")}
</ul>
<p class="nav-sub">The mod sends</p>
<ul>
${model.session.received.map((f) => navItem(f.type, `#${frameAnchor(f.type)}`, `<code>${escapeHtml(f.type)}</code>`)).join("\n")}
</ul></details></li>
</ul>
<p class="nav-heading">Namespaces</p>
<ul>
${model.namespaces
  .map((namespace) => {
    const sub = (title, list) =>
      list.length
        ? `<p class="nav-sub">${title}</p><ul>
${list.map((c) => navItem(c.address, `#${channelAnchor(c.address)}`, escapeHtml(shortName(c.address, namespace.name)))).join("\n")}
</ul>`
        : "";
    return `<li class="nav-group" data-view="${escapeHtml(namespaceAnchor(namespace.name))}"><details>
<summary>${escapeHtml(namespace.name)} <span class="count">${namespace.channels.length}</span></summary>
${sub(
  "Telemetry",
  namespace.channels.filter((c) => c.kind !== "command"),
)}
${sub(
  "Commands",
  namespace.channels.filter((c) => c.kind === "command"),
)}
</details></li>`;
  })
  .join("\n")}
</ul>
<p class="nav-heading">Reference</p>
<ul>
<li class="nav-group" data-view="schemas"><details>
<summary>Shared types <span class="count">${remaining.length}</span></summary>
<ul>
${remaining.map((name) => navItem(name, `#${schemaAnchor(name)}`, escapeHtml(name))).join("\n")}
</ul></details></li>
</ul>
</nav>`;

  const operations = [
    ...model.session.sent.map((frame) => ({
      id: `frame:${frame.type}`,
      group: "Connection frames",
      label: frame.type,
      frame: frame.frame,
    })),
    ...model.namespaces.flatMap((namespace) =>
      [
        ...namespace.channels.filter((c) => c.kind !== "command"),
        ...namespace.channels.filter((c) => c.kind === "command"),
      ].map((channel) => ({
        id: `channel:${channel.address}`,
        group: `${namespace.name}: ${channel.kind === "command" ? "commands" : "telemetry"}`,
        label: channel.address,
        frame: channel.frame,
      })),
    ),
  ];
  const groups = [...new Set(operations.map((operation) => operation.group))];
  const options = groups
    .map(
      (group) =>
        `<optgroup label="${escapeHtml(group)}">${operations
          .filter((operation) => operation.group === group)
          .map(
            (operation) =>
              `<option value="${escapeHtml(operation.id)}">${escapeHtml(operation.label)}</option>`,
          )
          .join("")}</optgroup>`,
    )
    .join("\n");

  const defaultAddress = server?.host ?? "localhost:8090";
  const consolePanel = `<aside id="console" aria-labelledby="console-title">
<h2 id="console-title">Console</h2>
<div class="hint" id="console-hint">
<p>This console talks to the Gonogo mod's socket inside the running game, not to the app or its container. With KSP running on this computer it connects straight from this page, at <code>localhost:8090</code> by default.</p>
<p>A browser blocks a page served over https from reaching a game on another computer. For that, save this page and open the saved file.</p>
<p>Any frame can be read and edited without a game; only Send needs one.</p>
</div>
<label for="address">Game address</label>
<form id="connect-form" class="row">
<input type="text" id="address" value="${escapeHtml(defaultAddress)}" placeholder="host:port" spellcheck="false" autocomplete="off" />
<button type="submit" id="connect" class="primary">Connect</button>
</form>
<p id="status" role="status" data-state="disconnected">Not connected</p>
<p id="mixed-note" hidden>This page came over https, so the browser connects it to a game on this computer (<code>localhost</code>) but blocks a connection to a game on another computer. For that, save this page and open the saved file.</p>
<label for="frame-pick">Channel or frame</label>
<select id="frame-pick">${options}</select>
<label for="frame-body">Frame to send</label>
<p class="hint" id="placeholder-hint" hidden>Values in angle brackets are placeholders: replace each with a real value before sending.</p>
<textarea id="frame-body" rows="6" spellcheck="false"></textarea>
<p class="hint" id="request-id-hint" hidden>An empty <code>requestId</code> is filled in when you send.</p>
<p id="console-error" role="alert"></p>
<div class="row">
<button type="button" id="send" class="primary" disabled aria-describedby="send-hint">Send</button>
<button type="button" id="reset">Reset payload</button>
<span id="send-hint" class="hint">Connect to a game to send</span>
</div>
<div id="subs-section" hidden>
<h3>Subscriptions</h3>
<ul id="subs"></ul>
</div>
<h3>Frames</h3>
<div class="log-tools">
<label class="sr-only" for="log-filter">Filter frames by type or channel</label>
<input type="search" id="log-filter" placeholder="Filter" autocomplete="off" />
<label><input type="checkbox" id="pause" /> Pause</label>
<button type="button" id="clear">Clear</button>
</div>
<p id="held"></p>
<ol id="log" aria-label="Frames sent and received"><li id="log-empty" class="log-note">Frames sent and received appear here.</li></ol>
</aside>`;

  const css = readFileSync(join(ASSETS, "page.css"), "utf8");
  const script = readFileSync(join(ASSETS, "console.js"), "utf8");
  const description = `The WebSocket API of the Gonogo mod, contract version ${model.version}: every channel and command, with a console that sends frames to a running game.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Gonogo API</title>
<meta name="description" content="${escapeHtml(description)}" />
<style>
${resetRule()}
:root {
${tokenDeclarations()}
}
${css}
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
</head>
<body>
<a class="skip" href="#content">Skip to the content</a>
<header class="topbar">
<button type="button" id="nav-toggle" class="nav-toggle" aria-controls="sidebar" aria-expanded="false">Contents</button>
<a class="brand" href="${SITE}">gonogo</a>
<span class="crumb">API</span>
<span class="version">contract ${escapeHtml(model.version)}</span>
<span class="spacer"></span>
<button type="button" id="theme-toggle">Light</button>
<button type="button" id="console-toggle" class="console-toggle" aria-controls="console" aria-expanded="false">Console</button>
</header>
<div id="scrim" hidden></div>
<div class="layout">
${sidebar}
<main id="content">
<p id="hash-missing" class="notice" hidden>Nothing on this page has that address, so the overview is shown.</p>
${startView}
${framesView}
${namespaceViews}
${schemaView}
</main>
${consolePanel}
</div>
<script type="application/json" id="operations">${scriptJson(operations)}</script>
<script>
${script}
</script>
</body>
</html>
`;
}
