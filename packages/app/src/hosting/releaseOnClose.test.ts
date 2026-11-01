import { describe, expect, it, vi } from "vitest";
import type { HostRole } from "./HostRole";
import { type PageEvents, releaseOnClose } from "./releaseOnClose";

type Listener = (event: never) => void;

function fakePage(withNavigation = true) {
  const page = new Map<string, Listener>();
  const navigation = new Map<string, Listener>();
  const events: PageEvents = {
    addEventListener: (type, l) => void page.set(type, l as Listener),
    removeEventListener: (type) => void page.delete(type),
    navigation: withNavigation
      ? {
          addEventListener: (type, l) =>
            void navigation.set(type, l as Listener),
          removeEventListener: (type) => void navigation.delete(type),
        }
      : undefined,
  };
  return {
    events,
    navigate: (navigationType: string) =>
      navigation.get("navigate")?.({ navigationType } as never),
    hide: (persisted: boolean) =>
      page.get("pagehide")?.({ persisted } as never),
    listening: () => page.size + navigation.size,
  };
}

const roleSpy = () => {
  const release = vi.fn();
  const role: Pick<HostRole, "release"> = { release };
  return { role: role as HostRole, release };
};

describe("releaseOnClose", () => {
  it("releases the role when the page goes away for good", () => {
    const { role, release } = roleSpy();
    const page = fakePage();
    releaseOnClose(role, page.events);
    page.hide(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases when the page navigates elsewhere", () => {
    const { role, release } = roleSpy();
    const page = fakePage();
    releaseOnClose(role, page.events);
    page.navigate("push");
    page.hide(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("keeps the role across a reload", () => {
    const { role, release } = roleSpy();
    const page = fakePage();
    releaseOnClose(role, page.events);
    page.navigate("reload");
    page.hide(false);
    expect(release).not.toHaveBeenCalled();
  });

  it("keeps the role when the page enters the back-forward cache", () => {
    const { role, release } = roleSpy();
    const page = fakePage();
    releaseOnClose(role, page.events);
    page.hide(true);
    expect(release).not.toHaveBeenCalled();
  });

  it("leaves the role to the grace where the browser cannot tell a reload from a close", () => {
    const { role, release } = roleSpy();
    const page = fakePage(false);
    releaseOnClose(role, page.events);
    page.hide(false);
    expect(release).not.toHaveBeenCalled();
    expect(page.listening()).toBe(0);
  });

  it("stops listening when detached", () => {
    const { role, release } = roleSpy();
    const page = fakePage();
    releaseOnClose(role, page.events)();
    page.hide(false);
    expect(release).not.toHaveBeenCalled();
    expect(page.listening()).toBe(0);
  });
});
