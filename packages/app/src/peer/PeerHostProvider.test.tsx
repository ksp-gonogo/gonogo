import { act, render } from "@ksp-gonogo/sitrep-sdk/testing";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeerHostProvider } from "./PeerHostProvider";
import { peerHostService } from "./PeerHostService";

describe("PeerHostProvider lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not stop the host between StrictMode's cleanup and its setup", async () => {
    vi.spyOn(peerHostService, "start").mockResolvedValue(undefined);
    const stop = vi.spyOn(peerHostService, "stop").mockImplementation(() => {});

    const view = render(
      <StrictMode>
        <PeerHostProvider>{null}</PeerHostProvider>
      </StrictMode>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(stop).not.toHaveBeenCalled();

    view.unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
