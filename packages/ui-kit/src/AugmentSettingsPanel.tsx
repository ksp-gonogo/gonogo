import { Field, FieldLabel, FieldRow, Input } from "./Form";
import { Switch } from "./Switch";

// ---------------------------------------------------------------------------
// Local, structurally-equivalent mirror of `@ksp-gonogo/core`'s
// `AugmentSettingField`/`NamespacedAugmentSettings` (spec §4.7). This package
// is the export-safe design system and must never depend on `core` (see
// `ModalSaveBar.tsx`'s header comment for the same rule applied elsewhere) —
// TS structural typing means callers can pass `core`'s `getAugmentSettings()`
// result straight through without a cast.
// ---------------------------------------------------------------------------

export interface AugmentSettingField {
  key: string;
  type: "boolean" | "text" | "number";
  label?: string;
  default?: boolean | string | number;
}

export interface NamespacedAugmentSettings {
  augmentId: string;
  namespace: string;
  fields: readonly AugmentSettingField[];
}

export interface AugmentSettingsPanelProps {
  /** Every augment's settings block for the host widget's slot(s) — see `getAugmentSettings`/`getFogRevealSourceSettings`. */
  settings: readonly NamespacedAugmentSettings[];
  /** The widget's persisted per-augment values, keyed `[namespace][key]`. `undefined` when nothing has been saved yet — falls back to each field's own `default`. */
  values: Record<string, Record<string, unknown>> | undefined;
  /** Fired on every field edit with the namespace (augment id), the field key, and the new value. */
  onChange: (namespace: string, key: string, value: unknown) => void;
}

/**
 * Generic renderer for augment-contributed settings (spec §4.7) — the
 * read-back half of the loop `registerAugment({ settings: [...] })` writes
 * into. Renders one control per field, namespaced by augment id so two
 * augments' identically-named settings never collide in the host's saved
 * config. Host widgets merge their own `getAugmentSettings(slotName)` calls
 * (one per slot they expose) into a single `settings` array before passing
 * it here.
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
                  onChange(
                    block.namespace,
                    field.key,
                    field.type === "number" ? Number(raw) : raw,
                  );
                }}
              />
            </Field>
          );
        }),
      )}
    </>
  );
}
