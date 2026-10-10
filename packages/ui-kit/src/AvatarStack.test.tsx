import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AvatarStack, initialsOf } from "./AvatarStack";

const PEOPLE = [
  { id: "a", name: "Ares 4" },
  { id: "w", name: "Woomera Range" },
  { id: "j", name: "Jeb" },
  { id: "k", name: "Kennedy Flight" },
  { id: "b", name: "Bill" },
];

describe("initialsOf", () => {
  it("takes the first letters of two words, or two letters of one", () => {
    expect(initialsOf("Woomera Range")).toBe("WR");
    expect(initialsOf("Ares 4")).toBe("A4");
    expect(initialsOf("Jeb")).toBe("JE");
    expect(initialsOf("  ")).toBe("?");
  });
});

describe("AvatarStack", () => {
  it("names each avatar by the full name", () => {
    render(<AvatarStack items={PEOPLE.slice(0, 2)} label="Speaking" />);
    expect(screen.getByRole("group", { name: "Speaking" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Woomera Range" }),
    ).toHaveTextContent("WR");
  });

  it("folds the people it has no place for into a count that names them", () => {
    render(<AvatarStack items={PEOPLE} max={3} />);
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(
      screen.getByRole("img", { name: "3 more: Jeb, Kennedy Flight, Bill" }),
    ).toHaveTextContent("+3");
  });

  it("draws everyone when they fit", () => {
    render(<AvatarStack items={PEOPLE.slice(0, 3)} max={3} />);
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("reserves the same width whatever the count", () => {
    const widthOf = (count: number) => {
      const { container, unmount } = render(
        <AvatarStack items={PEOPLE.slice(0, count)} max={3} />,
      );
      const width = getComputedStyle(
        container.firstElementChild as Element,
      ).inlineSize;
      unmount();
      return width;
    };
    expect(widthOf(0)).toBe(widthOf(1));
    expect(widthOf(1)).toBe(widthOf(5));
  });

  it("steps far enough that the covered edge of a badge never reaches its initials", () => {
    /*
     * Two centred letters at the caption size reach about 0.85 of the badge's
     * width from its left edge, so the step between badges has to be at least
     * that share of the badge. jsdom resolves no calc, so this reads the
     * declared ratio.
     */
    const { container } = render(<AvatarStack items={PEOPLE} max={3} />);
    const row = container.firstElementChild as Element;
    const step = getComputedStyle(row).getPropertyValue("--avatar-step");
    const ratio = Number(/\*\s*([0-9.]+)\)/.exec(step)?.[1]);
    expect(ratio).toBeGreaterThanOrEqual(0.85);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it("is as tall as one avatar whatever the count", () => {
    const heightOf = (count: number) => {
      const { container, unmount } = render(
        <AvatarStack items={PEOPLE.slice(0, count)} max={3} />,
      );
      const height = getComputedStyle(
        container.firstElementChild as Element,
      ).blockSize;
      unmount();
      return height;
    };
    expect(heightOf(0)).not.toBe("auto");
    expect(heightOf(0)).toBe(heightOf(1));
    expect(heightOf(1)).toBe(heightOf(5));
  });

  it("shows the full name in a tip on hover", async () => {
    const user = userEvent.setup();
    render(<AvatarStack items={PEOPLE.slice(0, 2)} />);
    await user.hover(screen.getByRole("img", { name: "Ares 4" }));
    expect(document.body.querySelector("[data-tooltip-tip]")).toHaveTextContent(
      "Ares 4",
    );
  });

  it("makes an avatar a button when its item has onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AvatarStack items={[PEOPLE[0], { ...PEOPLE[1], onSelect }]} />);
    expect(screen.queryByRole("button", { name: "Ares 4" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Woomera Range" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <AvatarStack items={PEOPLE} label="Speaking" />,
    );
    await expectNoA11yViolations(container);
  });
});
