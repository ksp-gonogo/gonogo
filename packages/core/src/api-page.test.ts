import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildModel } from "../../../docs/api/template/lib/model.mjs";
import { renderPage } from "../../../docs/api/template/lib/page.mjs";
import { readTokens } from "../../../docs/api/template/lib/style.mjs";

/**
 * The API page is generated from asyncapi.yaml on every deploy. What this
 * holds is that the page covers the whole document, and that every frame its
 * request console prefills is one the document says the mod accepts.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const doc = parse(readFileSync(join(ROOT, "asyncapi.yaml"), "utf8"));
const model = buildModel(doc);
const page = renderPage(doc);
const channels = model.namespaces.flatMap((namespace) => namespace.channels);

const operations: { id: string; frame: Record<string, unknown> }[] = JSON.parse(
  /<script type="application\/json" id="operations">([\s\S]*?)<\/script>/.exec(
    page,
  )?.[1] ?? "[]",
);

/** A field of a parsed JSON value, or undefined when the value is not an object or has no such field. */
function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return Object.entries(value).find(([name]) => name === key)?.[1];
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema({ $id: "doc", components: doc.components });

/** Compiles a schema from the document so its `#/components` references resolve against it. */
function validator(schema: unknown) {
  return ajv.compile(
    JSON.parse(
      JSON.stringify(schema).replaceAll('"#/components', '"doc#/components'),
    ),
  );
}

describe("the API page", () => {
  it("has a section and a console entry for every channel in the document", () => {
    const addresses = Object.keys(doc.channels).filter(
      (key) => key !== "session",
    );
    expect(channels.map((channel) => channel.address).sort()).toEqual(
      addresses.sort(),
    );
    for (const address of addresses) {
      expect(page).toContain(`id="channel-${address}"`);
      expect(operations.some((op) => op.id === `channel:${address}`)).toBe(
        true,
      );
    }
  });

  it("gives every named schema its own section, so a type link always lands", () => {
    for (const name of Object.keys(doc.components.schemas))
      expect(page).toContain(`id="schema-${name}"`);
    for (const [, target] of page.matchAll(/href="#(schema-[^"]+)"/g))
      expect(page).toContain(`id="${target}"`);
  });

  it("prefills a subscribe for a telemetry channel and a command-request for a command", () => {
    for (const channel of channels) {
      if (channel.kind === "telemetry")
        expect(channel.frame).toEqual({
          type: "subscribe",
          topic: channel.address,
        });
      else
        expect(channel.frame).toMatchObject({
          type: "command-request",
          command: channel.address,
        });
    }
  });

  it("opens a command that takes arguments with placeholders, never with values that would act on a save", () => {
    const commands = channels.filter((channel) => channel.kind === "command");
    expect(commands.length).toBeGreaterThan(0);
    for (const channel of commands) {
      const args = channel.frame.args;
      const required =
        args && typeof args === "object" ? Object.keys(args) : [];
      if (required.length === 0) continue;
      const leaves: unknown[] = [];
      const walk = (value: unknown) => {
        if (value && typeof value === "object")
          for (const inner of Object.values(value)) walk(inner);
        else leaves.push(value);
      };
      walk(args);
      for (const leaf of leaves)
        expect(
          typeof leaf === "string" && /^<.+>$/.test(leaf),
          `${channel.address}: ${JSON.stringify(leaf)} is not a placeholder`,
        ).toBe(true);
    }
  });

  it("shows a telemetry frame's shape with placeholders, not zeros that read as data", () => {
    const flight = channels.find((c) => c.address === "vessel.flight");
    expect(field(flight?.example?.payload, "latitude")).toBe(
      "<latitude: number °>",
    );
    expect(page).not.toContain('"latitude": 0,');
  });

  it("prefills every connection frame a client sends with one its schema accepts", () => {
    expect(model.session.sent.map((frame) => frame.type)).toContain(
      "subscribe",
    );
    for (const frame of model.session.sent)
      expect(validator(frame.payload)(frame.frame), frame.type).toBe(true);
  });

  it("would see a prefilled frame the schema refuses", () => {
    const validate = validator(
      doc.components.messages["commandRequest.alarm.scet.arm"].payload,
    );
    expect(
      validate({
        type: "command-request",
        requestId: "x",
        command: "alarm.scet.arm",
        label: "",
        topic: "",
        args: {},
        sentAt: 0,
      }),
    ).toBe(false);
  });

  it("connects only to the address the document's server names until the reader types another", () => {
    const host = field(field(doc.servers, "mod"), "host");
    expect(typeof host).toBe("string");
    expect(page).toContain(`id="address" value="${host}"`);
    expect(page).not.toMatch(
      /\b(?:192\.168|10\.\d+|172\.(?:1[6-9]|2\d|3[01]))\.\d+/,
    );
  });

  it("takes its dark colours and typeface from the theme tokens, and embeds no font", () => {
    const tokens = readTokens();
    for (const [local, token] of [
      ["--bg", "--color-surface-app"],
      ["--text", "--color-text-primary"],
      ["--accent", "--color-accent-bg"],
      ["--mono", "--font-family-mono"],
    ])
      expect(page).toContain(`${local}: ${tokens.get(token)};`);
    expect(page).not.toContain("base64,");
  });

  it("gives every frame type on the socket its own card, split by who sends it", () => {
    const frameTypes = Object.values(doc.components.schemas)
      .map((schema) =>
        field(field(field(schema, "properties"), "type"), "const"),
      )
      .filter((type): type is string => typeof type === "string");
    expect(frameTypes.length).toBe(16);
    for (const type of frameTypes) expect(page).toContain(`id="frame-${type}"`);
    expect(model.session.received.map((frame) => frame.type)).toContain(
      "stream-data",
    );
    expect(model.session.sent.map((frame) => frame.type)).toContain(
      "command-request",
    );
  });

  it("shows a result type many commands share once, not in every command card", () => {
    expect(page.match(/id="schema-CommandResult"/g)).toHaveLength(1);
    const commandCards =
      page.split('class="card channel channel-command"').length - 1;
    expect(commandCards).toBeGreaterThan(10);
    const extending = channels.filter(
      (channel) =>
        channel.kind === "command" &&
        channel.result &&
        !field(channel.result, "$ref"),
    ).length;
    expect(page.split('<td class="field">success').length - 1).toBe(
      1 + extending,
    );
  });

  it("never prints the mod's codename, not even as the document's own property keys", () => {
    expect(page).not.toMatch(/sitrep/i);
  });

  it("gives every id on the page to one element only", () => {
    const ids = [...page.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(repeated).toEqual([]);
  });

  it("says what each command does on its own card, even where commands share an argument type", () => {
    const commands = channels.filter((channel) => channel.kind === "command");
    expect(page).not.toContain("Same description as");
    for (const channel of commands)
      expect(
        channel.description.trim().length,
        channel.address,
      ).toBeGreaterThan(10);
    const leads = new Map<string, string[]>();
    for (const channel of commands) {
      const lead = channel.description.split("\n")[0];
      leads.set(lead, [...(leads.get(lead) ?? []), channel.address]);
    }
    const repeated = [...leads.values()].filter((list) => list.length > 1);
    expect(repeated).toEqual([]);
  });

  it("shows a walkthrough whose frames keep the rules the cards state", () => {
    const frames = [
      ...page.matchAll(/<pre class="json"><code>([\s\S]*?)<\/code><\/pre>/g),
    ]
      .map((match) =>
        match[1]
          .replaceAll("&quot;", '"')
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">")
          .replaceAll("&amp;", "&"),
      )
      .filter((text) => text.trimStart().startsWith("{"))
      .map((text) => JSON.parse(text));
    const request = frames.find(
      (f) => f.type === "command-request" && f.requestId === "pause-1",
    );
    const response = frames.find(
      (f) => f.type === "command-response" && f.requestId === "pause-1",
    );
    expect(response.meta.validAt).toBe(request.sentAt);
    const event = frames.find((f) => f.type === "event");
    const data = frames.find((f) => f.type === "stream-data");
    expect(event.meta.seq).not.toBe(data.meta.seq);
  });

  it("speaks in wire terms, not in the SDK's or the C# contract's", () => {
    const text = page
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace("Building a widget or an Uplink? Use the SDK instead", "");
    for (const word of [
      /\bSDK\b/,
      /DelayRole/,
      /\bTrueNow\b/,
      /\belected\b/,
      /\bclaimant\b/,
      /stringified/,
      /\bBinaryLane\b/,
      /TypeScript/,
    ])
      expect(text, String(word)).not.toMatch(word);
  });
});
