import { act, render, screen, within } from "@ksp-gonogo/sitrep-sdk/testing";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-testing";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
// Importing the real module runs its module-load registerAugment(...).
import { findDriveEntries, ScienceDataAboardRowAugment } from "./index";

const CARRIED = [
  "science.experiments",
  "science.lab",
  "kerbalism.file.send",
  "kerbalism.file.delete",
  "kerbalism.sample.analyze",
  "kerbalism.sample.dump",
  "kerbalism.sample.moveToLab",
];

const SUBJECT_ID = "mysteryGoo@KerbinInSpaceLow";

const renderedTrees: Array<() => void> = [];

function newFixture() {
  return setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
}

function renderAugment(
  fixture: ReturnType<typeof newFixture>,
  subjectId: string = SUBJECT_ID,
) {
  const result = render(
    <fixture.Provider>
      <ScienceDataAboardRowAugment subjectId={subjectId} />
    </fixture.Provider>,
  );
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const FILE_ENTRY = {
  partName: "Hard Drive",
  location: "container",
  experimentId: "mysteryGoo",
  subjectId: SUBJECT_ID,
  title: "Mystery Goo Observation in space low over Kerbin",
  situation: "InSpaceLow",
  valueModel: "kerbalism-linear",
  extensions: {
    kerbalism: {
      dataSizeMB: 12.5,
      sciencePerMB: 1.6,
      kind: "file",
      storageCapacityMB: 512,
      storageUsedMB: 90,
      sampleSlotsTotal: 2,
      sampleSlotsUsed: 1,
      transmitRateMBps: 0.004,
      transmitting: true,
      sendFlagged: true,
    },
  },
};

const SAMPLE_ENTRY = {
  partName: "Hard Drive",
  location: "container",
  experimentId: "mysteryGoo",
  subjectId: SUBJECT_ID,
  title: "Mystery Goo Observation in space low over Kerbin",
  situation: "InSpaceLow",
  valueModel: "kerbalism-linear",
  extensions: {
    kerbalism: {
      dataSizeMB: 7.5,
      sciencePerMB: 0.8,
      kind: "sample",
      sampleMass: 0.0125,
      analyze: true,
      storageCapacityMB: 512,
      storageUsedMB: 90,
      sampleSlotsTotal: 2,
      sampleSlotsUsed: 1,
      transmitRateMBps: 0,
      transmitting: false,
    },
  },
};

const LAB = [
  { partName: "Mobile Processing Lab MPL-LG-2", isOperational: true },
];

describe("findDriveEntries", () => {
  it("splits a subject's entries by kind", () => {
    const { file, sample } = findDriveEntries(
      [FILE_ENTRY, SAMPLE_ENTRY],
      SUBJECT_ID,
    );
    expect(file?.kind).toBe("file");
    expect(sample?.kind).toBe("sample");
  });

  it("ignores entries for a different subject", () => {
    const other = { ...FILE_ENTRY, subjectId: "crewReport@KerbinLaunchPad" };
    const { file, sample } = findDriveEntries([other], SUBJECT_ID);
    expect(file).toBeUndefined();
    expect(sample).toBeUndefined();
  });

  it("returns nothing for an undefined or empty array", () => {
    expect(findDriveEntries(undefined, SUBJECT_ID)).toEqual({});
    expect(findDriveEntries([], SUBJECT_ID)).toEqual({});
  });
});

describe("ScienceDataAboardRowAugment", () => {
  it("renders nothing before any science.experiments frame has arrived", () => {
    renderAugment(newFixture());
    expect(
      screen.queryByLabelText("Kerbalism file manager"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing for a subject that backs neither a file nor a sample", () => {
    const fixture = newFixture();
    renderAugment(fixture);
    act(() => {
      fixture.emit("science.experiments", [
        { ...FILE_ENTRY, subjectId: "crewReport@KerbinLaunchPad" },
      ]);
    });
    expect(
      screen.queryByLabelText("Kerbalism file manager"),
    ).not.toBeInTheDocument();
  });

  it("renders the file enrichment and Send reflecting sendFlagged", async () => {
    const fixture = newFixture();
    renderAugment(fixture);
    act(() => {
      fixture.emit("science.experiments", [FILE_ENTRY]);
    });
    await screen.findByLabelText("Kerbalism file manager");
    expect(visibleText()).toMatch(/12\.5\s*MB/);
    expect(visibleText()).toMatch(/Transmitting/);
    const sendToggle = screen.getByRole("button", {
      name: /cancel send for file/i,
    });
    expect(sendToggle).toHaveAttribute("aria-pressed", "true");
    expect(sendToggle).toHaveTextContent("Queued");
  });

  it("shows Send (not pressed) when sendFlagged is false", async () => {
    const fixture = newFixture();
    renderAugment(fixture);
    act(() => {
      fixture.emit("science.experiments", [
        {
          ...FILE_ENTRY,
          extensions: {
            kerbalism: {
              ...FILE_ENTRY.extensions.kerbalism,
              sendFlagged: false,
              transmitting: false,
            },
          },
        },
      ]);
    });
    const sendToggle = await screen.findByRole("button", {
      name: "Send file",
    });
    expect(sendToggle).toHaveAttribute("aria-pressed", "false");
    expect(sendToggle).toHaveTextContent("Send");
  });

  it("dispatches kerbalism.file.send with the desired-state flag, not a bare toggle", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();
    renderAugment(fixture);
    act(() => {
      fixture.emit("science.experiments", [
        {
          ...FILE_ENTRY,
          extensions: {
            kerbalism: {
              ...FILE_ENTRY.extensions.kerbalism,
              sendFlagged: false,
            },
          },
        },
      ]);
    });
    await user.click(await screen.findByRole("button", { name: "Send file" }));
    await Promise.resolve();
    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === "kerbalism.file.send",
    );
    expect(sent).toBeDefined();
    expect(sent?.args).toEqual({ subjectId: SUBJECT_ID, flag: true });
  });

  it("dispatches kerbalism.file.delete only after arm-then-confirm", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();
    renderAugment(fixture);
    act(() => {
      fixture.emit("science.experiments", [FILE_ENTRY]);
    });
    await user.click(
      await screen.findByRole("button", { name: "Delete file" }),
    );
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === "kerbalism.file.delete",
      ),
    ).toBeUndefined();
    await user.click(
      screen.getByRole("button", { name: "Confirm delete file" }),
    );
    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === "kerbalism.file.delete",
    );
    expect(sent).toBeDefined();
    expect(sent?.args).toEqual({ subjectId: SUBJECT_ID });
  });

  it("renders the sample enrichment and Analyze reflecting the analyze flag", async () => {
    const fixture = newFixture();
    renderAugment(fixture);
    act(() => {
      fixture.emit("science.experiments", [SAMPLE_ENTRY]);
    });
    await screen.findByLabelText("Kerbalism file manager");
    // 0.0125t rungs down to a more legible "12.50 kg" through <Unit>'s own
    // laddering, the same as any other mass quantity in the app.
    expect(visibleText()).toMatch(/12\.5\d?\s*kg/);
    const analyzeToggle = screen.getByRole("button", {
      name: /cancel analyze for sample/i,
    });
    expect(analyzeToggle).toHaveAttribute("aria-pressed", "true");
    expect(analyzeToggle).toHaveTextContent("Analyzing");
  });

  it("dispatches kerbalism.sample.analyze with the desired-state flag", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();
    renderAugment(fixture);
    act(() => {
      fixture.emit("science.experiments", [
        {
          ...SAMPLE_ENTRY,
          extensions: {
            kerbalism: { ...SAMPLE_ENTRY.extensions.kerbalism, analyze: false },
          },
        },
      ]);
    });
    await user.click(
      await screen.findByRole("button", { name: "Flag sample for analysis" }),
    );
    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === "kerbalism.sample.analyze",
    );
    expect(sent).toBeDefined();
    expect(sent?.args).toEqual({ subjectId: SUBJECT_ID, flag: true });
  });

  it("dispatches kerbalism.sample.dump only after arm-then-confirm", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();
    renderAugment(fixture);
    act(() => {
      fixture.emit("science.experiments", [SAMPLE_ENTRY]);
    });
    await user.click(
      await screen.findByRole("button", { name: "Dump sample" }),
    );
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === "kerbalism.sample.dump",
      ),
    ).toBeUndefined();
    await user.click(
      screen.getByRole("button", { name: "Confirm dump sample" }),
    );
    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === "kerbalism.sample.dump",
    );
    expect(sent).toBeDefined();
    expect(sent?.args).toEqual({ subjectId: SUBJECT_ID });
  });

  it("disables Move to lab when no lab part is aboard", async () => {
    const fixture = newFixture();
    renderAugment(fixture);
    act(() => {
      fixture.emit("science.experiments", [SAMPLE_ENTRY]);
      fixture.emit("science.lab", []);
    });
    const move = await screen.findByRole("button", {
      name: /move sample to lab \(no lab part aboard/i,
    });
    expect(move).toBeDisabled();
  });

  it("enables and dispatches kerbalism.sample.moveToLab when a lab is aboard", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();
    renderAugment(fixture);
    act(() => {
      fixture.emit("science.experiments", [SAMPLE_ENTRY]);
      fixture.emit("science.lab", LAB);
    });
    const move = await screen.findByRole("button", {
      name: "Move sample to lab",
    });
    expect(move).toBeEnabled();
    await user.click(move);
    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === "kerbalism.sample.moveToLab",
    );
    expect(sent).toBeDefined();
    expect(sent?.args).toEqual({ subjectId: SUBJECT_ID });
  });

  it("renders both file and sample blocks for a subject carrying both", async () => {
    const fixture = newFixture();
    const { container } = renderAugment(fixture);
    act(() => {
      fixture.emit("science.experiments", [FILE_ENTRY, SAMPLE_ENTRY]);
    });
    await within(container).findByRole("button", { name: /cancel send/i });
    expect(
      within(container).getByRole("button", { name: /cancel analyze/i }),
    ).toBeInTheDocument();
    expect(
      within(container).getByRole("button", { name: "Delete file" }),
    ).toBeInTheDocument();
    expect(
      within(container).getByRole("button", { name: "Dump sample" }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const fixture = newFixture();
    const { container } = renderAugment(fixture);
    act(() => {
      fixture.emit("science.experiments", [FILE_ENTRY, SAMPLE_ENTRY]);
      fixture.emit("science.lab", LAB);
    });
    await within(container).findByRole("button", { name: /cancel send/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});
