/**
 * The transmission light, as an operator and an assistive technology find it.
 *
 * What only a render can show: that a light is drawn whether or not anybody is
 * talking, so the operator learns where to look before they need it; that it
 * names the CONVERSATION rather than the speaker's address; that a muted loop
 * is still shown to be busy and is marked as unheard; and that the whole thing
 * is one polite live region rather than one per lamp.
 */
import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { threadKeyOf } from "../threads";
import type { RecipientId } from "../types";
import { RadioIndicator } from "./RadioIndicator";
import type { RadioLight } from "./RadioSession";

const NAMES: Record<string, string> = {
  "vessel:ares": "Ares 4",
  "ground:woomera": "Woomera Range",
};

const nameFor = (id: RecipientId) => NAMES[id] ?? id;

function light(over: Partial<RadioLight> = {}): RadioLight {
  const from = over.from ?? "vessel:ares";
  return {
    transmissionId: "t1",
    threadKey: threadKeyOf([from]),
    with: [from],
    from,
    authorName: "Jeb",
    muted: false,
    ...over,
  };
}

describe("the transmission light", () => {
  it("is drawn when nothing is happening, so the operator knows where it is", () => {
    // A lamp that only appeared when it mattered would move the bar under the
    // operator's eye at the exact instant they needed to read it.
    render(<RadioIndicator live={[]} nameFor={nameFor} onOpen={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Quiet");
  });

  it("names the conversation that is talking", () => {
    render(
      <RadioIndicator live={[light()]} nameFor={nameFor} onOpen={() => {}} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Ares 4 transmitting");
  });

  it("names a conversation that is not on screen, which is the whole point", () => {
    /*
     * The light does double duty: it says somebody is talking, and it says
     * WHICH loop. It takes what it draws from the reception rather than from
     * the open thread, so a transmission on a conversation the operator is not
     * looking at reaches this lamp exactly as one they are.
     */
    render(
      <RadioIndicator
        live={[light({ from: "ground:woomera", transmissionId: "t2" })]}
        nameFor={nameFor}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Woomera Range transmitting",
    );
  });

  it("shows a muted loop as busy, and says it is not being heard", () => {
    // Mute is tuning, not a cut: the operator chose not to hear this loop, they
    // did not ask to stop knowing that it is talking.
    render(
      <RadioIndicator
        live={[light({ muted: true })]}
        nameFor={nameFor}
        onOpen={() => {}}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Ares 4");
    expect(status).toHaveTextContent("muted");
  });

  it("is ONE polite live region however many loops are talking", () => {
    /*
     * A region per lamp would announce the same event two and three times over,
     * and `assertive` is reserved for what must interrupt. A transmission is a
     * state change to be told about, not an abort.
     */
    render(
      <RadioIndicator
        live={[
          light(),
          light({
            transmissionId: "t2",
            from: "ground:woomera",
            authorName: "Woomera Range",
          }),
        ]}
        nameFor={nameFor}
        onOpen={() => {}}
      />,
    );
    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveAttribute("aria-live", "polite");
    expect(regions[0]).toHaveTextContent("Ares 4");
    expect(regions[0]).toHaveTextContent("Woomera Range");
  });

  it("takes the operator to the conversation it names", async () => {
    /*
     * The mute lives beside the key, inside a conversation, and radio leaves no
     * transcript: a correspondent this vantage has only ever HEARD has no inbox
     * row. Without this the one loop an operator most wants to tune out is the
     * one they have no way to reach.
     */
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <RadioIndicator
        live={[light({ from: "ground:woomera" })]}
        nameFor={nameFor}
        onOpen={onOpen}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Woomera Range" }));
    expect(onOpen).toHaveBeenCalledWith(["ground:woomera"]);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <RadioIndicator live={[light()]} nameFor={nameFor} onOpen={() => {}} />,
    );
    await expectNoA11yViolations(container);
  });
});
