import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type PeerClient,
  PeerClientProvider,
} from "../../peer/PeerClientContext";
import { PushClientProvider } from "../../pushToMain/PushClientContext";
import { idlePeerClient } from "../../test/peerFakes";
import { PushButton } from "./shared";

const item = { i: "w1", componentId: "c", x: 0, y: 0, w: 2, h: 2 };

function pushButton(approval: ReturnType<PeerClient["getApproval"]>) {
  const client: PeerClient = {
    ...idlePeerClient(),
    getApproval: () => approval,
  };
  render(
    <PeerClientProvider client={client}>
      <PushClientProvider>
        <PushButton item={item as never} pushable w={2} h={2} />
      </PushClientProvider>
    </PeerClientProvider>,
  );
  return screen.getByRole("button", { name: "Push to main" });
}

describe("PushButton on a station", () => {
  it("is dark while the main screen has not approved the station", () => {
    expect((pushButton("pending") as HTMLButtonElement).disabled).toBe(true);
  });

  it("is live once approved", () => {
    expect((pushButton("approved") as HTMLButtonElement).disabled).toBe(false);
  });
});
