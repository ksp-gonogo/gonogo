import { beforeAll, describe, expect, it } from "vitest";
import { CLIENT, scanFiles } from "./fixture";
import {
  createMemoryProgram,
  loadTypeScript,
  type TypeScript,
} from "./program";
import { scanClient } from "./scan";

let ts: TypeScript;
beforeAll(async () => {
  ts = await loadTypeScript(import.meta.dirname);
});

/** A template substitution, spelled so the source file need not escape it. */
const sub = (name: string) => `$${"{"}${name}}`;

const widget = (body: string, extra = "", fields = "") =>
  `import { registerComponent, useTelemetry, useStream, useStreamOptional, useCommand } from "./hooks";
${extra}
function Widget(props: { topic: string }) {
${body}
  return null;
}
registerComponent({ id: "w", component: Widget${fields} });
`;

const only = (files: Record<string, string>) => {
  const scan = scanFiles(ts, files);
  expect(scan.widgets).toHaveLength(1);
  return { scan, w: scan.widgets[0] };
};

const ids = (records: { id?: string; family?: string }[]) =>
  records.map((r) => r.id ?? r.family).sort();

describe("resolution order", () => {
  it("reads a string literal", () => {
    const { w } = only({ "w.tsx": widget(`useTelemetry("vessel.flight");`) });
    expect(ids(w.reads)).toEqual(["vessel.flight"]);
    expect(w.unresolved).toEqual([]);
  });

  it("follows a const, imported or local", () => {
    const { w } = only({
      "ids.ts": `export const FLIGHT = "vessel.flight";`,
      "w.tsx": widget(
        `useStream(FLIGHT); const local = "vessel.identity"; useStreamOptional(local);`,
        `import { FLIGHT } from "./ids";`,
      ),
    });
    expect(ids(w.reads)).toEqual(["vessel.flight", "vessel.identity"]);
  });

  it("records every member of a union of literals", () => {
    const { w } = only({
      "w.tsx": widget(
        `const kind = props.topic === "a" ? "x.a" : "x.b"; useCommand(kind);`,
      ),
    });
    expect(ids(w.commands)).toEqual(["x.a", "x.b"]);
    expect(w.unresolved).toEqual([]);
  });

  it("turns a template into a family, naming the substitution", () => {
    const { w } = only({
      "w.tsx": widget(
        `const flightId = props.topic; useStream(\`vessel.partActions.${sub("flightId")}\`);`,
      ),
    });
    expect(ids(w.reads)).toEqual(["vessel.partActions.<flightId>"]);
    expect(w.reads[0].family).toBeDefined();
  });

  it("turns a concatenation into a family", () => {
    const { w } = only({
      "w.tsx": widget(
        `const vessel = props.topic; useStream("fleet." + vessel + ".contact");`,
      ),
    });
    expect(ids(w.reads)).toEqual(["fleet.<vessel>.contact"]);
  });

  it("substitutes a literal inside a template rather than making it a family", () => {
    const { w } = only({
      "w.tsx": widget(
        `const body = "kerbin" as const; useStream(\`system.${sub("body")}.state\`);`,
      ),
    });
    expect(w.reads[0]).toMatchObject({ id: "system.kerbin.state" });
  });

  it("refuses a substitution that fills part of a segment", () => {
    const { w } = only({
      "w.tsx": widget(
        `const n = props.topic; useStream(\`vessel.part${sub("n")}\`);`,
      ),
    });
    expect(w.reads).toEqual([]);
    expect(w.unresolved[0].reason).toMatch(/whole dot-separated segment/);
  });

  it("follows a parameter to the literals its callers pass", () => {
    const { w } = only({
      "w.tsx": widget(
        `useBody("a.one"); useBody("a.two");`,
        `import { useStream as read } from "./hooks";
function useBody(topic: string) { return read(topic); }`,
      ),
    });
    expect(ids(w.reads)).toEqual(["a.one", "a.two"]);
    expect(w.unresolved).toEqual([]);
  });

  it("follows a parameter through nested call sites up to the depth limit", () => {
    const helpers = (depth: number) => {
      const fns = Array.from(
        { length: depth },
        (_, i) =>
          `function h${i}(t: string) { return ${i === 0 ? "useStream(t)" : `h${i - 1}(t)`}; }`,
      ).join("\n");
      return fns;
    };
    const reaches = only({
      "w.tsx": widget(`h2("deep.topic");`, helpers(3)),
    }).w;
    expect(ids(reaches.reads)).toEqual(["deep.topic"]);

    const tooDeep = only({
      "w.tsx": widget(`h4("deep.topic");`, helpers(5)),
    }).w;
    expect(tooDeep.reads).toEqual([]);
    expect(tooDeep.unresolved[0].reason).toMatch(/more than 3 call sites/);
  });

  it("reports a value from props, a plain string and an unreachable parameter as unresolved", () => {
    const { w } = only({
      "w.tsx": widget(
        `const bag: Record<string, string> = {};
useStream(props.topic);
useStream(bag["x"]);
useTelemetry(unusedParam(""));`,
        "declare function unusedParam(s: string): string;",
      ),
    });
    expect(w.reads).toEqual([]);
    expect(w.unresolved).toHaveLength(3);
  });

  it("reports a function parameter nothing calls", () => {
    const { w } = only({
      "w.tsx": widget(
        `Orphan;`,
        `function Orphan(t: string) { return useStream(t); }`,
      ),
    });
    expect(w.unresolved).toEqual([]);
  });
});

describe("walking from the component", () => {
  it("enters shared hooks and child components, once each", () => {
    const { w } = only({
      "shared.ts": `import { useStream } from "./hooks";
export function useShared() { return useStream("shared.read"); }`,
      "child.tsx": `import { useTelemetry } from "./hooks";
export function Child() { return useTelemetry("child.read"); }`,
      "w.tsx": widget(
        `useShared(); useShared();`,
        `import { useShared } from "./shared";
import { Child } from "./child";
export const el = Child;`,
      ).replace("return null;", "return <Child />;"),
    });
    expect(ids(w.reads)).toEqual(["child.read", "shared.read"]);
  });

  it("does not record reads of functions the widget never calls", () => {
    const { w } = only({
      "w.tsx": widget(
        `useTelemetry("used");`,
        `function unused() { return useStream("unused"); }`,
      ),
    });
    expect(ids(w.reads)).toEqual(["used"]);
  });
});

describe("registration", () => {
  it("reads the hand-written required lists", () => {
    const { w } = only({
      "w.tsx": widget(
        `useTelemetry("vessel.flight");`,
        "",
        `, channels: ["vessel.flight"], channelFamilies: ["fleet.<vessel>.contact"]`,
      ),
    });
    expect(w.registration).toMatchObject({
      id: "w",
      channels: ["vessel.flight"],
      channelFamilies: ["fleet.<vessel>.contact"],
    });
    expect(w.registration.opaque).toBeUndefined();
  });

  it("allows a spread of the generated declarations and calls any other spread opaque", () => {
    const generated = only({
      "w.declarations.g.ts": `export default { commands: [] } as const;`,
      "w.tsx": widget(
        "",
        `import read from "./w.declarations.g";`,
        ", ...read",
      ),
    });
    expect(generated.w.registration.opaque).toBeUndefined();

    const other = only({
      "w.tsx": widget("", `const extra = {};`, ", ...extra"),
    });
    expect(other.w.registration.opaque).toMatch(/spreads something other/);
  });

  it("marks a widget with a computed id opaque", () => {
    const { w } = only({
      "w.tsx": widget("", "", "").replace(
        `id: "w"`,
        "id: String(Math.random())",
      ),
    });
    expect(w.registration.opaque).toMatch(/id is not a literal/);
  });

  it("notes legacy dataRequirements", () => {
    const { w } = only({ "w.tsx": widget("", "", ", dataRequirements: []") });
    expect(w.registration.hasDataRequirements).toBe(true);
  });
});

describe("gonogo:reads directives", () => {
  it("names what an unresolvable call reads", () => {
    const { scan, w } = only({
      "w.tsx": widget(
        "  // gonogo:reads fleet.<vessel>.contact\n  useStream(props.topic);",
      ),
    });
    expect(w.unresolved).toEqual([]);
    expect(w.reads).toMatchObject([
      { family: "fleet.<vessel>.contact", directive: true },
    ]);
    expect(scan.directives).toMatchObject([{ needed: true, attached: true }]);
  });

  it("accepts a trailing directive, several values and config", () => {
    const { w } = only({
      "w.tsx": widget(
        "  useStream(props.topic); // gonogo:reads a.one, b.two config",
      ),
    });
    expect(ids(w.reads)).toEqual(["a.one", "b.two"]);
    expect(w.readsFromConfig).toBe(true);
  });

  it("applies to a call inside a multi-line statement", () => {
    const { w } = only({
      "w.tsx": widget(
        "  // gonogo:reads x.y\n  const value = [\n    useStream(props.topic),\n  ];",
      ),
    });
    expect(ids(w.reads)).toEqual(["x.y"]);
  });

  it("is flagged as not needed on a call that resolves, and unattached on none", () => {
    const { scan } = only({
      "w.tsx": widget(
        `  // gonogo:reads x.y\n  useStream("x.y");\n\n\n  // gonogo:reads lonely.topic\n  const unrelated = 1;`,
      ),
    });
    const [onCall, lonely] = scan.directives;
    expect(onCall).toMatchObject({ needed: false, attached: true });
    expect(lonely).toMatchObject({ attached: false });
  });

  it("states what an element reads, and the scan does not go into it", () => {
    const { scan, w } = only({
      "w.tsx": `import { registerComponent, useStream } from "./hooks";
function Chart(props: { source: { topic: string } }) {
  useStream(props.source.topic);
  return null;
}
function Widget() {
  return (
    // gonogo:reads vessel.flight
    <Chart source={{ topic: "vessel.flight" }} />
  );
}
registerComponent({ id: "w", component: Widget });
`,
    });
    expect(w.unresolved).toEqual([]);
    expect(ids(w.reads)).toEqual(["vessel.flight"]);
    expect(scan.directives).toMatchObject([{ needed: true, attached: true }]);
  });

  it("takes a JSX comment as a directive, and none above an element reaches its siblings", () => {
    const { w } = only({
      "w.tsx": `import { registerComponent, useStream } from "./hooks";
function Chart() {
  useStream("a.chart");
  return null;
}
function Other() {
  useStream("a.other");
  return null;
}
function Widget() {
  return (
    <>
      {/* gonogo:reads config */}
      <Chart />
      <Other />
    </>
  );
}
registerComponent({ id: "w", component: Widget });
`,
    });
    expect(ids(w.reads)).toEqual(["a.other"]);
    expect(w.readsFromConfig).toBe(true);
  });

  it("is validated like a resolved read", () => {
    const { w } = only({
      "w.tsx": widget(
        "  // gonogo:reads vessel.part<id>x\n  useStream(props.topic);",
      ),
    });
    expect(w.reads).toEqual([]);
    expect(w.unresolved[0].reason).toMatch(/directive names/);
  });
});

describe("a manifest's channels", () => {
  it("reads a list through defineTopicManifest", () => {
    const { w } = only({
      "w.tsx": `import { registerComponent, useTelemetry } from "./hooks";
declare function defineTopicManifest(def: object): { channels: string[] };
const topics = defineTopicManifest({ channels: ["vessel.flight"] });
function Widget() {
  useTelemetry("vessel.flight");
  return null;
}
registerComponent({ id: "w", channels: topics.channels, component: Widget });
`,
    });
    expect(w.registration.channels).toEqual(["vessel.flight"]);
    expect(w.registration.opaque).toBeUndefined();
  });
});

describe("a value that is built by a function", () => {
  const partTopic = `const PREFIX = "vessel.partActions.";
function partTopic(flightId: number) {
  return \`$\{PREFIX}$\{flightId}\`;
}`;

  it("reads a family out of a helper's returned template", () => {
    const { w } = only({
      "w.tsx": widget("  useStream(partTopic(props.topic.length));", partTopic),
    });
    expect(ids(w.reads)).toEqual(["vessel.partActions.<flightId>"]);
    expect(w.unresolved).toEqual([]);
  });

  it("reads every literal a helper can return", () => {
    const { w } = only({
      "w.tsx": widget(
        '  useCommand(commandFor(props.topic) ?? "");',
        `function commandFor(name: string): string | null {
  if (name === "a") return "x.a";
  switch (name) {
    case "b":
      return "x.b";
  }
  return null;
}`,
      ),
    });
    expect(ids(w.commands)).toEqual(["x.a", "x.b"]);
    expect(w.unresolved).toEqual([]);
  });

  it("takes both branches of a conditional and drops null and the empty string", () => {
    const { w } = only({
      "w.tsx": widget(
        `  const on = props.topic === "a";
  useStream(on ? "x.a" : null);
  const picked: "x.b" | undefined = props.topic ? "x.b" : undefined;
  useStream(picked ?? "x.d");
  useStream(props.topic ? "x.c" : "");`,
      ),
    });
    expect(ids(w.reads)).toEqual(["x.a", "x.b", "x.c", "x.d"]);
  });

  it("gives up on a call to a function it cannot see into", () => {
    const { w } = only({
      "w.tsx": widget(
        "  useStream(lookup(props.topic));",
        "declare function lookup(name: string): string;",
      ),
    });
    expect(w.unresolved[0].reason).toMatch(/CallExpression/);
  });

  it("stops at a function that calls itself", () => {
    const { w } = only({
      "w.tsx": widget(
        "  useStream(loop(props.topic));",
        "function loop(name: string): string {\n  return loop(name);\n}",
      ),
    });
    expect(w.unresolved[0].reason).toMatch(/itself/);
  });
});

describe("a handle, a series key and a processor", () => {
  const SERIES = `declare function useSeriesReadings(handle: object, windowSec: number): unknown;
declare function useDataSeries(key: string, windowSec: number): unknown;
declare function useProcessor(handle: object): unknown;
declare const CLIENT_HANDLE: { registerProcessor(def: object): object };
declare function defineProcessor(def: object): object;`;

  it("follows a handle through the parameters of the helper it is passed to", () => {
    const { w } = only({
      "w.tsx": widget(
        `  useTwo({ topic: "a.x" }, { topic: "b.y", field: "f" });`,
        `${SERIES}
function useTwo(first: { topic: string }, second: { topic: string; field?: string }) {
  useSeriesReadings(first, 1);
  useSeriesReadings(second, 1);
}`,
      ),
    });
    expect(ids(w.reads)).toEqual(["a.x", "b.y"]);
    expect(w.unresolved).toEqual([]);
  });

  it("leaves a handle that comes from props unresolved", () => {
    const { w } = only({
      "w.tsx": widget("  useSeriesReadings(props, 1);", SERIES),
    });
    expect(w.unresolved[0].reason).toMatch(/never passed a handle/);
  });

  it("reads the Topic a series key begins with", () => {
    const scan = scanFiles(
      ts,
      {
        "w.tsx": widget(
          `  useDataSeries("vessel.orbit.sma", 1);
  useDataSeries(\`vessel.resources.resources.$\{props.topic}.current\`, 1);`,
          SERIES,
        ),
      },
      { topicIds: ["vessel.orbit", "vessel.resources", "vessel"] },
    );
    const [w] = scan.widgets;
    expect(ids(w.reads)).toEqual(["vessel.orbit", "vessel.resources"]);
    expect(w.unresolved).toEqual([]);
  });

  it("reports a series key that begins with no known Topic", () => {
    const scan = scanFiles(
      ts,
      { "w.tsx": widget(`  useDataSeries("nothing.here.x", 1);`, SERIES) },
      { topicIds: ["vessel.orbit"] },
    );
    expect(scan.widgets[0].unresolved[0].reason).toMatch(
      /does not begin with a Topic id/,
    );
  });

  it("reads the sdk's TopicId type when no list is given", () => {
    const files = {
      "/node_modules/@ksp-gonogo/sitrep-sdk/index.d.ts": `export interface TopicPayloadMap { "vessel.orbit": object; "time.warp": object }
export type TopicId = keyof TopicPayloadMap;`,
      [`${CLIENT}/src/w.tsx`]: `
declare function useDataSeries(key: string, windowSec: number): unknown;
declare function registerComponent(def: object): void;
function Widget() {
  useDataSeries("vessel.orbit.sma", 1);
  return null;
}
registerComponent({ id: "w", component: Widget });
`,
    };
    const scan = scanClient(ts, createMemoryProgram(ts, files), {
      clientDir: CLIENT,
    });
    expect(ids(scan.widgets[0].reads)).toEqual(["vessel.orbit"]);
  });

  it("reads a processor's inputs from defineProcessor or an Uplink client's registerProcessor", () => {
    const { w } = only({
      "w.tsx": widget(
        "  useProcessor(FACTS);\n  useProcessor(SUMMARY);",
        `${SERIES}
const FACTS = CLIENT_HANDLE.registerProcessor({ id: "f", deps: [{ reading: "system.bodies" }] as const });
const SUMMARY = defineProcessor({ id: "s", deps: [FACTS, "dv.stages"] as const });`,
      ),
    });
    expect(ids(w.reads)).toEqual([
      "dv.stages",
      "system.bodies",
      "system.bodies",
    ]);
    expect(w.unresolved).toEqual([]);
  });
});

describe("a directive in source the client does not own", () => {
  const files = {
    "/lib/spine.ts": `declare function useTelemetryStoreOptional(): unknown;
export function walked() {
  // gonogo:reads none
  return useTelemetryStoreOptional();
}
export function neverCalled() {
  // gonogo:reads none
  return useTelemetryStoreOptional();
}
`,
    [`${CLIENT}/src/w.tsx`]: `
import { walked } from "/lib/spine";
declare function registerComponent(def: object): void;
function Widget() {
  walked();
  return null;
}
registerComponent({ id: "w", component: Widget });
`,
  };

  it("is judged only where the scan went through the function it sits in", () => {
    const scan = scanClient(ts, createMemoryProgram(ts, files), {
      clientDir: CLIENT,
    });
    expect(scan.directives).toMatchObject([
      { file: "/lib/spine.ts", line: 3, attached: true, needed: true },
    ]);
    expect(scan.widgets[0].unresolved).toEqual([]);
  });
});
