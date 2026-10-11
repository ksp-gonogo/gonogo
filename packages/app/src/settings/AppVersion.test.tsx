import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { PeerClientProvider } from "../peer/PeerClientContext";
import { idlePeerClient } from "../test/peerFakes";
import { VERSION } from "../version";
import { AppVersion } from "./AppVersion";

describe("AppVersion", () => {
  it("shows the build this screen is running", async () => {
    const { container } = render(<AppVersion />);

    expect(screen.getByText("Gonogo")).toBeInTheDocument();
    expect(screen.getByText(VERSION)).toBeInTheDocument();
    expect(screen.queryByText("Main screen")).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("shows a station's own build and the main screen's once it has announced itself", async () => {
    let hello: ((info: { version: string; buildTime: string }) => void) | null =
      null;
    const client = {
      ...idlePeerClient(),
      onHostHello: (cb: typeof hello) => {
        hello = cb;
        return () => {};
      },
    };
    const { container } = render(
      <PeerClientProvider client={client as never}>
        <AppVersion />
      </PeerClientProvider>,
    );

    expect(screen.getByText("This station")).toBeInTheDocument();
    expect(screen.queryByText("Main screen")).toBeNull();

    act(() => {
      hello?.({ version: "9.9.9", buildTime: "2026-01-01T00:00:00Z" });
    });

    expect(screen.getByText("Main screen")).toBeInTheDocument();
    expect(screen.getByText("9.9.9")).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("shows the main screen's build straight away when the hello already landed", () => {
    const client = {
      ...idlePeerClient(),
      getHostVersion: () => ({ version: "8.8.8", buildTime: "" }),
    };
    render(
      <PeerClientProvider client={client}>
        <AppVersion />
      </PeerClientProvider>,
    );
    expect(screen.getByText("8.8.8")).toBeInTheDocument();
  });
});
