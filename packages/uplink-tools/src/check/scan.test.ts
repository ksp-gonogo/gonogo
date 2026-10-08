import { beforeAll, describe, expect, it } from "vitest";
import { scanFiles } from "./fixture";
import { loadTypeScript, type TypeScript } from "./program";

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
      "w.declarations.g.ts": `export const commands = [] as const;`,
      "w.tsx": widget(
        "",
        `import * as read from "./w.declarations.g";`,
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
