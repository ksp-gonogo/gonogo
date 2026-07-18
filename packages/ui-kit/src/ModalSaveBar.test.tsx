import { render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ModalChromeContext,
  type ModalChromeValue,
  useModalSaveBar,
} from "./ModalSaveBar";

const SAVED_VALUE = { label: "saved" };

/**
 * Minimal stand-in for `ui`'s `ModalDialog`: renders whatever footer/dirty
 * state the content registers via `useModalSaveBar` -> `useModalChrome`, so
 * this suite can exercise the hook without pulling in the full modal shell
 * (which lives in `@ksp-gonogo/ui` and needs `safeRandomUuid` from
 * `@ksp-gonogo/core` — a dependency this package must never take on).
 */
function ChromeHost({
  children,
  onDirtyChange,
}: {
  children: ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [footer, setFooter] = useState<ReactNode>(null);
  const [dirty, setDirtyState] = useState(false);
  const chrome: ModalChromeValue = {
    setFooter,
    setDirty: (d) => {
      setDirtyState(d);
      onDirtyChange?.(d);
    },
  };
  return (
    <ModalChromeContext.Provider value={chrome}>
      {children}
      <div data-testid="footer">{footer}</div>
      <div data-testid="dirty">{String(dirty)}</div>
    </ModalChromeContext.Provider>
  );
}

function SaveBarContent({ onSave }: { onSave: () => void }) {
  const [draft, setDraft] = useState(SAVED_VALUE);
  useModalSaveBar({ onSave, value: draft, saved: SAVED_VALUE });
  return (
    <button type="button" onClick={() => setDraft({ label: "edited" })}>
      edit
    </button>
  );
}

describe("useModalSaveBar", () => {
  it("renders a Save button into the registered footer", () => {
    render(
      <ChromeHost>
        <SaveBarContent onSave={vi.fn()} />
      </ChromeHost>,
    );
    expect(
      screen.getByTestId("footer").querySelector("button"),
    ).toHaveTextContent("Save");
  });

  it("fires onSave when the Save button is clicked", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <ChromeHost>
        <SaveBarContent onSave={onSave} />
      </ChromeHost>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("reports clean when the draft equals both the baseline and the saved value", () => {
    render(
      <ChromeHost>
        <SaveBarContent onSave={vi.fn()} />
      </ChromeHost>,
    );
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("reports dirty once the draft diverges from the baseline and saved value", async () => {
    const user = userEvent.setup();
    render(
      <ChromeHost>
        <SaveBarContent onSave={vi.fn()} />
      </ChromeHost>,
    );
    await user.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
  });

  it("is a no-op outside a ModalChromeContext provider", () => {
    // No fallback inline button — renders nothing, throws nothing.
    expect(() => render(<SaveBarContent onSave={vi.fn()} />)).not.toThrow();
  });
});
