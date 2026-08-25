import { useTelemetry } from "@ksp-gonogo/core";
import {
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
} from "@ksp-gonogo/ui-kit";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import styled from "styled-components";

interface VantageOption extends ComboboxOption {
  isHome: boolean;
}

/**
 * Which active roster entry counts as the HOME command centre: the canonical
 * routing point every currency spend will use regardless of the operator's
 * own selected vantage (see `local_docs/design/2026-08-15-currency-spend-vantage-model.md`,
 * decided but not yet built). The roster carries no explicit home flag to
 * read, so this is a convention, not a fact off the wire: `"ksc"` is today's
 * only possible home (the one centre every save starts with), not a
 * permanent rule. Every "which one is home" question in this file funnels
 * through this single function, so a future explicit marker (or a save with
 * a genuine alternate home) only has one call site to change.
 */
function resolveHomeCentreId(
  active: readonly { id: string }[],
): string | undefined {
  return (active.find((c) => c.id === "ksc") ?? active[0])?.id;
}

/**
 * The command centre this mission control commands from and observes at:
 * each active centre's own light-time defines the delay on every
 * downlink and command, so switching one re-points the whole view (via
 * `client.setVantage`, which re-subscribes every active topic at the new
 * vantage's offset).
 *
 * The dropdown affordance is always present, even with a single (or zero)
 * enumerated centre: a stock save with only KSC still shows the same control
 * a multi-centre save does, rather than swapping to a plain readout, so an
 * operator discovers "other command centres are a thing" from the control's
 * shape alone. Opening it with one option still works, it just has one
 * option to land on.
 */
export function VantageControl() {
  // FAIL-OPEN FIX as well as a migration: `(roster ?? [])` never took its
  // fallback once the read became a Reading, so the filter below ran against a
  // Reading rather than a list. Ground-side and declared unmodellable, so a
  // stale roster is still the roster and only never-arrived is empty.
  const rosterReading = useTelemetry("commandCentre.roster");
  const roster =
    rosterReading.state === "observed" || rosterReading.state === "stale"
      ? rosterReading.value
      : undefined;
  const selected = useSelectedVantage();
  const client = useTelemetryClientOptional();

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const optionIdPrefix = useId();
  const optionId = (key: string) => `${optionIdPrefix}-${key}`;

  const active = (roster ?? []).filter(
    (c): c is typeof c & { id: string } => c.active && c.id != null,
  );
  const homeId = resolveHomeCentreId(active);

  const options: VantageOption[] = active.map((c) => ({
    key: c.id,
    label: c.displayName ?? c.id,
    isHome: c.id === homeId,
  }));

  const selectedOption = options.find((o) => o.key === selected);
  // Never empty: before the roster has arrived (or for a vantage the roster
  // doesn't carry) fall back to the raw selected id rather than rendering
  // nothing.
  const selectedLabel = selectedOption?.label ?? selected;
  const selectedIsHome = selectedOption
    ? selectedOption.isHome
    : selected === homeId;

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
        {selectedIsHome && <Badge size="sm">Home</Badge>}
        <ChevronDownIcon size={12} />
      </Trigger>
      {open &&
        (options.length > 0 ? (
          <ComboboxListbox
            id={listboxId}
            groups={[["Command Centres", options]]}
            flatOptions={options}
            activeIndex={activeIndex}
            selectedKey={selected}
            getOptionId={optionId}
            onHoverIndex={setActiveIndex}
            onSelectKey={selectOption}
            ariaLabel="Command centres"
            renderItem={(opt) => (
              <>
                <span>{opt.label}</span>
                {opt.isHome && <Badge size="sm">Home</Badge>}
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

const Trigger = styled(ActionButton)`
  font-size: var(--font-size-xs);
`;

const TriggerValue = styled.span`
  font-variant-numeric: tabular-nums;
`;

const EmptyPopover = styled.div`
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  min-width: 180px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm, 3px);
  z-index: var(--z-dropdown, 200);
`;
