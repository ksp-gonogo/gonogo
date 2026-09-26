import type { ConfigComponentProps } from "@ksp-gonogo/core";
import {
  librationPairLabel,
  librationPairsOf,
} from "@ksp-gonogo/sitrep-client";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Select,
} from "@ksp-gonogo/ui";
import { useModalSaveBar } from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import { AUTO_PAIR, type LibrationPointsConfig } from "./config";
import { useCatalogue } from "./useCatalogue";

export function LibrationPointsConfigForm({
  config,
  onSave,
}: Readonly<ConfigComponentProps<LibrationPointsConfig>>) {
  const facts = useCatalogue();
  const candidates = useMemo(() => librationPairsOf(facts), [facts]);
  const [pair, setPair] = useState(config?.pair ?? AUTO_PAIR);
  const candidate = useMemo<LibrationPointsConfig>(() => ({ pair }), [pair]);

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="libration-pair">Body pair</FieldLabel>
        <Select
          id="libration-pair"
          value={pair}
          onChange={(e) => setPair(e.target.value)}
        >
          <option value={AUTO_PAIR}>Auto (nearest to the craft)</option>
          {candidates.map((p) => (
            <option key={p.secondaryIndex} value={p.secondaryName ?? ""}>
              {librationPairLabel(p)}
            </option>
          ))}
        </Select>
        <FieldHint>
          The pair is also the frame. Five libration points stand still only in
          the frame that turns with the two bodies they belong to, so choosing
          the pair is choosing what the picture holds still, and there is
          nothing else to choose. "Auto" follows the craft to whichever pair it
          is nearest to.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}
