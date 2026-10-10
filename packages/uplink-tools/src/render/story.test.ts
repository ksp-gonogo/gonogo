// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assertOneLoop,
  findStory,
  isAnimated,
  outputPath,
  parseStoryArgs,
  resample,
  type SecondsPage,
  type StoryEntry,
  statedSeconds,
  storiesOfIndex,
  unionClip,
} from "./story";

const still: StoryEntry = {
  id: "widgets-navball--default",
  title: "Widgets/navball",
  name: "Default",
  tags: ["dev"],
};
const playing: StoryEntry = {
  id: "widgets-landing-status-descent-playback--crash-landing",
  title: "Widgets/landing-status/Descent playback",
  name: "Crash landing",
  tags: ["dev", "playback"],
};

describe("parseStoryArgs", () => {
  it("takes the story id and gives every option a default", () => {
    expect(parseStoryArgs([playing.id])).toEqual({
      id: playing.id,
      list: false,
      storybook: "storybook-static",
      format: "auto",
      seconds: 6,
      secondsGiven: false,
      fps: 10,
      width: 1280,
      height: 900,
      scale: 1,
      chrome: false,
      engine: "chromium",
    });
  });

  it("reads every option", () => {
    const args = parseStoryArgs([
      "a--b",
      "--storybook",
      "http://localhost:6006/",
      "--out",
      "x.gif",
      "--gif",
      "--chrome",
      "--seconds",
      "3.5",
      "--fps",
      "20",
      "--size",
      "800x600",
      "--scale",
      "2",
      "--start",
      "Play",
      "--engine",
      "webkit",
    ]);
    expect(args).toMatchObject({
      id: "a--b",
      storybook: "http://localhost:6006/",
      out: "x.gif",
      format: "gif",
      chrome: true,
      seconds: 3.5,
      secondsGiven: true,
      fps: 20,
      width: 800,
      height: 600,
      scale: 2,
      start: "Play",
      engine: "webkit",
    });
  });

  it("lists with an optional filter and no id", () => {
    expect(parseStoryArgs(["--list", "landing"])).toMatchObject({
      list: true,
      listFilter: "landing",
    });
    expect(parseStoryArgs(["--list"])).toMatchObject({
      list: true,
      listFilter: undefined,
    });
  });

  it.each([
    [[], "needs a story id"],
    [["a", "b"], "renders one story"],
    [["a", "--nope"], "--nope is not an option of story"],
    [["a", "--fps"], "--fps needs a value"],
    [["a", "--fps", "0"], "--fps takes a number from 1 to 30"],
    [["a", "--fps", "31"], "--fps takes a number from 1 to 30"],
    [["a", "--seconds", "x"], "--seconds takes a number"],
    [["a", "--scale", "9"], "--scale takes a number"],
    [["a", "--size", "800"], "WIDTHxHEIGHT"],
    [["a", "--engine", "ie"], "--engine must be one of"],
    [["a", "--gif", "--png"], "do not combine"],
    [["a", "--png", "--start", "Play"], "only applies to a GIF"],
  ])("refuses %j", (argv, message) => {
    expect(() => parseStoryArgs(argv)).toThrow(message);
  });
});

describe("isAnimated", () => {
  const args = (format: "auto" | "gif" | "png") =>
    parseStoryArgs([still.id, ...(format === "auto" ? [] : [`--${format}`])]);

  it("follows the playback tag when nothing is forced", () => {
    expect(isAnimated(playing, args("auto"))).toBe(true);
    expect(isAnimated(still, args("auto"))).toBe(false);
  });

  it("lets a flag override the tag either way", () => {
    expect(isAnimated(still, args("gif"))).toBe(true);
    expect(isAnimated(playing, args("png"))).toBe(false);
  });
});

describe("outputPath", () => {
  it("names a file in renders/ after the story by default", () => {
    expect(outputPath("/w", undefined, "a--b", false)).toBe(
      "/w/renders/a--b.png",
    );
    expect(outputPath("/w", undefined, "a--b", true)).toBe(
      "/w/renders/a--b.gif",
    );
  });

  it("puts the story in a directory, or writes the file it is given", () => {
    expect(outputPath("/w", "out", "a--b", true)).toBe("/w/out/a--b.gif");
    expect(outputPath("/w", "out/x.gif", "a--b", true)).toBe("/w/out/x.gif");
  });

  it("refuses an extension that disagrees with what the story renders", () => {
    expect(() => outputPath("/w", "x.png", "a--b", true)).toThrow("Pass --png");
    expect(() => outputPath("/w", "x.gif", "a--b", false)).toThrow(
      "Pass --gif",
    );
  });
});

describe("findStory", () => {
  const all = [still, playing];

  it("finds a story by its id", () => {
    expect(findStory(all, still.id)).toBe(still);
  });

  it("names the nearest ids when the id is not one", () => {
    expect(() => findStory(all, "landing-status")).toThrow(playing.id);
    expect(() => findStory(all, "zzz")).toThrow("story --list");
  });
});

describe("storiesOfIndex", () => {
  it("keeps stories with their tags and drops docs entries", () => {
    const index = {
      entries: {
        a: {
          type: "story",
          id: "a--b",
          title: "A",
          name: "B",
          tags: ["playback", 3],
        },
        c: { type: "docs", id: "a--docs" },
        d: { type: "story" },
      },
    };
    expect(storiesOfIndex(index, "index.json")).toEqual([
      { id: "a--b", title: "A", name: "B", tags: ["playback"] },
    ]);
  });

  it("refuses an index of any other shape", () => {
    expect(() => storiesOfIndex({}, "index.json")).toThrow("no story entries");
    expect(() => storiesOfIndex(null, "index.json")).toThrow(
      "no story entries",
    );
  });
});

describe("resample", () => {
  const captured = [
    { at: 0, frame: "a" },
    { at: 250, frame: "b" },
    { at: 900, frame: "c" },
  ];

  it("takes the latest frame at or before each tick", () => {
    expect(resample(captured, 4, 1)).toEqual(["a", "b", "b", "b"]);
    expect(resample(captured, 2, 2)).toEqual(["a", "b", "c", "c"]);
  });

  it("holds the last frame when capture ended early", () => {
    expect(resample([{ at: 0, frame: "x" }], 10, 1)).toEqual(
      Array(10).fill("x"),
    );
  });

  it("refuses an empty capture", () => {
    expect(() => resample([], 10, 1)).toThrow("no frames");
  });
});

describe("unionClip", () => {
  it("is the box of one widget, rounded out to whole pixels", () => {
    expect(
      unionClip([{ x: 12.4, y: 38.5, width: 471.2, height: 520 }]),
    ).toEqual({
      x: 12,
      y: 38,
      width: 472,
      height: 521,
    });
  });

  it("holds every widget of a story with several", () => {
    expect(
      unionClip([
        { x: 10, y: 10, width: 100, height: 50 },
        { x: 200, y: 40, width: 100, height: 100 },
      ]),
    ).toEqual({ x: 10, y: 10, width: 290, height: 130 });
  });

  it("ignores a box that drew nothing, and says so when nothing drew", () => {
    expect(
      unionClip([
        { x: 0, y: 0, width: 0, height: 0 },
        { x: 5, y: 5, width: 10, height: 10 },
      ]),
    ).toEqual({ x: 5, y: 5, width: 10, height: 10 });
    expect(unionClip([])).toBeUndefined();
    expect(unionClip([{ x: 0, y: 0, width: 0, height: 9 }])).toBeUndefined();
  });
});

describe("statedSeconds", () => {
  /** A page whose one marked element carries `attribute`, or whose lookup fails when it is `null`. */
  const pageWith = (attribute: string | null | "missing") =>
    ({
      locator: () => ({
        first: () => ({
          getAttribute: () =>
            attribute === "missing"
              ? Promise.reject(new Error("no such element"))
              : Promise.resolve(attribute),
        }),
      }),
    }) satisfies SecondsPage;

  it("reads the running time a story states for itself", async () => {
    expect(await statedSeconds(pageWith("31.5"), 6)).toBe(31.5);
  });

  it("falls back when the story states none, or something a GIF cannot be", async () => {
    expect(await statedSeconds(pageWith("missing"), 6)).toBe(6);
    expect(await statedSeconds(pageWith(null), 6)).toBe(6);
    expect(await statedSeconds(pageWith("soon"), 6)).toBe(6);
    expect(await statedSeconds(pageWith("0"), 6)).toBe(6);
    expect(await statedSeconds(pageWith("600"), 6)).toBe(6);
  });
});

describe("a GIF holds exactly one loop of its story", () => {
  const a = Buffer.from("first");
  const b = Buffer.from("middle");
  const c = Buffer.from("last");

  it("accepts a run from the first frame to the last, held on the last", () => {
    expect(() =>
      assertOneLoop([a, b, c, c, c], { stated: 5 / 8, fps: 8 }),
    ).not.toThrow();
  });

  it("refuses a run that comes back round to the first frame", () => {
    expect(() => assertOneLoop([a, b, c, a, b], {})).toThrow(
      /more than one loop/,
    );
  });

  it("refuses a length that is not the one the story states", () => {
    expect(() =>
      assertOneLoop([a, b, c], { stated: 16, seconds: 24, fps: 8 }),
    ).toThrow(/runs for 16 seconds/);
  });

  it("accepts a length equal to the one the story states", () => {
    expect(() =>
      assertOneLoop([a, b, c], { stated: 16, seconds: 16, fps: 8 }),
    ).not.toThrow();
  });
});
