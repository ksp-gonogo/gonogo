import { registerTheme } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ThemeHost } from "./ThemeHost";
import { ThemeRow } from "./ThemeRow";
import { chosenThemeId } from "./themeChoice";

const LIGHT = {
  ...defaultDarkTheme,
  colors: {
    ...defaultDarkTheme.colors,
    text: { ...defaultDarkTheme.colors.text, primary: "#102030" },
  },
};

beforeAll(() => {
  registerTheme({
    id: "default-dark",
    name: "Default Dark",
    theme: defaultDarkTheme,
  });
  registerTheme({ id: "light-probe", name: "Light Probe", theme: LIGHT });
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("the theme row", () => {
  it("offers every registered theme, default first, and starts on the default", () => {
    render(<ThemeRow />);
    const select = screen.getByLabelText("Theme") as HTMLSelectElement;
    const names = [...select.options].map((o) => o.text);
    expect(names[0]).toBe("Default Dark");
    expect(names).toContain("Light Probe");
    expect(select.value).toBe("default-dark");
  });

  it("keeps the choice on this device and restyles the page at once", async () => {
    render(
      <ThemeHost>
        <ThemeRow />
      </ThemeHost>,
    );
    await act(async () => {
      await userEvent.selectOptions(
        screen.getByLabelText("Theme"),
        "light-probe",
      );
    });
    expect(localStorage.getItem("gonogo.theme")).toBe("light-probe");
    expect(chosenThemeId()).toBe("light-probe");
    expect(
      document.documentElement.style.getPropertyValue("--color-text-primary"),
    ).toBe("#102030");
  });

  it("falls back to the default when the stored theme is not registered", () => {
    localStorage.setItem("gonogo.theme", "gone");
    expect(chosenThemeId()).toBe("default-dark");
  });
});
