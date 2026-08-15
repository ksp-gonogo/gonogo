import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DashboardItemContext } from "@ksp-gonogo/core";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { ScienceDataComponent } from "./index";

/**
 * Guards the PROBE fixtures, which nothing else does.
 *
 * The widget's own tests build their payloads inline, so they stayed green
 * while `__fixtures__/*.json` still carried pre-Sitrep keys (`sci.experiments`,
 * `v.body`) that the widget stopped reading at the Sitrep migration. Every
 * render shot came out as the empty state and no test noticed, because a
 * fixture that feeds nothing is indistinguishable from a widget with nothing
 * to show unless something asserts the rows.
 *
 * So these assert what eyeballing a screenshot would have to: the channels are
 * real Topics, the two halves of each fixture tell the same story, and mounting
 * the widget on the fixture actually produces rows.
 */

const FIXTURE_DIR = join(__dirname, "__fixtures__");

/**
 * The Topic ids the contract actually generates, read off the generated
 * artifact rather than an import: the SDK does not export the list at
 * runtime, and checking against a hand-kept copy would just be a second
 * thing to drift.
 */
const TOPIC_IDS: ReadonlySet<string> = new Set(
  (
    readFileSync(
      join(
        __dirname,
        "../../../../mod/sitrep-sdk/src/__generated__/topic-map.ts",
      ),
      "utf8",
    ).split("export const GENERATED_TOPIC_IDS = [")[1] ?? ""
  )
    .split("]")[0]
    .split(",")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter(Boolean),
);

interface StreamEmit {
  channel: string;
  value: unknown;
}
interface Fixture {
  _stream?: {
    carriedChannels: string[];
    pinnedUt?: number;
    emits: StreamEmit[];
  };
  [key: string]: unknown;
}

const NAMES = [
  "kerbin-flight-partial-science",
  "career-archive-multi-body",
] as const;

function load(name: string): Fixture {
  return JSON.parse(
    readFileSync(join(FIXTURE_DIR, `${name}.json`), "utf8"),
  ) as Fixture;
}

const trees: Array<() => void> = [];
afterEach(() => {
  for (const unmount of trees) unmount();
  trees.length = 0;
});

function mount(fixture: Fixture, w = 12, h = 14): StreamFixture {
  const stream = fixture._stream;
  if (!stream) throw new Error("fixture has no _stream block");
  const f = setupStreamFixture({
    carriedChannels: stream.carriedChannels,
    pinnedUt: stream.pinnedUt ?? 10,
  });
  const result = render(
    <f.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "sci" }}>
        <ScienceDataComponent config={{}} id="sci" w={w} h={h} />
      </DashboardItemContext.Provider>
    </f.Provider>,
  );
  trees.push(result.unmount);
  act(() => {
    for (const emit of stream.emits) f.emit(emit.channel, emit.value);
  });
  return f;
}

describe.each(NAMES)("ScienceData probe fixture: %s", (name) => {
  it("emits only channels that are real Topics", () => {
    // A typo'd channel is silently ignored by the transport, which is exactly
    // how a fixture ends up feeding nothing at all.
    const stream = load(name)._stream;
    expect(stream).toBeDefined();
    // Guard the guard: a mis-parsed list would pass everything.
    expect(TOPIC_IDS.size).toBeGreaterThan(20);
    for (const emit of stream?.emits ?? []) {
      expect(
        TOPIC_IDS.has(emit.channel),
        `${emit.channel} is not a Topic`,
      ).toBe(true);
    }
  });

  it("carries every channel it emits", () => {
    // An emit on an uncarried channel is dropped: the fixture would look
    // complete on disk and still render nothing.
    const stream = load(name)._stream;
    const carried = new Set(stream?.carriedChannels ?? []);
    for (const emit of stream?.emits ?? []) {
      expect(carried.has(emit.channel), `${emit.channel} not carried`).toBe(
        true,
      );
    }
  });

  it("keeps its stream half and its legacy half telling the same story", () => {
    // Both halves are in the file; if they drift, the probe and any
    // legacy-key consumer disagree about what this fixture depicts.
    const d = load(name);
    const byChannel = new Map(
      (d._stream?.emits ?? []).map((e) => [e.channel, e.value]),
    );
    for (const [legacy, topic] of [
      ["sci.experiments", "science.experiments"],
      ["sci.experimentBreakdown", "science.experimentBreakdown"],
      ["sci.archive", "science.archive"],
    ] as const) {
      if (d[legacy] === undefined) continue;
      expect(byChannel.get(topic), `${topic} drifted from ${legacy}`).toEqual(
        d[legacy],
      );
    }
  });

  it("renders real rows, not an empty state", async () => {
    // The assertion the screenshots needed and did not have.
    mount(load(name));
    await waitFor(() =>
      expect(screen.getAllByRole("row").length).toBeGreaterThan(1),
    );
    expect(screen.queryByText(/No science data aboard/i)).toBeNull();
    expect(
      screen.queryByText(/No science collected yet this career/i),
    ).toBeNull();
  });
});

describe("ScienceData probe fixtures, read against the widget", () => {
  it("shows the flight fixture's situation line from its identity emit", async () => {
    // Proves vessel.state actually derives from what the fixture emits, rather
    // than the widget falling back to its awaiting-telemetry placeholder.
    mount(load("kerbin-flight-partial-science"));
    await waitFor(() =>
      expect(
        screen.getByLabelText("Current situation for science"),
      ).toHaveTextContent("Kerbin · Flying · Grasslands"),
    );
  });

  it("groups the archive fixture by body and experiment", async () => {
    mount(load("career-archive-multi-body"));
    // Same move the render script makes: Archive is the second tab, and this
    // fixture exists to depict it.
    await userEvent.click(screen.getByRole("tab", { name: "Archive" }));
    await waitFor(() =>
      expect(
        screen.getByRole("columnheader", { name: /Kerbin · Crew Report/ }),
      ).toBeInTheDocument(),
    );
  });
});
