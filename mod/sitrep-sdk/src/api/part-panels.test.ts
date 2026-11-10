import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineUplinkClient } from "../spine/uplink-clients";
import {
  clearPartPanels,
  getPartPanels,
  onPartPanelsChange,
  registerPartPanel,
} from "./part-panels";

const Panel = () => null;

beforeEach(() => clearPartPanels());

describe("part panels", () => {
  it("lists a panel under the id it was given and returns that id", () => {
    const id = registerPartPanel({ id: "a", title: "A", component: Panel });
    expect(id).toBe("a");
    expect(getPartPanels().map((p) => p.id)).toEqual(["a"]);
  });

  it("prefixes an Uplink's panel with its id and stamps the owner", () => {
    const handle = defineUplinkClient({
      id: "part-panel-test",
      version: "1.0.0",
      name: "Test",
      description: "Test",
    });
    const id = handle.registerPartPanel({
      id: "aim",
      title: "Aim",
      component: Panel,
    });
    expect(id).toBe("part-panel-test:aim");
    expect(getPartPanels()[0].owner?.id).toBe("part-panel-test");
  });

  it("replaces a panel registered again under the same title", () => {
    registerPartPanel({ id: "a", title: "A", component: Panel, width: "1px" });
    registerPartPanel({ id: "a", title: "A", component: Panel, width: "2px" });
    expect(getPartPanels()).toHaveLength(1);
    expect(getPartPanels()[0].width).toBe("2px");
  });

  it("refuses an id already taken under another title", () => {
    registerPartPanel({ id: "a", title: "A", component: Panel });
    expect(() =>
      registerPartPanel({ id: "a", title: "B", component: Panel }),
    ).toThrow(/already registered/);
  });

  it("keeps the same list between changes and announces each change", () => {
    const cb = vi.fn();
    const stop = onPartPanelsChange(cb);
    registerPartPanel({ id: "a", title: "A", component: Panel });
    const first = getPartPanels();
    expect(getPartPanels()).toBe(first);
    expect(cb).toHaveBeenCalledTimes(1);
    stop();
    registerPartPanel({ id: "b", title: "B", component: Panel });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getPartPanels()).not.toBe(first);
  });
});
