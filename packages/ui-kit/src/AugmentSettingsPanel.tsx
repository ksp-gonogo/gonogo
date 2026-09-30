import type { NamespacedAugmentSettings } from "./augments";
import { Field, FieldLabel, FieldRow, Input } from "./Form";
import { Switch } from "./Switch";

/**
 * Props for {@link AugmentSettingsPanel}.
 *
 * @category Extensions
 */
export interface AugmentSettingsPanelProps {
  /** Every augment's settings block for the widget's slots, as {@link getAugmentSettings} returns them. */
  settings: readonly NamespacedAugmentSettings[];
  /** The widget's persisted per-augment values, keyed `[namespace][key]`. `undefined` when nothing has been saved yet; each field then shows its own `default`. */
  values: Record<string, Record<string, unknown>> | undefined;
  /** Called on every field edit with the namespace (augment id), the field key, and the new value. An emptied number field passes `undefined`. */
  onChange: (namespace: string, key: string, value: unknown) => void;
}

/**
 * Draws the settings augments add to a widget, one control per field: a
 * {@link Switch} for a `boolean` field, a text or number input otherwise.
 * Fields are namespaced by augment id, so two augments' settings with the same
 * key never collide. A widget with several slots joins the
 * {@link getAugmentSettings} result for each into one `settings` array. Renders
 * nothing when `settings` is empty.
 *
 * @example
 * ```tsx
 * <AugmentSettingsPanel
 *   settings={getAugmentSettings("power-systems.sections")}
 *   values={draft.augmentSettings}
 *   onChange={(augmentId, key, value) =>
 *     setDraft((d) => ({
 *       ...d,
 *       augmentSettings: {
 *         ...d.augmentSettings,
 *         [augmentId]: { ...d.augmentSettings?.[augmentId], [key]: value },
 *       },
 *     }))
 *   }
 * />
 * ```
 *
 * @category Extensions
 */
export function AugmentSettingsPanel({
  settings,
  values,
  onChange,
}: Readonly<AugmentSettingsPanelProps>) {
  if (settings.length === 0) return null;

  return (
    <>
      {settings.flatMap((block) =>
        block.fields.map((field) => {
          const stored = values?.[block.namespace]?.[field.key];
          const current = stored ?? field.default;
          const label = field.label ?? field.key;
          const fieldId = `augment-setting-${block.namespace}-${field.key}`;

          if (field.type === "boolean") {
            return (
              <FieldRow key={`${block.namespace}.${field.key}`}>
                <Switch
                  checked={Boolean(current)}
                  onChange={(value) =>
                    onChange(block.namespace, field.key, value)
                  }
                  label={label}
                />
              </FieldRow>
            );
          }

          return (
            <Field key={`${block.namespace}.${field.key}`}>
              <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
              <Input
                id={fieldId}
                type={field.type === "number" ? "number" : "text"}
                value={current === undefined ? "" : String(current)}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (field.type !== "number") {
                    onChange(block.namespace, field.key, raw);
                    return;
                  }
                  // An emptied field stores nothing, so the default applies; a partial entry such as a lone "-" stores nothing at all.
                  if (raw === "") {
                    onChange(block.namespace, field.key, undefined);
                    return;
                  }
                  const n = Number(raw);
                  if (Number.isFinite(n))
                    onChange(block.namespace, field.key, n);
                }}
              />
            </Field>
          );
        }),
      )}
    </>
  );
}
