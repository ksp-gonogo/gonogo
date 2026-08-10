/**
 * KerbcastAvatarAugment: the crew-status.avatar filler.
 *
 * Exercises the real component against a real `KerbcastDataSource`, with
 * only the WebRTC transport faked by the SDK's canonical `MockSidecar` (per
 * CLAUDE.md's testing philosophy: mock at the boundary, not the module).
 */

import {
  clearUplinkHandles,
  SettingsProvider,
  SettingsService,
} from "@ksp-gonogo/core";
import { CameraKind, CrewLocation } from "@ksp-gonogo/kerbcast";
import { MockSidecar } from "@ksp-gonogo/kerbcast/testing";
import { registerUplinkHandle } from "@ksp-gonogo/sitrep-sdk";
import { fireEvent, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KerbcastDataSource } from "../KerbcastDataSource";
import { axe } from "../test/axe";
import { KerbcastAvatarAugment } from "./index";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    length: m.size,
    clear: () => m.clear(),
    key: () => null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  } as Storage;
}

function Wrapper({
  embedded,
  children,
}: {
  embedded?: boolean;
  children: ReactNode;
}) {
  const service = new SettingsService(memoryStorage());
  if (embedded !== undefined)
    service.set("kerbcast.embeddedFacecams", embedded);
  return (
    <SettingsProvider service={service}>
      <ModalProvider>{children}</ModalProvider>
    </SettingsProvider>
  );
}

async function connectedDataSource(): Promise<{
  sidecar: MockSidecar;
  ds: KerbcastDataSource;
}> {
  const sidecar = new MockSidecar();
  const ds = new KerbcastDataSource({ port: 1 }, sidecar.createTransport());
  registerUplinkHandle("kerbcast", ds);
  vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
    Promise.resolve(
      String(input).includes("/ice-config")
        ? new Response(JSON.stringify({ iceServers: [] }), { status: 200 })
        : MockSidecar.makeOfferResponse([]),
    ),
  );
  await ds.connect();
  sidecar.open();
  sidecar.setConnectionState("connected");
  return { sidecar, ds };
}

afterEach(() => {
  clearUplinkHandles();
  vi.restoreAllMocks();
});

describe("KerbcastAvatarAugment: embedded-facecam kill-switch gate", () => {
  it("renders nothing when the switch is OFF, the subscribing child never mounts", () => {
    const { container } = render(
      <Wrapper embedded={false}>
        <KerbcastAvatarAugment crewName="Jebediah Kerman" crewIndex={0} />
      </Wrapper>,
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders nothing when ON but no kerbcast handle is registered", () => {
    const { container } = render(
      <Wrapper embedded>
        <KerbcastAvatarAugment crewName="Jebediah Kerman" crewIndex={0} />
      </Wrapper>,
    );
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("KerbcastAvatarAugment: kerbal correlation", () => {
  it("renders nothing when the kerbal has no matching camera (not seated)", async () => {
    const { sidecar } = await connectedDataSource();
    sidecar.setCameras([
      { flightId: 1, kind: CameraKind.Kerbal, cameraName: "Bill Kerman" },
    ]);

    const { container } = render(
      <Wrapper embedded>
        <KerbcastAvatarAugment crewName="Jebediah Kerman" crewIndex={0} />
      </Wrapper>,
    );

    // Give the cameras-change subscription a tick to settle, then confirm
    // nothing rendered for the unmatched kerbal.
    await Promise.resolve();
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders the live face with an IVA badge for a seated kerbal camera", async () => {
    const { sidecar } = await connectedDataSource();
    sidecar.setCameras([
      {
        flightId: 42,
        kind: CameraKind.Kerbal,
        cameraName: "Jebediah Kerman",
        crewLocation: CrewLocation.Seat,
      },
    ]);

    render(
      <Wrapper embedded>
        <KerbcastAvatarAugment crewName="Jebediah Kerman" crewIndex={0} />
      </Wrapper>,
    );

    await screen.findByRole("button", {
      name: /spotlight jebediah kerman's seated face camera/i,
    });
    expect(screen.getByText("IVA")).not.toBeNull();
  });

  it("renders an EVA badge instead once the same kerbal's camera flips to EVA", async () => {
    const { sidecar } = await connectedDataSource();
    sidecar.setCameras([
      {
        flightId: 42,
        kind: CameraKind.Kerbal,
        cameraName: "Jebediah Kerman",
        crewLocation: CrewLocation.Eva,
      },
    ]);

    render(
      <Wrapper embedded>
        <KerbcastAvatarAugment crewName="Jebediah Kerman" crewIndex={0} />
      </Wrapper>,
    );

    await screen.findByRole("button", {
      name: /spotlight jebediah kerman's eva face camera/i,
    });
    expect(screen.getByText("EVA")).not.toBeNull();
  });

  it("ignores a part camera that happens to share the kerbal's cameraName", async () => {
    const { sidecar } = await connectedDataSource();
    sidecar.setCameras([
      { flightId: 1, kind: CameraKind.Part, cameraName: "Jebediah Kerman" },
    ]);

    const { container } = render(
      <Wrapper embedded>
        <KerbcastAvatarAugment crewName="Jebediah Kerman" crewIndex={0} />
      </Wrapper>,
    );

    await Promise.resolve();
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("KerbcastAvatarAugment: a11y smoke", () => {
  it("has no axe violations for a live seated-camera avatar", async () => {
    const { sidecar } = await connectedDataSource();
    sidecar.setCameras([
      {
        flightId: 42,
        kind: CameraKind.Kerbal,
        cameraName: "Jebediah Kerman",
        crewLocation: CrewLocation.Seat,
      },
    ]);

    const { container } = render(
      <Wrapper embedded>
        <KerbcastAvatarAugment crewName="Jebediah Kerman" crewIndex={0} />
      </Wrapper>,
    );
    await screen.findByRole("button", {
      name: /spotlight jebediah kerman's seated face camera/i,
    });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no axe violations with the spotlight modal open", async () => {
    const { sidecar } = await connectedDataSource();
    sidecar.setCameras([
      {
        flightId: 42,
        kind: CameraKind.Kerbal,
        cameraName: "Jebediah Kerman",
        crewLocation: CrewLocation.Seat,
      },
    ]);

    const { container } = render(
      <Wrapper embedded>
        <KerbcastAvatarAugment crewName="Jebediah Kerman" crewIndex={0} />
      </Wrapper>,
    );
    const button = await screen.findByRole("button", {
      name: /spotlight jebediah kerman's seated face camera/i,
    });
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole("dialog")).not.toBeNull();
    });

    const results = await axe(container.ownerDocument.body);
    expect(results).toHaveNoViolations();
  });
});

describe("KerbcastAvatarAugment: click-to-spotlight", () => {
  it("opens a modal with a larger face feed on click", async () => {
    const { sidecar } = await connectedDataSource();
    sidecar.setCameras([
      {
        flightId: 42,
        kind: CameraKind.Kerbal,
        cameraName: "Jebediah Kerman",
        crewLocation: CrewLocation.Seat,
      },
    ]);

    render(
      <Wrapper embedded>
        <KerbcastAvatarAugment crewName="Jebediah Kerman" crewIndex={0} />
      </Wrapper>,
    );

    const button = await screen.findByRole("button", {
      name: /spotlight jebediah kerman's seated face camera/i,
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).not.toBeNull();
    });
    expect(
      screen.getByRole("heading", { name: "Jebediah Kerman" }),
    ).not.toBeNull();
  });
});
