import {
  ComboboxListbox,
  type ComboboxOption,
  FieldLabel,
  filterComboboxOptions,
  flattenComboboxGroups,
  groupComboboxOptions,
  Input,
  moveComboboxActiveIndex,
  Text,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useMemo, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 340 }}>{children}</div>;
}

interface CrewOption extends ComboboxOption {
  role: string;
}

const CREW: CrewOption[] = [
  { key: "jeb", label: "Jebediah Kerman", group: "Kerbal X", role: "Pilot" },
  { key: "bill", label: "Bill Kerman", group: "Kerbal X", role: "Engineer" },
  { key: "bob", label: "Bob Kerman", group: "Kerbal X", role: "Scientist" },
  {
    key: "val",
    label: "Valentina Kerman",
    group: "Minmus Station",
    role: "Pilot",
  },
  { key: "gene", label: "Gene Kerman", group: "KSC", role: "Flight director" },
  {
    key: "wernher",
    label: "Wernher von Kerman",
    group: "KSC",
    role: "Engineer",
  },
];

/**
 * A combobox built on the listbox: an input that filters, arrow keys that move
 * the highlight, Enter or a click that commits. The listbox owns none of this.
 */
function CrewCombobox({
  options,
  initialQuery = "",
  placement = "below",
  emptyLabel,
  withRoles = false,
}: {
  options: CrewOption[];
  initialQuery?: string;
  placement?: "below" | "above";
  emptyLabel?: string;
  withRoles?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<string | null>("bill");
  const groups = useMemo(
    () => groupComboboxOptions(filterComboboxOptions(options, query)),
    [options, query],
  );
  const flat = useMemo(() => flattenComboboxGroups(groups), [groups]);
  const pickedName = options.find((o) => o.key === picked)?.label;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <FieldLabel htmlFor="crew-query">Assign crew</FieldLabel>
      <Text tone="muted" size="sm">
        {`Assigned: ${pickedName ?? "nobody"}`}
      </Text>
      <div style={{ position: "relative" }}>
        <Input
          id="crew-query"
          role="combobox"
          aria-expanded
          aria-controls="crew-list"
          aria-autocomplete="list"
          aria-activedescendant={
            flat[active] ? `crew-${flat[active].key}` : undefined
          }
          value={query}
          placeholder="Search crew..."
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => moveComboboxActiveIndex(i, 1, flat.length));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => moveComboboxActiveIndex(i, -1, flat.length));
              return;
            }
            if (e.key === "Enter" && flat[active]) setPicked(flat[active].key);
          }}
        />
        <ComboboxListbox
          id="crew-list"
          ariaLabel="Crew"
          groups={groups}
          flatOptions={flat}
          activeIndex={active}
          selectedKey={picked}
          getOptionId={(key) => `crew-${key}`}
          onHoverIndex={setActive}
          onSelectKey={setPicked}
          placement={placement}
          emptyLabel={emptyLabel}
          renderItem={
            withRoles
              ? (opt) => (
                  <>
                    <Text>{opt.label}</Text>
                    <Text tone="muted" size="sm">
                      {opt.role}
                    </Text>
                  </>
                )
              : undefined
          }
        />
      </div>
    </div>
  );
}

const meta = {
  title: "ui-kit/ComboboxListbox",
  component: ComboboxListbox,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: {
    id: "crew-list",
    groups: [],
    flatOptions: [],
    activeIndex: -1,
    getOptionId: (key: string) => key,
    onHoverIndex: () => {},
    onSelectKey: () => {},
  },
} satisfies Meta<typeof ComboboxListbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Crew grouped by where they are: the highlighted row carries the focus bar, the committed one the go tint. */
export const Grouped: Story = {
  render: () => (
    <div style={{ minHeight: 340 }}>
      <CrewCombobox options={CREW} withRoles />
    </div>
  ),
};

/** A typed query narrows the list by name, and groups with no match drop out. */
export const Filtered: Story = {
  render: () => (
    <div style={{ minHeight: 240 }}>
      <CrewCombobox options={CREW} initialQuery="b" withRoles />
    </div>
  ),
};

/** Ungrouped options collapse into one Other bucket and render as a flat list. */
export const Ungrouped: Story = {
  render: () => (
    <div style={{ minHeight: 300 }}>
      <CrewCombobox options={CREW.map(({ group: _group, ...rest }) => rest)} />
    </div>
  ),
};

/** Nothing matches the query: the list says so rather than closing. */
export const NoMatches: Story = {
  render: () => (
    <div style={{ minHeight: 200 }}>
      <CrewCombobox
        options={CREW}
        initialQuery="Kerbin"
        emptyLabel="No crew by that name"
      />
    </div>
  ),
};

/** Opened above its input, for a control at the foot of a clipping container. */
export const Above: Story = {
  render: () => (
    <div style={{ paddingTop: 320 }}>
      <CrewCombobox options={CREW} placement="above" />
    </div>
  ),
};
