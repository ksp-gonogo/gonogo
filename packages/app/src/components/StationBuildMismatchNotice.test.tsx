import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  StationBuildMismatchNotice,
  UPGRADE_URL,
} from "./StationBuildMismatchNotice";

type Info = { name: string; version?: string };

class FakeHost {
  private info = new Set<(peerId: string, info: Info) => void>();
  private leave = new Set<(peerId: string) => void>();
  onStationInfo = (cb: (peerId: string, info: Info) => void) => {
    this.info.add(cb);
    return () => this.info.delete(cb);
  };
  onPeerDisconnect = (cb: (peerId: string) => void) => {
    this.leave.add(cb);
    return () => this.leave.delete(cb);
  };
  join(peerId: string, info: Info) {
    act(() => {
      for (const cb of this.info) cb(peerId, info);
    });
  }
  disconnect(peerId: string) {
    act(() => {
      for (const cb of this.leave) cb(peerId);
    });
  }
}

function mount(host: FakeHost, localVersion = "1.2.0") {
  return render(
    <StationBuildMismatchNotice
      host={host as never}
      localVersion={localVersion}
    />,
  );
}

describe("StationBuildMismatchNotice", () => {
  it("says a station on an older minor is the older side, with no upgrade link", () => {
    const host = new FakeHost();
    mount(host);
    host.join("p1", { name: "Guidance", version: "1.1.0" });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Station older: Guidance v1.1.0, main v1.2.0",
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says the main screen is older when the station is ahead, and links how to upgrade it", () => {
    const host = new FakeHost();
    mount(host);
    host.join("p1", { name: "Flight", version: "1.3.0" });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Main screen older: Flight v1.3.0, main v1.2.0",
    );
    expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute(
      "href",
      UPGRADE_URL,
    );
  });

  it("raises a major difference as an alert", () => {
    const host = new FakeHost();
    mount(host);
    host.join("p1", { name: "Flight", version: "2.0.0" });

    expect(screen.getByRole("alert")).toHaveTextContent("Main screen older");
  });

  it("treats a station that reports no version as the older side", () => {
    const host = new FakeHost();
    mount(host);
    host.join("p1", { name: "EECOM" });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Station older: EECOM no version, main v1.2.0",
    );
  });

  it("stays quiet for the same build and for a patch-only difference", () => {
    const host = new FakeHost();
    const { container } = mount(host);
    host.join("p1", { name: "A", version: "1.2.0" });
    host.join("p2", { name: "B", version: "1.2.9" });

    expect(container).toBeEmptyDOMElement();
  });

  it("is not raised again by a re-sent station info once dismissed", async () => {
    const host = new FakeHost();
    const { container } = mount(host);
    host.join("p1", { name: "Guidance", version: "1.1.0" });

    await userEvent.click(
      screen.getByRole("button", {
        name: "Dismiss the build notice for Guidance",
      }),
    );
    expect(container).toBeEmptyDOMElement();

    host.join("p1", { name: "Guidance (renamed)", version: "1.1.0" });
    expect(container).toBeEmptyDOMElement();
  });

  it("drops a station's notice when it leaves, and raises it again on a rejoin", () => {
    const host = new FakeHost();
    const { container } = mount(host);
    host.join("p1", { name: "Guidance", version: "1.1.0" });
    host.disconnect("p1");
    expect(container).toBeEmptyDOMElement();

    host.join("p1", { name: "Guidance", version: "1.1.0" });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has no a11y violations while raised", async () => {
    const host = new FakeHost();
    const { container } = mount(host);
    host.join("p1", { name: "Flight", version: "1.3.0" });

    await expectNoA11yViolations(container);
  });
});
