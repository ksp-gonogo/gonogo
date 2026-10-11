import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { UPDATE_PULL_COMMAND } from "../firstRun/setupGuide";
import { PeerClientProvider } from "../peer/PeerClientContext";
import { idlePeerClient } from "../test/peerFakes";
import { VERSION } from "../version";
import { AppVersion } from "./AppVersion";
import { __resetLatestRelease, LATEST_RELEASE_URL } from "./releaseCheck";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  __resetLatestRelease();
  server.use(
    http.get(LATEST_RELEASE_URL, () => new HttpResponse(null, { status: 404 })),
  );
});

function releaseIs(version: string) {
  server.use(
    http.get(LATEST_RELEASE_URL, () =>
      HttpResponse.json({
        tag_name: `v${version}`,
        html_url: `https://github.com/ksp-gonogo/gonogo/releases/tag/v${version}`,
      }),
    ),
  );
}

describe("AppVersion", () => {
  it("shows the build this screen is running", async () => {
    const { container } = render(<AppVersion />);

    expect(screen.getByText("Gonogo")).toBeInTheDocument();
    expect(screen.getByText(VERSION)).toBeInTheDocument();
    expect(screen.queryByText("Main screen")).toBeNull();
    await screen.findByText("Could not check");
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
    await screen.findByText("Could not check");
    await expectNoA11yViolations(container);
  });

  it("names a newer release on a station without the main screen's update commands", async () => {
    releaseIs("999.0.0");
    render(
      <PeerClientProvider client={idlePeerClient() as never}>
        <AppVersion />
      </PeerClientProvider>,
    );
    await screen.findByRole("link", { name: "999.0.0" });
    expect(screen.queryByText(/is out/)).toBeNull();
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

  it("shows a newer release and the commands that update the container", async () => {
    releaseIs("999.0.0");
    const { container } = render(<AppVersion />);

    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "999.0.0" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/ksp-gonogo/gonogo/releases/tag/v999.0.0",
    );
    expect(screen.getByText(/Gonogo 999\.0\.0 is out/)).toBeInTheDocument();
    expect(screen.getByText(UPDATE_PULL_COMMAND)).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("offers no update when the newest release is the one running", async () => {
    releaseIs(VERSION);
    render(<AppVersion />);
    await screen.findByText(VERSION.replace(/^v/, ""), { selector: "a" });
    expect(screen.queryByText(/is out/)).toBeNull();
  });

  it("treats a failed check as unknown, never as up to date", async () => {
    server.use(http.get(LATEST_RELEASE_URL, () => HttpResponse.error()));
    render(<AppVersion />);
    expect(await screen.findByText("Could not check")).toBeInTheDocument();
    expect(screen.queryByText(/is out/)).toBeNull();
    expect(screen.queryByText(/up to date|current/i)).toBeNull();
  });

  it("treats an answer it cannot read as unknown", async () => {
    server.use(
      http.get(LATEST_RELEASE_URL, () => HttpResponse.json({ tag_name: 7 })),
    );
    render(<AppVersion />);
    expect(await screen.findByText("Could not check")).toBeInTheDocument();
  });

  it("asks GitHub once however many times Settings opens", async () => {
    let asked = 0;
    server.use(
      http.get(LATEST_RELEASE_URL, () => {
        asked += 1;
        return new HttpResponse(null, { status: 404 });
      }),
    );
    const first = render(<AppVersion />);
    await screen.findByText("Could not check");
    first.unmount();
    render(<AppVersion />);
    expect(screen.getByText("Could not check")).toBeInTheDocument();
    expect(asked).toBe(1);
  });

  it("shows the mod's release and says when it differs from the app's", async () => {
    const fixture = setupStreamFixture();
    render(
      <fixture.Provider>
        <AppVersion />
      </fixture.Provider>,
    );
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("system.uplinks")).toBe(true),
    );
    act(() =>
      fixture.emit("system.uplinks", { uplinks: [], coreVersion: "v0.0.1" }),
    );

    expect(await screen.findByText("0.0.1")).toBeInTheDocument();
    expect(
      screen.getByText(/The mod and this app are from different releases/),
    ).toBeInTheDocument();
    await screen.findByText("Could not check");
  });

  it("says a mod build records no release, without calling it a mismatch", async () => {
    const fixture = setupStreamFixture();
    render(
      <fixture.Provider>
        <AppVersion />
      </fixture.Provider>,
    );
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("system.uplinks")).toBe(true),
    );
    act(() =>
      fixture.emit("system.uplinks", { uplinks: [], coreVersion: null }),
    );

    expect(
      await screen.findByText("Not recorded by this build"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/different releases/)).toBeNull();
    await screen.findByText("Could not check");
  });
});
