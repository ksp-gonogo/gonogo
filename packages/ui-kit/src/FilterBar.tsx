import { useId } from "react";
import styled from "styled-components";
import { Cluster } from "./Cluster";
import { Field, FieldLabel, Select } from "./Form";
import { ToggleButton } from "./ToggleButton";

/**
 * The control a list widget renders for its contributed filters
 * (contribution-slots-spec §15). Purely presentational: it is handed
 * already-grouped axes and reports selections back, and knows nothing about
 * where any of them came from.
 *
 * **Semantics come from the group, presentation from here.** `selection` says
 * what the facets MEAN (`multi`: independent, OR'd; `single`: mutually
 * exclusive) and is stated by whoever contributed the axis. This component
 * picks the control, and may vary it with option count, but never at the cost
 * of the semantics: a `multi` group always renders a control that can hold
 * more than one selection, so it stays multi-select on a twelve-option vessel
 * exactly as it was on a three-option one. A `single` group is the only one
 * that may collapse to a dropdown.
 *
 * The layer-1 rendering, then:
 *
 * - `multi` renders as a wrapping row of `ToggleButton` chips, at any count.
 *   Many options crowd, which is the accepted cost of not silently dropping
 *   the OR; a denser multi-select control can replace this later without any
 *   contributor changing
 * - `single` renders as a `Select` with a show-all option first
 *
 * Nothing selected means nothing hidden, so an unselected bar is a no-op.
 */

export interface FilterBarOption {
  id: string;
  label: string;
  active: boolean;
}

export interface FilterBarGroup {
  id: string;
  /** Axis label. Omitted for a standalone filter with nothing to call itself. */
  label?: string;
  selection: "single" | "multi";
  options: readonly FilterBarOption[];
}

export interface FilterBarProps {
  groups: readonly FilterBarGroup[];
  /** One group's new selection. Empty means "show all" for that axis. */
  onChange: (groupId: string, selectedOptionIds: readonly string[]) => void;
  /** Show-all label for a `single` group, e.g. "All resources". */
  allLabel?: string;
}

const FilterBar__Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6, 6px);
`;

const FilterBar__GroupLabel = styled.span`
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

function ChipGroup({
  group,
  onChange,
}: Readonly<{
  group: FilterBarGroup;
  onChange: FilterBarProps["onChange"];
}>) {
  const toggle = (optionId: string) => {
    const next = group.options
      .filter((option) =>
        option.id === optionId ? !option.active : option.active,
      )
      .map((option) => option.id);
    onChange(group.id, next);
  };

  return (
    <Cluster
      justify="start"
      gap="xs"
      wrap
      role="group"
      aria-label={group.label ?? "Filters"}
    >
      {group.label !== undefined && (
        <FilterBar__GroupLabel>{group.label}</FilterBar__GroupLabel>
      )}
      {group.options.map((option) => (
        <ToggleButton
          key={option.id}
          size="sm"
          active={option.active}
          onClick={() => toggle(option.id)}
        >
          {option.label}
        </ToggleButton>
      ))}
    </Cluster>
  );
}

const SHOW_ALL = "";

function SelectGroup({
  group,
  onChange,
  allLabel,
}: Readonly<{
  group: FilterBarGroup;
  onChange: FilterBarProps["onChange"];
  allLabel: string;
}>) {
  const selectId = useId();
  const active = group.options.find((option) => option.active);

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>{group.label ?? "Filter"}</FieldLabel>
      <Select
        id={selectId}
        value={active?.id ?? SHOW_ALL}
        onChange={(event) =>
          onChange(
            group.id,
            event.target.value === SHOW_ALL ? [] : [event.target.value],
          )
        }
      >
        {/* Show-all is the default and the first option: nothing is hidden
            until an operator chooses to hide it. */}
        <option value={SHOW_ALL}>{allLabel}</option>
        {group.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function FilterBar({
  groups,
  onChange,
  allLabel = "All",
}: Readonly<FilterBarProps>) {
  const shown = groups.filter((group) => group.options.length > 0);
  if (shown.length === 0) return null;

  return (
    <FilterBar__Body>
      {shown.map((group) =>
        group.selection === "single" ? (
          <SelectGroup
            key={group.id}
            group={group}
            onChange={onChange}
            allLabel={allLabel}
          />
        ) : (
          <ChipGroup key={group.id} group={group} onChange={onChange} />
        ),
      )}
    </FilterBar__Body>
  );
}
