import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { LiveRegion } from "./LiveRegion";
import { Notice } from "./Notice";
import { expectLiveRegionPrimed } from "./testing";

/** The region mounts together with its first message, so the first announcement is lost. */
function MountsWithContent({ message }: { message: string }) {
  return message ? <span role="status">{message}</span> : null;
}

/** A fresh element per message, so the region the reader knew is gone. */
function RemountsPerMessage({ message }: { message: string }) {
  return (
    <span key={message} role="status">
      {message}
    </span>
  );
}

function Primed({ message }: { message: string }) {
  return <LiveRegion>{message}</LiveRegion>;
}

describe("expectLiveRegionPrimed", () => {
  it("passes a LiveRegion that stays mounted while its words change", async () => {
    const { container, rerender } = render(<Primed message="" />);
    const regions = await expectLiveRegionPrimed(container, () =>
      rerender(<Primed message="Command sent" />),
    );
    expect(regions[0]).toHaveTextContent("Command sent");
  });

  it("fails a region that mounts together with its first message", async () => {
    const { container, rerender } = render(<MountsWithContent message="" />);
    await expect(
      expectLiveRegionPrimed(container, () =>
        rerender(<MountsWithContent message="Command sent" />),
      ),
    ).rejects.toThrow(/No live region/);
  });

  it("fails a region that is replaced instead of updated", async () => {
    const { container, rerender } = render(<RemountsPerMessage message="" />);
    await expect(
      expectLiveRegionPrimed(container, () =>
        rerender(<RemountsPerMessage message="b" />),
      ),
    ).rejects.toThrow(/replaced by a new element/);
  });

  it("fails a reveal that says nothing", async () => {
    const { container } = render(<Primed message="" />);
    await expect(expectLiveRegionPrimed(container, () => {})).rejects.toThrow(
      /put no text/,
    );
  });

  it("narrows to one region by selector", async () => {
    function Two({ message }: { message: string }) {
      return (
        <>
          <LiveRegion aria-label="first">{message}</LiveRegion>
          <span role="status">kept text</span>
        </>
      );
    }
    const { container, rerender } = render(<Two message="" />);
    await expectLiveRegionPrimed(
      container,
      () => rerender(<Two message="said" />),
      '[aria-label="first"]',
    );
  });

  it("holds a real component to it: the polite Notice speaks through a primed region", async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            raise
          </button>
          <Notice>{open ? "Signal lost" : ""}</Notice>
        </>
      );
    }
    const { container, getByRole } = render(<Host />);
    await expectLiveRegionPrimed(
      container,
      () => getByRole("button").click(),
      "[data-live-region]",
    );
  });
});
