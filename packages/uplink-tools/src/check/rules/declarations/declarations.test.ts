import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  declarationsOf as declarationsFor,
  emitDeclarations,
  normalizeFamily,
} from "../../emit";
import { scanFiles } from "../../fixture";
import { loadTypeScript, type TypeScript } from "../../program";
import { declarationRules } from ".";

let ts: TypeScript;
beforeAll(async () => {
  ts = await loadTypeScript(import.meta.dirname);
});

const PREFIXES = ["fleet.", "silence.", "vessel.partActions."];

/** A widget whose body and registration extras are the planted fault. */
const run = (rule: string, body: string, registration = "", extra = "") => {
  const scan = scanFiles(ts, {
    "w.tsx": `import { registerComponent, useTelemetry, useStream, useCommand } from "./hooks";
${extra}
function Widget(props: { topic: string }) {
${body}
  return null;
}
registerComponent({ id: "w", component: Widget${registration ? `, ${registration}` : ""} });
`,
  });
  return declarationRules
    .filter((r) => r.id === `declarations/${rule}`)
    .flatMap((r) =>
      r.check({ clientDir: "/client", scan, dynamicPrefixes: PREFIXES }),
    );
};

describe("required-unread", () => {
  it("fails a required Topic nothing reads", () => {
    const found = run(
      "required-unread",
      `useTelemetry("vessel.flight");`,
      `channels: ["vessel.flight", "vessel.identity"]`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", fixable: false });
    expect(found[0].message).toContain("vessel.identity");
  });

  it("fails a required family nothing reads", () => {
    const found = run(
      "required-unread",
      `useTelemetry("vessel.flight");`,
      `channelFamilies: ["fleet.<vessel>.contact"]`,
    );
    expect(found).toHaveLength(1);
  });

  it("passes when every required entry is read, whatever the placeholder is called", () => {
    const found = run(
      "required-unread",
      `useTelemetry("vessel.flight"); useStream(\`fleet.$${"{"}props.topic}.contact\`);`,
      `channels: ["vessel.flight"], channelFamilies: ["fleet.<id>.contact"]`,
    );
    expect(found).toEqual([]);
  });

  it("says nothing when an unresolved read means the scan cannot prove it", () => {
    const found = run(
      "required-unread",
      `useStream(props.topic);`,
      `channels: ["vessel.flight"]`,
    );
    expect(found).toEqual([]);
  });

  it("says nothing for a widget whose reads follow its settings, which the scan cannot list", () => {
    const found = run(
      "required-unread",
      `// gonogo:reads config\n  useStream(props.topic);`,
      `channels: ["vessel.flight"]`,
    );
    expect(found).toEqual([]);
  });
});

describe("field-not-read", () => {
  it("fails a field whose Topic is not read", () => {
    const found = run(
      "field-not-read",
      `useTelemetry("vessel.flight");`,
      `fields: ["vessel.flight.altitude", "vessel.identity.name"]`,
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("vessel.identity.name");
  });

  it("passes fields of read Topics and of read families", () => {
    const found = run(
      "field-not-read",
      `useTelemetry("vessel.flight"); useStream(\`fleet.$${"{"}props.topic}.contact\`);`,
      `fields: ["vessel.flight", "vessel.flight.altitude", "fleet.abc.contact.state"]`,
    );
    expect(found).toEqual([]);
  });
});

/** A frame that reads nothing itself, its built-in augment declaring `augmentChannels`, with `marker` written above the registration. */
const frame = (
  rule: string,
  marker: string,
  registration: string,
  augmentChannels = `["career.status"]`,
) => {
  const scan = scanFiles(ts, {
    "w.tsx": `import { registerComponent, registerAugment } from "./hooks";
function Widget() {
  return null;
}
registerAugment({ id: "w-contracts", augments: "w.source", component: Widget, channels: ${augmentChannels} });
${marker}
registerComponent({ id: "w", component: Widget, ${registration} });
`,
  });
  return declarationRules
    .filter((r) => r.id === `declarations/${rule}`)
    .flatMap((r) =>
      r.check({ clientDir: "/client", scan, dynamicPrefixes: PREFIXES }),
    );
};

describe("gonogo:augment-reads", () => {
  const MARKER = "// gonogo:augment-reads w-contracts career.status";
  const REGISTRATION = `channels: ["career.status"], fields: ["career.status.contracts.active"]`;

  it("lets a frame keep channels and fields that only its built-in augment reads", () => {
    expect(frame("required-unread", MARKER, REGISTRATION)).toEqual([]);
    expect(frame("field-not-read", MARKER, REGISTRATION)).toEqual([]);
    expect(frame("augment-marker", MARKER, REGISTRATION)).toEqual([]);
  });

  it("fails a marker naming a channel the augment does not declare", () => {
    const found = frame(
      "augment-marker",
      MARKER,
      REGISTRATION,
      `["career.mode"]`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", fixable: false });
    expect(found[0].message).toContain("career.status");
  });

  it("does not let a marker excuse a channel the augment does not declare", () => {
    expect(
      frame("required-unread", MARKER, REGISTRATION, `["career.mode"]`),
    ).toHaveLength(1);
  });

  it("fails a marker naming an augment nothing registers", () => {
    const found = frame(
      "augment-marker",
      "// gonogo:augment-reads missing career.status",
      REGISTRATION,
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("missing");
  });

  it("still reports a widget without the marker", () => {
    expect(frame("required-unread", "", REGISTRATION)).toHaveLength(1);
    expect(frame("field-not-read", "", REGISTRATION)).toHaveLength(1);
  });

  it("still reports a required channel the marker does not name", () => {
    const found = frame(
      "required-unread",
      MARKER,
      `channels: ["career.status", "career.mode"]`,
      `["career.status", "career.mode"]`,
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("career.mode");
  });
});

describe("legacy-declaration", () => {
  it("warns about dataRequirements with no channels", () => {
    const found = run(
      "legacy-declaration",
      `useTelemetry("vessel.flight");`,
      `dataRequirements: ["vessel.flight"]`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "warning", fixable: false });
  });

  it("passes once channels is written", () => {
    const found = run(
      "legacy-declaration",
      `useTelemetry("vessel.flight");`,
      `dataRequirements: ["vessel.flight"], channels: ["vessel.flight"]`,
    );
    expect(found).toEqual([]);
  });
});

describe("registration-opaque", () => {
  it("fails a registration that spreads something the scan cannot read", () => {
    const found = run(
      "registration-opaque",
      `useTelemetry("vessel.flight");`,
      `...helper()`,
      `declare function helper(): object;`,
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("error");
  });

  it("passes a plain literal registration", () => {
    expect(
      run("registration-opaque", `useTelemetry("vessel.flight");`),
    ).toEqual([]);
  });
});

describe("config-read-undeclared", () => {
  const body = `// gonogo:reads config
useStream(props.topic);`;

  it("fails a config read with no channelsFromConfig", () => {
    const found = run("config-read-undeclared", body);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("error");
  });

  it("passes when channelsFromConfig is written", () => {
    const found = run(
      "config-read-undeclared",
      body,
      `channelsFromConfig: () => []`,
    );
    expect(found).toEqual([]);
  });
});

describe("directive-stale", () => {
  it("fails a directive on a call that resolves without it", () => {
    const found = run(
      "directive-stale",
      `// gonogo:reads vessel.flight
useTelemetry("vessel.flight");`,
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("without it");
  });

  it("fails a directive that points at no call", () => {
    const found = run(
      "directive-stale",
      `// gonogo:reads vessel.flight
const unrelated = 1;`,
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("no call");
  });

  it("passes a directive on a call that needed it", () => {
    const found = run(
      "directive-stale",
      `// gonogo:reads vessel.flight
useTelemetry(props.topic);`,
    );
    expect(found).toEqual([]);
  });
});

describe("family-unregistered", () => {
  const read = (prefix: string) =>
    `useStream(\`${prefix}$${"{"}props.topic}.x\`);`;

  it("fails a family under a prefix nobody registered", () => {
    const found = run("family-unregistered", read("nobody.here."));
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("nobody.here.");
  });

  it("passes a family under an sdk prefix", () => {
    expect(run("family-unregistered", read("fleet."))).toEqual([]);
  });

  it("passes a family under a prefix the client registers itself", () => {
    const scan = scanFiles(ts, {
      "w.tsx": `import { registerComponent, useStream } from "./hooks";
declare function registerDynamicTopicPrefix(prefix: string): void;
registerDynamicTopicPrefix("mine.forecast.");
function Widget(props: { topic: string }) {
  useStream(\`mine.forecast.$${"{"}props.topic}\`);
  return null;
}
registerComponent({ id: "w", component: Widget });
`,
    });
    const found = declarationRules
      .filter((r) => r.id === "declarations/family-unregistered")
      .flatMap((r) =>
        r.check({ clientDir: "/client", scan, dynamicPrefixes: PREFIXES }),
      );
    expect(found).toEqual([]);
  });

  it("says why when the sdk's prefixes could not be read", () => {
    const scan = scanFiles(ts, {
      "w.tsx": `import { registerComponent, useStream } from "./hooks";
function Widget(props: { topic: string }) {
  useStream(\`fleet.$${"{"}props.topic}.contact\`);
  return null;
}
registerComponent({ id: "w", component: Widget });
`,
    });
    const found = declarationRules
      .filter((r) => r.id === "declarations/family-unregistered")
      .flatMap((r) =>
        r.check({
          clientDir: "/client",
          scan,
          dynamicPrefixes: [],
          dynamicPrefixesProblem: "the sdk is not installed",
        }),
      );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("the sdk is not installed");
  });

  it("fails a declared family with a placeholder inside a segment", () => {
    const found = run(
      "family-unregistered",
      `useTelemetry("vessel.flight");`,
      `channelFamilies: ["fleet.a<x>b.contact"]`,
    );
    expect(found).toHaveLength(1);
  });

  it("lets a family that starts with a placeholder through", () => {
    const found = run(
      "family-unregistered",
      `useTelemetry("vessel.flight");`,
      `channelFamilies: ["<domain>.available"]`,
    );
    expect(found).toEqual([]);
  });
});

describe("the emitter", () => {
  it("writes a family once however its placeholder is named", () => {
    const scan = scanFiles(ts, {
      "w.tsx": `import { registerComponent, useStream } from "./hooks";
function Widget(props: { a: string; b: string }) {
  useStream(\`fleet.$${"{"}props.a}.contact\`);
  useStream(\`fleet.$${"{"}props.b}.contact\`);
  return null;
}
registerComponent({ id: "w", component: Widget });
`,
    });
    const { optionalChannelFamilies } = declarationsFor(scan.widgets[0]);
    expect(optionalChannelFamilies.map(normalizeFamily)).toEqual([
      "fleet.<>.contact",
    ]);
  });

  it("leaves a required family out of the optional list", () => {
    const scan = scanFiles(ts, {
      "w.tsx": `import { registerComponent, useStream } from "./hooks";
function Widget(props: { a: string }) {
  useStream(\`fleet.$${"{"}props.a}.contact\`);
  useStream(\`silence.$${"{"}props.a}.state\`);
  return null;
}
registerComponent({ id: "w", channelFamilies: ["fleet.<vessel>.contact"], component: Widget });
`,
    });
    expect(declarationsFor(scan.widgets[0]).optionalChannelFamilies).toEqual([
      "silence.<a>.state",
    ]);
  });

  it("writes a file biome's formatter leaves alone, short lists and long ones", () => {
    const scan = scanFiles(ts, {
      "w.tsx": `import { registerComponent, useTelemetry } from "./hooks";
function Widget() {
  useTelemetry("vessel.identity");
  useTelemetry("vessel.flight");
  useTelemetry("vessel.orbit");
  useTelemetry("vessel.propulsion");
  useTelemetry("system.bodies");
  return null;
}
registerComponent({ id: "w", component: Widget });
`,
    });
    const short = scanFiles(ts, {
      "w.tsx": `import { registerComponent, useTelemetry } from "./hooks";
function Widget() {
  useTelemetry("vessel.identity");
  return null;
}
registerComponent({ id: "w", component: Widget });
`,
    });
    const root = resolve(import.meta.dirname, "../../../../../..");
    for (const widget of [scan.widgets[0], short.widgets[0]]) {
      const text = emitDeclarations(widget);
      const formatted = execFileSync(
        resolve(root, "node_modules/.bin/biome"),
        ["format", "--stdin-file-path=w.declarations.g.ts"],
        { cwd: root, input: text, encoding: "utf8" },
      );
      expect(formatted).toBe(text);
    }
    expect(emitDeclarations(scan.widgets[0])).toContain('[\n    "');
  });
});
