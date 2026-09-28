import { useStream } from "@ksp-gonogo/sitrep-client";
import { value as quantity } from "@ksp-gonogo/sitrep-sdk";
import { Switch } from "@ksp-gonogo/ui";
import {
  ReadOnlyField,
  type ReadOnlyFieldValue,
  Stack,
} from "@ksp-gonogo/ui-kit";
import type {
  SettingDefinition,
  SettingValue,
  StreamBackedSetting,
} from "./registry";
import {
  getSettingDefinition,
  isReadOnlySetting,
  settingTypeOf,
} from "./registry";
import { useSetting } from "./SettingsContext";
import {
  GroupTitle,
  RowDesc,
  RowLabel,
  RowText,
  SettingInput,
  SettingLine,
  SettingReadOnlyLine,
} from "./settingsLayout";

/** Buckets in first-registration order, so a category's rows keep their order. */
export function bucketBy<Item>(
  items: Item[],
  key: (item: Item) => string,
): Map<string, Item[]> {
  const out = new Map<string, Item[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/**
 * A category's rows: the ungrouped ones first, directly under the category
 * heading, then each named `group` under a sub-heading of its own.
 *
 * Ungrouped-first is what keeps a category that never declared a group looking
 * exactly as it did. It also matches how a mod's settings actually read: the
 * two or three rows everybody wants sit at the top, and the long tail files
 * itself away under a name.
 */
export function CategoryRows({ items }: { items: SettingDefinition[] }) {
  const ungrouped = items.filter((s) => s.group === undefined);
  const grouped = bucketBy(
    items.filter((s) => s.group !== undefined),
    // Narrowed by the filter above; the predicate does not carry that to TS.
    (s) => s.group as string,
  );

  return (
    <>
      {ungrouped.map((def) => (
        <SettingRow key={def.id} def={def} />
      ))}
      {[...grouped.entries()].map(([group, rows]) => (
        <Stack gap="related-dense" key={group}>
          <GroupTitle>{group}</GroupTitle>
          {rows.map((def) => (
            <SettingRow key={def.id} def={def} />
          ))}
        </Stack>
      ))}
    </>
  );
}

/**
 * What a read-only row hands to `ReadOnlyField`, which does not take a bare
 * number.
 *
 * A registered row may declare `type: "number"` and answer with a plain number,
 * and a plain number has lost the one thing that says how to write it. The row
 * still has to render, so the number is wrapped in a value whose unit is the
 * EMPTY one, which is the model's way of saying nobody declared a unit: `Unit`
 * writes it bare and claims nothing, exactly as the formatter this replaced
 * did. What changes is where the claim is made. A row that means metres says
 * `value("m", x)` in its own `select` and gets metres drawn and announced; this
 * is the fallback for the rows that have not, not a unit invented for them.
 */
function readOnlyValueOf(v: SettingValue | undefined): ReadOnlyFieldValue {
  return typeof v === "number" ? quantity("", v) : v;
}

function SettingRow({ def }: { def: SettingDefinition }) {
  // Split by backing at the component boundary so each row calls exactly one hook path.
  if (def.backing === "stream-backed") {
    return <StreamBackedRow def={def} />;
  }
  return <ClientPrefRow def={def} />;
}

/**
 * A stream-backed setting's row: the value arrives on a Topic and there is
 * nothing to write, so this is always a `ReadOnlyField`.
 *
 * A silent Topic and a Topic that carries no such field both land on the null
 * placeholder, which is the honest reading of both: the mod has not said.
 */
function StreamBackedRow({ def }: { def: StreamBackedSetting }) {
  const reading = useStream<unknown>(def.topic);
  // A setting the mod reported holds until it reports another.
  const payload =
    reading.state === "observed" || reading.state === "stale"
      ? reading.value
      : reading.state === "absent"
        ? null
        : undefined;
  return (
    <SettingReadOnlyLine $indented={def.dependsOn !== undefined}>
      <ReadOnlyField
        label={def.label}
        description={def.description}
        value={
          payload === undefined
            ? undefined
            : readOnlyValueOf(def.select(payload) ?? undefined)
        }
      />
    </SettingReadOnlyLine>
  );
}

function ClientPrefRow({
  def,
}: {
  def: Extract<SettingDefinition, { backing?: "client-pref" }>;
}) {
  const [value, setValue] = useSetting<SettingValue>(def.id, def.defaultValue);
  /*
   * `dependsOn` is a rendering-only hint (see its doc comment in
   * registry.ts): read the parent's CURRENT value the same way this row
   * reads its own, so the row visually goes inert the instant the parent
   * toggles off: no registry-level enforcement, just an honest reflection
   * of what the consuming hook (e.g. `useMissionHistorySettings`) actually
   * does with these two values.
   */
  const parent = def.dependsOn
    ? getSettingDefinition(def.dependsOn)
    : undefined;
  /*
   * A dependsOn parent is a client-pref boolean by construction (its value
   * lives in localStorage, which is what this row reads); a setting with no
   * localStorage default has no value to fall back to, so assume "on".
   */
  const [parentValue] = useSetting<boolean>(
    def.dependsOn ?? "__no_parent__",
    parent !== undefined && parent.backing === undefined
      ? parent.defaultValue === true
      : true,
  );
  const inert = def.dependsOn !== undefined && !parentValue;

  if (isReadOnlySetting(def)) {
    return (
      <SettingReadOnlyLine $indented={def.dependsOn !== undefined}>
        <ReadOnlyField
          label={def.label}
          description={def.description}
          value={readOnlyValueOf(value)}
        />
      </SettingReadOnlyLine>
    );
  }
  return (
    <SettingLine $indented={def.dependsOn !== undefined}>
      <RowText>
        <RowLabel>{def.label}</RowLabel>
        {def.description && <RowDesc>{def.description}</RowDesc>}
      </RowText>
      <SettingControl
        def={def}
        value={value}
        disabled={inert}
        onChange={setValue}
      />
    </SettingLine>
  );
}

/**
 * The control half of a WRITABLE row, chosen by the row's declared type. A
 * read-only row never reaches here: it renders a `ReadOnlyField` instead, which
 * is the whole point of the flag.
 */
function SettingControl({
  def,
  value,
  disabled,
  onChange,
}: {
  def: SettingDefinition;
  value: SettingValue | undefined;
  disabled: boolean;
  onChange: (next: SettingValue) => void;
}) {
  const type = settingTypeOf(def);
  if (type === "boolean") {
    return (
      <Switch
        checked={value === true}
        onChange={onChange}
        disabled={disabled}
        aria-label={def.label}
      />
    );
  }
  if (type === "number") {
    return (
      <SettingInput
        type="number"
        value={typeof value === "number" ? String(value) : ""}
        onChange={(e) => {
          const typed = e.target.value;
          /*
           * A mid-edit box is empty ("" is also what a number input reports for
           * anything unparseable), and `Number("")` is 0, so the emptiness has
           * to be caught before the parse or a cleared field silently persists
           * a zero. "-" and "1e" parse to NaN and are caught after it.
           */
          if (typed.trim() === "") return;
          const next = Number(typed);
          if (Number.isFinite(next)) onChange(next);
        }}
        disabled={disabled}
        aria-label={def.label}
      />
    );
  }
  return (
    <SettingInput
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={def.label}
    />
  );
}
