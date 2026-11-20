import { Select } from "@ksp-gonogo/ui-kit";
import {
  RowDesc,
  RowLabel,
  RowText,
  SettingLine,
} from "../settings/settingsLayout";
import { chooseTheme, themeChoices, useChosenThemeId } from "./themeChoice";

/** The Settings row where this device picks how the whole screen is drawn. */
export function ThemeRow() {
  const chosen = useChosenThemeId();
  return (
    <SettingLine>
      <RowText>
        <RowLabel as="label" htmlFor="theme-choice">
          Theme
        </RowLabel>
        <RowDesc>Applies to this screen only.</RowDesc>
      </RowText>
      <Select
        id="theme-choice"
        value={chosen}
        onChange={(e) => chooseTheme(e.target.value)}
      >
        {themeChoices().map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
    </SettingLine>
  );
}
