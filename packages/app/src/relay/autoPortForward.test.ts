import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SettingsService } from "../settings/SettingsService";
import {
  AUTO_PORT_FORWARD_SETTING,
  postAutoPortForward,
  readPortForward,
  syncAutoPortForward,
} from "./autoPortForward";

const posted: unknown[] = [];
const server = setupServer(
  http.post("http://localhost:3002/port-forward", async ({ request }) => {
    posted.push(await request.json());
    return HttpResponse.json({ enabled: true, portMapping: null });
  }),
  http.get("http://localhost:3002/port-forward", () =>
    HttpResponse.json({
      enabled: true,
      portMapping: { state: "refused", message: "Your router refused" },
    }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => {
  posted.length = 0;
  localStorage.clear();
});
afterAll(() => server.close());

describe("automatic port forwarding setting", () => {
  it("leaves the relay's own starting value alone until the player chooses", () => {
    const settings = new SettingsService();
    const post = vi.fn(async () => {});
    const stop = syncAutoPortForward(settings, post);
    expect(post).not.toHaveBeenCalled();
    settings.set(AUTO_PORT_FORWARD_SETTING, true);
    expect(post).toHaveBeenCalledWith(true);
    stop();
    settings.dispose();
  });

  it("sends a choice already made as soon as it starts", () => {
    const settings = new SettingsService();
    settings.set(AUTO_PORT_FORWARD_SETTING, false);
    const post = vi.fn(async () => {});
    const stop = syncAutoPortForward(settings, post);
    expect(post).toHaveBeenCalledWith(false);
    stop();
    settings.dispose();
  });

  it("posts the switch to the relay and reads back where the forward stands", async () => {
    await postAutoPortForward(true);
    expect(posted).toEqual([{ enabled: true }]);
    expect(await readPortForward()).toEqual({
      enabled: true,
      mapping: { state: "refused", message: "Your router refused" },
    });
  });
});
