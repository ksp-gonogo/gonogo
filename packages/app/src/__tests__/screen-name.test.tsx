import { useScreenName } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { StationIdentityProvider } from "../stationIdentity";
import { StationIdentityService } from "../stationIdentity/StationIdentityService";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => Array.from(data.keys())[i] ?? null,
    removeItem: (k) => {
      data.delete(k);
    },
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

function Name() {
  return <span data-testid="name">{useScreenName() ?? "none"}</span>;
}

describe("useScreenName", () => {
  it("is undefined with no identity mounted", () => {
    render(<Name />);
    expect(screen.getByTestId("name").textContent).toBe("none");
  });

  it("reads the screen's name and follows a rename", () => {
    const storage = memoryStorage();
    storage.setItem("gonogo.station.name", "Guidance");
    const service = new StationIdentityService(storage);
    render(
      <StationIdentityProvider service={service}>
        <Name />
      </StationIdentityProvider>,
    );
    expect(screen.getByTestId("name").textContent).toBe("Guidance");
    act(() => service.setName("Flight Director"));
    expect(screen.getByTestId("name").textContent).toBe("Flight Director");
  });
});
