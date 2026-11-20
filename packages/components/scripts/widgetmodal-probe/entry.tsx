import "../probe/probe-install-host";
import { registerComponent } from "@ksp-gonogo/core";
import { defaultDarkTheme, ModalProvider } from "@ksp-gonogo/ui-kit";
import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { GridItemContent } from "../../../app/src/components/Dashboard/GridItemContent";
import { PeerClientProvider } from "../../../app/src/peer/PeerClientContext";
import { PushClientProvider } from "../../../app/src/pushToMain/PushClientContext";
import { idlePeerClient } from "../../../app/src/test/peerFakes";
import {
  SerialDeviceProvider,
  SerialDeviceService,
} from "../../../serial/dist/index.js";
import type { ProbePayload } from "../probe/payload";
import { mountProbe, type ProbeMount } from "../probe/probe-entry";

/** A widget with state nothing saves: typed text, a scrolled list and a count of its own mounts. */
const LINES = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`);
let mounts = 0;
function Notepad({ w, h }: { w?: number; h?: number }) {
  const [id] = useState(() => ++mounts);
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        boxSizing: "border-box",
        background: "var(--color-surface-panel)",
        fontSize: "var(--font-size-compact)",
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        Draft
        <textarea
          aria-label="Draft"
          rows={3}
          style={{
            resize: "none",
            font: "inherit",
            background: "var(--color-surface-app)",
            color: "inherit",
            border: "1px solid var(--color-border-subtle)",
          }}
        />
      </label>
      <div
        data-testid="scroller"
        style={{
          flex: 1,
          overflow: "auto",
          border: "1px solid var(--color-border-subtle)",
        }}
      >
        {LINES.map((line) => (
          <div key={line} style={{ padding: "2px 8px" }}>
            {line}
          </div>
        ))}
      </div>
      <output data-testid="facts">{`instance ${id}, ${w} x ${h} units`}</output>
    </div>
  );
}
registerComponent({
  id: "notepad",
  name: "Notepad",
  description: "A widget with local state",
  tags: [],
  component: Notepad,
  expandable: true,
  pushable: true,
});

export interface MockPayload {
  widgetId: string;
  fixture: Record<string, unknown>;
  config: Record<string, unknown>;
  w: number;
  h: number;
  pxW: number;
  pxH: number;
}

const serialService = new SerialDeviceService({ screenKey: "probe" });
let mount: ProbeMount | null = null;
const shell: Root | null = null;

(window as unknown as { __mock: (p: MockPayload) => Promise<void> }).__mock =
  async (p) => {
    mount?.unmount();
    const el = document.getElementById("root");
    if (!el) throw new Error("no root");
    el.replaceChildren();
    const cell = document.createElement("div");
    el.style.padding = "30px 20px";
    Object.assign(cell.style, { position: "relative" });
    el.append(cell);
    /* The probe clips the cell it mounts into and a tile's drag header is drawn above the tile, so the cell keeps a gap above for it. */
    const payload: ProbePayload = {
      ...p,
      pxH: p.pxH + 20,
      series: p.fixture._series as ProbePayload["series"],
    };
    /* The tile chrome stays outside the probe's own providers so that its modal is the app's real one. */
    const client = {
      ...idlePeerClient(),
      getApproval: () => "approved" as const,
      getHostSeat: () => "main" as const,
    };
    mount = mountProbe(cell, payload, {
      wrap: () =>
        createElement(
          ThemeProvider,
          { theme: defaultDarkTheme },
          createElement(
            PeerClientProvider,
            { client } as never,
            createElement(
              PushClientProvider,
              null,
              createElement(
                ModalProvider,
                null,
                createElement(
                  "div",
                  {
                    style: {
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      marginTop: 20,
                      width: p.pxW,
                      height: p.pxH,
                    },
                  },
                  <SerialDeviceProvider service={serialService}>
                    <GridItemContent
                      item={{
                        i: "tile",
                        componentId: p.widgetId,
                        config: p.config,
                      }}
                      w={p.w}
                      h={p.h}
                      updateItemConfig={() => {}}
                      updateItemMappings={() => {}}
                      removeItem={() => {}}
                    />
                  </SerialDeviceProvider>,
                ),
              ),
            ),
          ),
        ),
    });
    await mount.ready;
  };
void shell;
