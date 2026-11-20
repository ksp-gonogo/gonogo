import {
  type ComponentProps,
  clearContributions,
  clearRegistry,
  registerComponent,
} from "@ksp-gonogo/core";
import { render, screen, within } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui-kit";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PeerClient,
  PeerClientProvider,
} from "../../peer/PeerClientContext";
import { PushClientProvider } from "../../pushToMain/PushClientContext";
import { idlePeerClient } from "../../test/peerFakes";
import { GridItemContent } from "./GridItemContent";
import { gridUnitsForBox } from "./gridMetrics";
import { COLS } from "./layoutNormalization";

/* A widget with state of its own that nothing saves: a draft, a count and its size. */
function Notepad({ w, h }: ComponentProps) {
  return (
    <div data-testid="notepad">
      <textarea aria-label="Draft" />
      <div data-testid="scroller" />
      <output data-testid="size">{`${w}x${h}`}</output>
    </div>
  );
}

const mounts = vi.hoisted(() => ({ count: 0 }));

function Counting(props: ComponentProps) {
  const [id] = useState(() => ++mounts.count);
  return (
    <>
      <output data-testid="instance">{id}</output>
      <Notepad {...props} />
    </>
  );
}

const ITEM = { i: "w1", componentId: "notepad" };

function mount(opts: { expandable?: boolean; pushable?: boolean } = {}) {
  registerComponent({
    id: "notepad",
    name: "Notepad",
    description: "A widget with local state",
    tags: [],
    component: Counting,
    expandable: opts.expandable ?? true,
    pushable: opts.pushable,
  });
  const client: PeerClient = {
    ...idlePeerClient(),
    getApproval: () => "approved",
    getHostSeat: () => "main",
  };
  return render(
    <PeerClientProvider client={client}>
      <PushClientProvider>
        <ModalProvider>
          <GridItemContent
            item={ITEM}
            w={5}
            h={4}
            updateItemConfig={vi.fn()}
            updateItemMappings={vi.fn()}
            removeItem={vi.fn()}
          />
        </ModalProvider>
      </PushClientProvider>
    </PeerClientProvider>,
  );
}

describe("an expandable widget's tile", () => {
  beforeEach(() => {
    clearRegistry();
    clearContributions();
    mounts.count = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("has no Expand button unless the widget opted in", () => {
    mount({ expandable: false });
    expect(screen.queryByRole("button", { name: /^Expand / })).toBeNull();
  });

  it("puts the Expand button first among the header buttons", () => {
    mount();
    const buttons = Array.from(
      document.querySelectorAll(".widget-action-buttons button"),
    );
    expect(buttons[0]).toBe(
      screen.getByRole("button", { name: "Expand Notepad" }),
    );
  });

  it("keeps the widget's typed text, its node and its instance into the dialog and back", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    const draft = screen.getByLabelText("Draft") as HTMLTextAreaElement;
    await user.type(draft, "hello");

    const expand = screen.getByRole("button", { name: "Expand Notepad" });
    await user.click(expand);

    const dialog = screen.getByRole("dialog", { name: "Notepad" });
    expect(within(dialog).getByLabelText("Draft")).toBe(draft);
    expect(draft.value).toBe("hello");
    expect(screen.getByText("Open in expanded view")).toBeInTheDocument();

    await user.type(draft, " world");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Draft")).toBe(draft);
    expect(draft.value).toBe("hello world");
    expect(screen.getAllByTestId("instance")).toHaveLength(1);
    expect(mounts.count).toBe(1);
    expect(screen.queryByText("Open in expanded view")).toBeNull();
    expect(expand).toHaveFocus();
  });

  it("hands the widget the dialog's size in grid units", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    expect(screen.getByTestId("size")).toHaveTextContent("5x4");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 900,
      height: 500,
      top: 0,
      left: 0,
      right: 900,
      bottom: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await user.click(screen.getByRole("button", { name: "Expand Notepad" }));
    const { w, h } = gridUnitsForBox(900, 500, window.innerWidth, COLS);
    expect(screen.getByTestId("size")).toHaveTextContent(`${w}x${h}`);
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("size")).toHaveTextContent("5x4");
    vi.restoreAllMocks();
  });

  it("puts a scrolled element back where it was when the move resets it", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    const scroller = screen.getByTestId("scroller");
    /* jsdom lays nothing out, so stand in for the browser: an offset that is lost when the node is moved. */
    let top = 120;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = v;
      },
    });
    const append = Node.prototype.appendChild;
    vi.spyOn(Node.prototype, "appendChild").mockImplementation(function (
      this: Node,
      child: Node,
    ) {
      if (child.contains(scroller)) top = 0;
      return append.call(this, child);
    });

    await user.click(screen.getByRole("button", { name: "Expand Notepad" }));
    expect(scroller.scrollTop).toBe(120);
    await user.keyboard("{Escape}");
    expect(scroller.scrollTop).toBe(120);
    vi.restoreAllMocks();
  });

  it("keeps the push button in the dialog, pushing at the dialog's size", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount({ pushable: true });
    await user.click(screen.getByRole("button", { name: "Expand Notepad" }));
    const dialog = screen.getByRole("dialog", { name: "Notepad" });
    expect(
      within(dialog).getByRole("button", { name: "Push to main" }),
    ).toBeInTheDocument();
    const push = within(dialog).getByRole("button", { name: "Push to main" });
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(close.parentElement?.contains(push)).toBe(true);
    /* Focus starts on Close, not the push button: its tooltip would take the first Escape. */
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes from the Close button, returning focus to the Expand button", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    const expand = screen.getByRole("button", { name: "Expand Notepad" });
    await user.click(expand);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(expand).toHaveFocus();
  });
});
