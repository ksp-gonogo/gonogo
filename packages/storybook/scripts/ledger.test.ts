import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Fingerprinter, type Subject } from "./fingerprint";
import {
  fold,
  type Ledger,
  ledgerKey,
  readExport,
  readLedger,
  standing,
  writeLedger,
} from "./ledger";

const STORY = "packages/storybook/dist/stories/widgets/gauge-panel.stories.tsx";
const FIXTURE = "packages/components/src/GaugePanel/__fixtures__/nominal.json";
const VIEW = "packages/components/src/GaugePanel/View.tsx";
const HARNESS = "packages/storybook/src/WidgetScene.tsx";

const FILES: Record<string, string> = {
  "packages/components/src/GaugePanel/index.tsx": `import { registerComponent } from "@ksp-gonogo/sitrep-sdk";
import { View } from "./View";

registerComponent({ id: "gauge-panel", name: "Gauge Panel", component: View });
`,
  [VIEW]: `export function View() {
  return <p>nominal</p>;
}
`,
  [FIXTURE]: `{ "vessel.flight": { "altitude": 1200 } }\n`,
  "packages/components/src/GaugePanel/__fixtures__/cold.json": `{ "vessel.flight": null }\n`,
  [HARNESS]: `export function WidgetScene() {
  return null;
}
`,
  [STORY]: `import type { Meta, StoryObj } from "@storybook/react-vite";
import { WidgetScene } from "../../../src/WidgetScene";
import scene0 from "../../../../components/src/GaugePanel/__fixtures__/nominal.json";
import scene1 from "../../../../components/src/GaugePanel/__fixtures__/cold.json";

const meta = {
  title: "Widgets/gauge-panel",
  component: WidgetScene,
  args: { widgetId: "gauge-panel" },
} satisfies Meta<typeof WidgetScene>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Nominal: Story = {
  args: { fixture: scene0, w: 4, h: 4 },
};

export const Cold: Story = {
  args: { fixture: scene1, w: 4, h: 4 },
};
`,
};

const SUBJECT: Subject = {
  kind: "widget",
  id: "gauge-panel",
  stories: ["widgets-gauge-panel--nominal"],
};

let roots: string[] = [];

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), "review-ledger-"));
  roots.push(root);
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function edit(root: string, path: string, from: string, to: string): void {
  const file = join(root, path);
  const text = readFileSync(file, "utf8");
  expect(text).toContain(from);
  writeFileSync(file, text.replace(from, to));
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

type Print = (root: string, subject: Subject) => string;

const real: Print = (root, subject) => {
  const print = new Fingerprinter(root).fingerprint(subject);
  if ("fault" in print) throw new Error(print.fault);
  return print.hash;
};

/** A planted fingerprint that reads only the registering file, blind to the story. */
const sourceOnly: Print = (root, subject) => {
  const source = new Fingerprinter(root).sourceOf(subject);
  if ("fault" in source) throw new Error(source.fault);
  return readFileSync(source.file, "utf8");
};

/** Approves the item through an export, applies `change`, and reads how the item then stands. */
function afterApproval(print: Print, change: (root: string) => void) {
  const root = tree();
  const ledger: Ledger = {};
  fold(
    ledger,
    {
      generatedAt: "2026-09-29T00:00:00.000Z",
      sourceSha: "0".repeat(40),
      items: [
        {
          kind: "widget",
          id: "gauge-panel",
          approved: true,
          fingerprint: print(root, SUBJECT),
        },
      ],
    },
    () => null,
  );
  change(root);
  return standing(
    ledger[ledgerKey("widget", "gauge-panel")],
    print(root, SUBJECT),
  );
}

const changeStory = (root: string) =>
  edit(
    root,
    STORY,
    "w: 4, h: 4 },\n};\n\nexport const Cold",
    "w: 6, h: 4 },\n};\n\nexport const Cold",
  );

/** The check the ledger exists for: an approved item whose story changed comes back unapproved. */
const catchesStoryChange = (print: Print) =>
  afterApproval(print, changeStory) === "changed";

describe("review ledger", () => {
  it("keeps an approval while nothing the item is judged on changes", () => {
    expect(afterApproval(real, () => {})).toBe("approved");
  });

  it("unapproves an item whose story changed", () => {
    expect(catchesStoryChange(real)).toBe(true);
  });

  it("the same check fails on a planted fingerprint that ignores the story", () => {
    expect(catchesStoryChange(sourceOnly)).toBe(false);
  });

  it("unapproves an item whose fixture or component changed", () => {
    expect(
      afterApproval(real, (root) => edit(root, FIXTURE, "1200", "1300")),
    ).toBe("changed");
    expect(
      afterApproval(real, (root) => edit(root, VIEW, "nominal", "degraded")),
    ).toBe("changed");
  });

  it("keeps an approval through a comment or a reformat", () => {
    expect(
      afterApproval(real, (root) =>
        edit(root, VIEW, "return <p>", "// The nominal line.\n  return    <p>"),
      ),
    ).toBe("approved");
    expect(
      afterApproval(real, (root) =>
        edit(
          root,
          STORY,
          "export const Nominal",
          "/** The nominal scene. */\nexport const Nominal",
        ),
      ),
    ).toBe("approved");
  });

  it("keeps an approval through a change to another story or to the harness", () => {
    expect(
      afterApproval(real, (root) =>
        edit(root, STORY, "fixture: scene1, w: 4", "fixture: scene1, w: 8"),
      ),
    ).toBe("approved");
    expect(
      afterApproval(real, (root) =>
        edit(root, HARNESS, "return null", "return undefined"),
      ),
    ).toBe("approved");
  });

  it("reads the operator's first-pass export shape, which carries no fingerprints", () => {
    const root = tree();
    const file = join(root, "export.json");
    writeFileSync(
      file,
      JSON.stringify({
        generatedAt: "2026-09-28T19:53:06.509Z",
        sourceSha: "f017de9f8ddb42fe414441685918039f5e0863f4",
        items: [
          {
            kind: "widget",
            id: "gauge-panel",
            approved: true,
            comments: [{ id: "c1", text: "fine" }],
          },
        ],
      }),
    );
    const sheet = readExport(file);
    const ledger: Ledger = {};
    fold(ledger, sheet, (item) =>
      real(root, { ...item, stories: SUBJECT.stories }),
    );
    const entry = ledger[ledgerKey("widget", "gauge-panel")];
    expect(entry.fingerprint).toBe(real(root, SUBJECT));
    expect(entry.date).toBe("2026-09-28T19:53:06.509Z");
    expect(standing(entry, real(root, SUBJECT))).toBe("approved");
  });

  it("lets the later export win per item", () => {
    const ledger: Ledger = {};
    const item = {
      kind: "widget" as const,
      id: "gauge-panel",
      fingerprint: "a",
    };
    const later = {
      generatedAt: "2026-09-30T00:00:00.000Z",
      sourceSha: "b",
      items: [{ ...item, approved: true }],
    };
    const earlier = {
      generatedAt: "2026-09-29T00:00:00.000Z",
      sourceSha: "a",
      items: [{ ...item, approved: false }],
    };
    fold(ledger, later, () => null);
    expect(fold(ledger, earlier, () => null)).toEqual({
      written: 0,
      older: 1,
    });
    expect(ledger[ledgerKey("widget", "gauge-panel")].approved).toBe(true);
  });

  it("reads a missing ledger as empty, and reads back what it wrote", () => {
    const root = tree();
    const file = join(root, "local/review-ledger.json");
    expect(readLedger(file)).toEqual({});
    const ledger: Ledger = {
      "widget:gauge-panel": {
        approved: true,
        fingerprint: "a",
        date: "2026-09-29T00:00:00.000Z",
      },
    };
    writeLedger(ledger, file);
    expect(readLedger(file)).toEqual(ledger);
  });
});
