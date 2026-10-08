import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { createFakeWallClock } from "./fake-wall-clock";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import {
  type CommandGroupHandle,
  sendTogether,
  useCommand,
} from "./use-command";
import { ViewClock } from "./view-clock";

function setup() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  transport.setCommandHandler((command, args) => ({ command, args }));
  const client = new TelemetryClient(transport, undefined, { idPrefix: "t" });
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  function Provider({ children }: { children: React.ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        {children}
      </TelemetryProvider>
    );
  }
  return { transport, client, Provider };
}

/** Three handles, and a button that sends them together through `group`. */
function Widget({
  group,
  onGroup,
}: {
  group: () => void;
  onGroup?: (g: CommandGroupHandle) => void;
}) {
  const ag = useCommand("ag");
  const sas = useCommand("sas");
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          const g = sendTogether(() => {
            void ag.send({ group: "Custom01" }).catch(() => {});
            void ag.send({ group: "Custom02" }).catch(() => {});
            void sas.send({ enabled: true }).catch(() => {});
            group();
          });
          onGroup?.(g);
        }}
      >
        go
      </button>
      <span>rows:{ag.inFlight.length + sas.inFlight.length}</span>
      <span>label:{ag.inFlight[0]?.label}</span>
    </div>
  );
}

const returnsAPromise: () => void = async () => {};

describe("sendTogether", () => {
  it("sends the members as one command-group frame and answers each under its own id", async () => {
    const { transport, Provider } = setup();
    let captured: CommandGroupHandle | undefined;
    render(
      <Provider>
        <Widget group={() => {}} onGroup={(g) => (captured = g)} />
      </Provider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("go"));
    });

    expect(transport.sentGroups).toHaveLength(1);
    expect(transport.sentGroups[0].requestIds).toHaveLength(3);
    expect(transport.sentCommands.map((c) => c.command)).toEqual([
      "ag",
      "ag",
      "sas",
    ]);
    expect(captured?.requestIds).toEqual(transport.sentGroups[0].requestIds);

    const replies = await captured?.result;
    expect(replies).toHaveLength(3);
    await waitFor(() => expect(captured?.status).toBe("confirmed"));
    await act(async () => {});
  });

  it("sends three action groups as they are today, applied together: one frame of three setActionGroup commands", async () => {
    const { transport, Provider } = setup();
    function ActionGroups() {
      const setGroup = useCommand("vessel.control.setActionGroup");
      return (
        <button
          type="button"
          onClick={() => {
            sendTogether(() => {
              for (const group of [1, 2, 3]) {
                void setGroup.send({ group, state: true }).catch(() => {});
              }
            });
          }}
        >
          go
        </button>
      );
    }
    render(
      <Provider>
        <ActionGroups />
      </Provider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("go"));
    });

    expect(transport.sentGroups).toHaveLength(1);
    expect(transport.sentCommands.map((c) => c.args)).toEqual([
      { group: 1, state: true },
      { group: 2, state: true },
      { group: 3, state: true },
    ]);
  });

  it("settles each handle's own promise with its own command's reply", async () => {
    const { Provider } = setup();
    const settled: unknown[] = [];
    function Probe() {
      const ag = useCommand("ag");
      const sas = useCommand("sas");
      return (
        <button
          type="button"
          onClick={() => {
            sendTogether(() => {
              void ag.send({ n: 1 }).then((r) => settled.push(r));
              void sas.send({ n: 2 }).then((r) => settled.push(r));
            });
          }}
        >
          go
        </button>
      );
    }
    render(
      <Provider>
        <Probe />
      </Provider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("go"));
    });
    await waitFor(() => expect(settled).toHaveLength(2));
    await act(async () => {});

    expect(settled).toEqual([
      { command: "ag", args: { n: 1 } },
      { command: "sas", args: { n: 2 } },
    ]);
  });

  it("refuses a callback that returns a promise, and sends nothing", () => {
    const { transport } = setup();
    expect(() => sendTogether(returnsAPromise)).toThrow(/synchronous/);
    expect(transport.sentGroups).toHaveLength(0);
  });

  it("refuses to nest", () => {
    expect(() =>
      sendTogether(() => {
        sendTogether(() => {});
      }),
    ).toThrow(/nested/);
  });

  it("refuses an empty group", () => {
    expect(() => sendTogether(() => {})).toThrow(/at least one/);
  });

  it("rejects every member's promise when the callback throws", async () => {
    const { transport, Provider } = setup();
    const outcomes: string[] = [];
    function Probe() {
      const ag = useCommand("ag");
      return (
        <button
          type="button"
          onClick={() => {
            try {
              sendTogether(() => {
                ag.send({ n: 1 }).catch((e: Error) => outcomes.push(e.message));
                throw new Error("boom");
              });
            } catch {
              outcomes.push("thrown");
            }
          }}
        >
          go
        </button>
      );
    }
    render(
      <Provider>
        <Probe />
      </Provider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("go"));
    });
    await waitFor(() => expect(outcomes).toContain("boom"));

    expect(outcomes).toContain("thrown");
    expect(transport.sentGroups).toHaveLength(0);
    expect(transport.sentCommands).toHaveLength(0);
    await act(async () => {});
  });

  it("refuses a group whose members are sent from different command centres", async () => {
    const { transport, Provider } = setup();
    const outcomes: string[] = [];
    function Probe() {
      const ksc = useCommand("ag", { vantage: "ksc" });
      const other = useCommand("ag", { vantage: "tracking" });
      return (
        <button
          type="button"
          onClick={() => {
            try {
              sendTogether(() => {
                void ksc.send({ n: 1 }).catch(() => outcomes.push("rejected"));
                void other
                  .send({ n: 2 })
                  .catch(() => outcomes.push("rejected"));
              });
            } catch (e) {
              outcomes.push(e instanceof Error ? e.message : "");
            }
          }}
        >
          go
        </button>
      );
    }
    render(
      <Provider>
        <Probe />
      </Provider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("go"));
    });
    await waitFor(() => expect(outcomes).toHaveLength(3));

    expect(outcomes[0]).toMatch(/one command centre/);
    expect(transport.sentGroups).toHaveLength(0);
    await act(async () => {});
  });

  it("draws one rail row for the group, never one per member", async () => {
    const { transport, Provider } = setup();
    let captured: CommandGroupHandle | undefined;
    transport.holdCommands();
    render(
      <Provider>
        <Widget group={() => {}} onGroup={(g) => (captured = g)} />
      </Provider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("go"));
    });
    const [first, second, third] = transport.sentGroups[0].requestIds;
    expect(captured?.requestIds).toEqual([first, second, third]);

    act(() => {
      transport.emit(
        "system.uplink.pending",
        {
          pending: [
            {
              id: "engine-1",
              clientRequestId: first,
              command: "system.uplink.group",
              label: "ag + ag + sas",
              topic: "",
              vantage: "ksc",
              dispatchedAt: 0,
              oneWaySeconds: 2,
              members: [first, second, third],
            },
          ],
        },
        { validAt: 0, deliveredAt: 0 },
      );
    });

    await waitFor(() => expect(screen.getByText("rows:1")).toBeTruthy());
    expect(screen.getByText("label:ag + ag + sas (group of 3)")).toBeTruthy();
    await act(async () => {});
  });
});
