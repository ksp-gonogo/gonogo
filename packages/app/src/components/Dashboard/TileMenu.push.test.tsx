import { render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  type PeerClient,
  PeerClientProvider,
} from "../../peer/PeerClientContext";
import { PushClientProvider } from "../../pushToMain/PushClientContext";
import { idlePeerClient } from "../../test/peerFakes";
import { TileMenu } from "./TileMenu";

const item = { i: "w1", componentId: "c", x: 0, y: 0, w: 2, h: 2 };

async function openMenu(pushable: boolean) {
  const client: PeerClient = {
    ...idlePeerClient(),
    getApproval: () => "approved",
    getHostSeat: () => "main",
  };
  render(
    <PeerClientProvider client={client}>
      <PushClientProvider>
        <TileMenu
          item={item as never}
          name="Altitude"
          pushable={pushable}
          w={2}
          h={2}
          isFirst
          isLast
          half={false}
          halfHeight={false}
          onMoveUp={() => {}}
          onMoveDown={() => {}}
          onToggleWidth={() => {}}
          onToggleHeight={() => {}}
          onRemove={() => {}}
        />
      </PushClientProvider>
    </PeerClientProvider>,
  );
  await userEvent
    .setup({ pointerEventsCheck: 0 })
    .click(screen.getByRole("button", { name: "Altitude options" }));
}

describe("the list dashboard's tile menu on a station", () => {
  it("offers Push to main for a pushable widget", async () => {
    await openMenu(true);
    expect(
      screen.getByRole("menuitem", { name: "Push to main" }),
    ).toBeInTheDocument();
  });

  it("offers no push for a widget that is not pushable", async () => {
    await openMenu(false);
    expect(screen.queryByRole("menuitem", { name: /main/ })).toBeNull();
  });
});
