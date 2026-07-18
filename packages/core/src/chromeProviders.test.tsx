import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearChromeProviders,
  registerChromeProvider,
  useChromeWrap,
} from "./chromeProviders";

const FixtureContext = createContext<string | undefined>(undefined);

function FixtureProvider({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return (
    <FixtureContext.Provider value={value}>{children}</FixtureContext.Provider>
  );
}

function useFixtureValue(): string {
  const v = useContext(FixtureContext);
  if (v === undefined) throw new Error("outside FixtureProvider");
  return v;
}

function Consumer() {
  const v = useContext(FixtureContext);
  return <div>consumer-saw:{v ?? "MISSING"}</div>;
}

// Simulates ModalProvider: rendered as a SIBLING of FixtureProvider's
// subtree (not a descendant) so ambient context genuinely can't reach it —
// this is the real shape of ComponentOverlay's openModal() escape, not a
// same-tree portal (React portals via createPortal still preserve
// context; ComponentOverlay's modal content is hoisted to a different
// RENDER position, which is what actually breaks ambient context).
function ModalHost({
  openRef,
}: {
  openRef: React.MutableRefObject<(c: ReactNode) => void>;
}) {
  const [content, setContent] = useState<ReactNode>(null);
  useEffect(() => {
    openRef.current = setContent;
  }, [openRef]);
  return <div data-testid="modal-host">{content}</div>;
}

function ChromeCaller({ onOpen }: { onOpen: (c: ReactNode) => void }) {
  const wrap = useChromeWrap();
  return (
    <button type="button" onClick={() => onOpen(wrap(<Consumer />))}>
      open
    </button>
  );
}

function App() {
  const openRef = useRef<(c: ReactNode) => void>(() => {});
  return (
    <>
      <ModalHost openRef={openRef} />
      <FixtureProvider value="root-value">
        <ChromeCaller onOpen={(c) => openRef.current(c)} />
      </FixtureProvider>
    </>
  );
}

afterEach(() => {
  clearChromeProviders();
});

describe("chromeProviders", () => {
  it("useChromeWrap is identity when nothing is registered", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    // No provider registered — the modal host never gets the value back.
    expect(screen.getByText("consumer-saw:MISSING")).toBeTruthy();
  });

  it("re-provides a registered context value around content rendered outside the original subtree", () => {
    registerChromeProvider({
      id: "fixture",
      useValue: useFixtureValue,
      Provider: FixtureProvider,
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByText("consumer-saw:root-value")).toBeTruthy();
  });

  it("composes multiple registered providers", () => {
    const OtherContext = createContext<string | undefined>(undefined);
    function OtherProvider({
      value,
      children,
    }: {
      value: string;
      children: ReactNode;
    }) {
      return (
        <OtherContext.Provider value={value}>{children}</OtherContext.Provider>
      );
    }
    function useOtherValue(): string {
      const v = useContext(OtherContext);
      if (v === undefined) throw new Error("outside OtherProvider");
      return v;
    }
    function BothConsumer() {
      const a = useContext(FixtureContext);
      const b = useContext(OtherContext);
      return (
        <div>
          both:{a ?? "MISSING"}/{b ?? "MISSING"}
        </div>
      );
    }
    registerChromeProvider({
      id: "fixture",
      useValue: useFixtureValue,
      Provider: FixtureProvider,
    });
    registerChromeProvider({
      id: "other",
      useValue: useOtherValue,
      Provider: OtherProvider,
    });

    function App2() {
      const openRef = useRef<(c: ReactNode) => void>(() => {});
      function Caller() {
        const wrap = useChromeWrap();
        return (
          <button
            type="button"
            onClick={() => openRef.current(wrap(<BothConsumer />))}
          >
            open2
          </button>
        );
      }
      return (
        <>
          <ModalHost openRef={openRef} />
          <FixtureProvider value="root-value">
            <OtherProvider value="other-value">
              <Caller />
            </OtherProvider>
          </FixtureProvider>
        </>
      );
    }
    render(<App2 />);
    fireEvent.click(screen.getByRole("button", { name: "open2" }));
    expect(screen.getByText("both:root-value/other-value")).toBeTruthy();
  });
});
