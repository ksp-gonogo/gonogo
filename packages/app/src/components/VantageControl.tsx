import { useScreen, useTelemetry } from "@ksp-gonogo/core";
import {
  useObservedVantage,
  useSelectedVantage,
  useTelemetryClientOptional,
} from "@ksp-gonogo/sitrep-client";
import {
  ActionButton,
  Badge,
  ChevronDownIcon,
  ComboboxListbox,
  type ComboboxOption,
  EmptyState,
  HomeIcon,
  Text,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import styled from "styled-components";

interface VantageOption extends ComboboxOption {
  isHome: boolean;
}

interface ActiveCentre {
  id: string;
  displayName?: string | null;
  isHome?: boolean;
}

/**
 * Which active roster entry is the HOME command centre, the one holding the
 * career ledger, read off the flag the mod publishes. Never inferred from an id
 * or a position in the list. A ground station standing in for a home the mod
 * could not identify carries the same flag, and `HomeFallbackNotice` is what
 * explains it; only a roster with no ground station at all has no home.
 */
function resolveHomeCentreId(
  active: readonly { id: string; isHome?: boolean }[],
): string | undefined {
  return active.find((c) => c.isHome === true)?.id;
}

/** The currently-active command centres, and which of them is home. */
export function useActiveCentres(): {
  active: ActiveCentre[];
  homeId: string | undefined;
} {
  // FAIL-OPEN FIX as well as a migration: `(roster ?? [])` never took its
  // fallback once the read became a Reading, so the filter below ran against a
  // Reading rather than a list. Ground-side and declared unmodellable, so a
  // stale roster is still the roster and only never-arrived is empty.
  const rosterReading = useTelemetry("commandCentre.roster");
  const roster =
    rosterReading.state === "observed" || rosterReading.state === "stale"
      ? rosterReading.value
      : undefined;
  const active = (roster ?? []).filter(
    (c): c is typeof c & { id: string } => c.active && c.id != null,
  );
  return { active, homeId: resolveHomeCentreId(active) };
}

/**
 * The command centre in force, rendered as a chooser on the main screen and as
 * a plain statement of fact on a station.
 *
 * A station reads the vantage, it does not pick one. The mod keeps the
 * vantage on the `ClientSession` and a host has exactly one session,
 * so two stations at two vantages would need two differently-delayed streams
 * down one socket: per-station vantage is not implementable without a wire
 * change, quite apart from being unwanted. But a station operator reading
 * delayed data still has to know WHICH centre it is delayed from or they cannot
 * interpret any of it, so the answer stays on screen; only the lever goes.
 *
 * A PILOT reads it too, for a different reason. `PilotVantage` pins that seat
 * to the craft the human is aboard, so the lever would be a control that
 * fights its own binding: pick anything else and the next frame puts it back.
 * The seat is defined by where the operator IS, and that is not theirs to
 * choose. Nothing is lost that the mod would have allowed either, since a
 * craft the pin cannot reach is one `set-vantage` refuses anyway.
 */
export function VantageControl() {
  return useScreen() === "main" ? <VantagePicker /> : <VantageReadout />;
}

/**
 * What a seat that does not choose sees: the command centre its frames were
 * actually delayed from, stated and nothing more.
 *
 * Sourced from the frames rather than from `useSelectedVantage`, which on a
 * station never leaves `undefined` because a station chooses nothing. Before
 * any frame has named one there is nothing to state, and saying so is the
 * point: "we do not know yet" and "we are at home" are different facts and
 * must not look alike.
 */
function VantageReadout() {
  const { active, homeId } = useActiveCentres();
  const observed = useObservedVantage();
  const entry = active.find((c) => c.id === observed);

  return (
    <VantageReadout__Root role="status" aria-live="polite">
      <VisuallyHidden>Command centre vantage: </VisuallyHidden>
      {observed === undefined ? (
        <Text tone="muted" size="xs">
          Unknown
        </Text>
      ) : (
        <>
          <Text tone="default" size="xs">
            {entry?.displayName ?? observed}
          </Text>
          {observed === homeId && <HomeBadge />}
        </>
      )}
    </VantageReadout__Root>
  );
}

/**
 * The home marker, shared by the picker's closed trigger and its open list
 * row so the two never drift: a glyph inside the same dark badge container
 * either one already uses for state. The glyph is decorative, the visually
 * hidden text is what carries "home" into the accessible name.
 */
function HomeBadge() {
  return (
    <Badge size="sm">
      <VantageControl__HomeGlyph size={12} aria-hidden="true" />
      <VisuallyHidden>Home</VisuallyHidden>
    </Badge>
  );
}

/**
 * The main screen's chooser: each active centre's own light-time
 * defines the delay on every downlink and command, so switching one re-points
 * the whole view (via `client.setVantage`, which re-subscribes every active
 * topic at the new vantage's offset).
 *
 * The dropdown affordance is always present, even with a single (or zero)
 * enumerated centre: a stock save with only KSC still shows the same control
 * a multi-centre save does, rather than swapping to a plain readout, so an
 * operator discovers "other command centres are a thing" from the control's
 * shape alone. Opening it with one option still works, it just has one
 * option to land on.
 */
function VantagePicker() {
  const { active, homeId } = useActiveCentres();
  // Until this screen chooses, the mod has put it wherever a fresh connection
  // starts, and only the frames say where that is.
  const chosen = useSelectedVantage();
  const observed = useObservedVantage();
  const selected = chosen ?? observed;
  const client = useTelemetryClientOptional();

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const optionIdPrefix = useId();
  const optionId = (key: string) => `${optionIdPrefix}-${key}`;

  const options: VantageOption[] = active.map((c) => ({
    key: c.id,
    label: c.displayName ?? c.id,
    isHome: c.id === homeId,
  }));

  const selectedOption = options.find((o) => o.key === selected);
  // Never empty: for a vantage the roster doesn't carry fall back to the raw
  // id, and before any frame has said where this screen is, say so.
  const selectedLabel = selectedOption?.label ?? selected ?? "Unknown";
  const selectedIsHome = selected !== undefined && selected === homeId;

  const closeMenu = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    containerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  const openMenu = useCallback(() => {
    setOpen(true);
    setActiveIndex(options.findIndex((o) => o.key === selected));
  }, [options, selected]);

  const selectOption = useCallback(
    (key: string) => {
      client?.setVantage(key);
      closeMenu();
    },
    [client, closeMenu],
  );

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [open]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    } else if (options.length === 0) {
      return;
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt) selectOption(opt.key);
    }
  };

  return (
    <Container ref={containerRef}>
      <Trigger
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={`Command centre vantage: ${selectedLabel}${
          selectedIsHome ? " (home)" : ""
        }`}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <TriggerValue>{selectedLabel}</TriggerValue>
        {selectedIsHome && <HomeBadge />}
        <ChevronDownIcon size={12} />
      </Trigger>
      {open &&
        (options.length > 0 ? (
          <ComboboxListbox
            id={listboxId}
            groups={[["Command Centres", options]]}
            flatOptions={options}
            activeIndex={activeIndex}
            selectedKey={selected ?? null}
            getOptionId={optionId}
            onHoverIndex={setActiveIndex}
            onSelectKey={selectOption}
            ariaLabel="Command centres"
            renderItem={(opt) => (
              <>
                <span>{opt.label}</span>
                {opt.isHome && <HomeBadge />}
              </>
            )}
          />
        ) : (
          <EmptyPopover id={listboxId} role="status" aria-live="polite">
            <EmptyState layout="fill">No command centres available</EmptyState>
          </EmptyPopover>
        ))}
    </Container>
  );
}

const Container = styled.div`
  position: relative;
  display: inline-flex;
`;

/**
 * No border, no background, no chevron, nothing focusable: the picker's
 * `ActionButton` shell is exactly what must not survive here, because a control
 * a station operator cannot work is worse than no control at all.
 */
const VantageReadout__Root = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-related);
`;

const Trigger = styled(ActionButton)`
  font-size: var(--font-size-compact);
`;

const TriggerValue = styled.span`
  font-variant-numeric: tabular-nums;
`;

/**
 * The glyph carries no accessible name of its own (`aria-hidden`); the
 * `VisuallyHidden` "Home" beside it in `HomeBadge` is what a screen reader
 * announces. `vertical-align` centres the small glyph against the badge's
 * uppercase text baseline rather than sitting on it, which is where an inline
 * svg defaults to.
 */
const VantageControl__HomeGlyph = styled(HomeIcon)`
  vertical-align: -2px;
`;

const EmptyPopover = styled.div`
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  min-width: 180px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-regular);
  z-index: var(--z-dropdown);
`;
