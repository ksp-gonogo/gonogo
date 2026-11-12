import type { ConfigComponentProps } from "@ksp-gonogo/core";
import { ConfigForm, Field, Switch, useModalSaveBar } from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";

/** What Commcast keeps per tile: whether a text message from someone else chimes. */
export interface CommcastConfig {
  chime?: boolean;
}

export function CommcastConfigForm({
  config,
  onSave,
}: Readonly<ConfigComponentProps<CommcastConfig>>) {
  const [chime, setChime] = useState(config?.chime !== false);
  const candidate = useMemo<CommcastConfig>(() => ({ chime }), [chime]);
  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });
  return (
    <ConfigForm>
      <Field>
        <Switch checked={chime} onChange={setChime} label="Message chime" />
      </Field>
    </ConfigForm>
  );
}
