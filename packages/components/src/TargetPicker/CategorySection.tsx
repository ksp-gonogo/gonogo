import { Section } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import {
  SectionBody,
  SectionChevron,
  SectionHeaderRow,
  SectionToggle,
} from "./styles";

interface CategorySectionProps {
  id: string;
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  extra?: ReactNode;
  children: ReactNode;
}

/** A disclosure: a `<button>` heading with `aria-expanded` and `aria-controls` on the collapsible body. */
export function CategorySection({
  id,
  label,
  count,
  expanded,
  onToggle,
  extra,
  children,
}: Readonly<CategorySectionProps>) {
  const panelId = `target-picker-section-${id}`;
  return (
    <Section>
      <SectionHeaderRow>
        <SectionToggle
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <SectionChevron $expanded={expanded} aria-hidden="true">
            ▸
          </SectionChevron>
          {label} ({count})
        </SectionToggle>
        {extra}
      </SectionHeaderRow>
      {expanded && <SectionBody id={panelId}>{children}</SectionBody>}
    </Section>
  );
}
