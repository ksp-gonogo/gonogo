import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  AUTO_PORT_FORWARD_SETTING,
  COMPUTER_ADDRESS_SETTING,
  ROUTER_ADDRESS_SETTING,
} from "../../relay/autoPortForward";
import { SettingsProvider } from "../../settings/SettingsContext";
import { SettingsService } from "../../settings/SettingsService";
import { say } from "../copy";
import { FriendsStep } from "./FriendsStep";

let mapping: { state: string; message: string } | null = null;
const server = setupServer(
  http.get("http://localhost:3002/port-forward", () =>
    HttpResponse.json({ enabled: mapping !== null, portMapping: mapping }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => {
  mapping = null;
  localStorage.clear();
});
afterAll(() => server.close());

/** Choose automatic forwarding and type both addresses. */
async function chooseAutomatic(
  router = "203.0.113.1",
  computer = "203.0.113.20",
) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("radio", { name: say("friends.choice.auto") }),
  );
  if (router) {
    await user.type(
      screen.getByRole("textbox", { name: say("friends.router.label") }),
      router,
    );
  }
  if (computer) {
    await user.type(
      screen.getByRole("textbox", { name: say("friends.computer.label") }),
      computer,
    );
  }
}

function renderStep(settings = new SettingsService()) {
  const result = render(
    <SettingsProvider service={settings}>
      <FriendsStep />
    </SettingsProvider>,
  );
  return { ...result, settings };
}

describe("the setup's friends on other networks step", () => {
  it("starts on this network only, with automatic port forwarding off", () => {
    const { settings } = renderStep();
    expect(
      screen.getByRole("radio", { name: say("friends.choice.local") }),
    ).toBeChecked();
    expect(settings.get(AUTO_PORT_FORWARD_SETTING, null)).toBeNull();
    expect(screen.getByText(say("friends.local"))).toBeInTheDocument();
  });

  it("turns on automatic port forwarding and shows what the router answered", async () => {
    mapping = {
      state: "mapped",
      message: "Your router opened the relay's port.",
    };
    const { settings } = renderStep();
    await chooseAutomatic();
    expect(settings.get(AUTO_PORT_FORWARD_SETTING, null)).toBe(true);
    expect(settings.get(ROUTER_ADDRESS_SETTING, null)).toBe("203.0.113.1");
    expect(settings.get(COMPUTER_ADDRESS_SETTING, null)).toBe("203.0.113.20");
    expect(
      await screen.findByText(say("friends.check.pass", { port: 47100 })),
    ).toBeInTheDocument();
    expect(screen.queryByText(/forward port 47100/)).toBeNull();
  });

  it("says why when the router refuses", async () => {
    mapping = {
      state: "refused",
      message: "Your router refused to open the relay's port",
    };
    renderStep();
    await chooseAutomatic();
    expect(
      await screen.findByText("Your router refused to open the relay's port"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/forward port 47100, UDP and TCP/),
    ).toBeInTheDocument();
  });

  it("asks for both addresses, and refuses one that is not an address", async () => {
    const { settings } = renderStep();
    await chooseAutomatic("203.0.113");
    expect(
      screen.getByText(say("friends.address.invalid")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(say("friends.check.needAddress")),
    ).toBeInTheDocument();
    expect(settings.get(ROUTER_ADDRESS_SETTING, "")).toBe("");
  });

  it("waits for this computer's address before asking the router", async () => {
    mapping = {
      state: "mapped",
      message: "Your router opened the relay's port.",
    };
    renderStep();
    await chooseAutomatic("203.0.113.1", "");
    expect(
      screen.getByText(say("friends.check.needAddress")),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Your router opened port/)).toBeNull();
  });

  it("takes an IPv6 router address, and shows the relay's answer that it cannot ask it yet", async () => {
    mapping = {
      state: "ipv6-unsupported",
      message: "Gonogo cannot ask a router to open a port over IPv6 yet.",
    };
    const { settings } = renderStep();
    await chooseAutomatic("fe80::1%eth0", "2001:db8::20");
    expect(screen.queryByText(say("friends.address.invalid"))).toBeNull();
    expect(settings.get(ROUTER_ADDRESS_SETTING, null)).toBe("fe80::1%eth0");
    expect(
      await screen.findByText(/cannot ask a router to open a port over IPv6/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/forward port 47100, UDP and TCP/),
    ).toBeInTheDocument();
  });

  it("gives the port to forward by hand, and leaves automatic forwarding off", async () => {
    const { settings } = renderStep();
    await userEvent
      .setup()
      .click(screen.getByRole("radio", { name: say("friends.choice.manual") }));
    expect(settings.get(AUTO_PORT_FORWARD_SETTING, null)).toBe(false);
    expect(
      screen.getByText(/forward port 47100, UDP and TCP/),
    ).toBeInTheDocument();
  });

  it("opens on automatic when the player already chose it", () => {
    const settings = new SettingsService();
    settings.set(AUTO_PORT_FORWARD_SETTING, true);
    renderStep(settings);
    expect(
      screen.getByRole("radio", { name: say("friends.choice.auto") }),
    ).toBeChecked();
  });

  it("has no axe violations, with the router address field open", async () => {
    const { container } = renderStep();
    await chooseAutomatic("203.0.113");
    await expectNoA11yViolations(container);
  });
});
