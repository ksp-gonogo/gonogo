import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  declarationsOf,
  declarationsPath,
  emitDeclarations,
  isEmpty,
} from "../../emit";
import type { CheckContext, FixableFinding, Rule } from "../../types";
import {
  configReadUndeclaredRule,
  directiveStaleRule,
  familyUnregisteredRule,
  fieldNotReadRule,
  legacyDeclarationRule,
  registrationOpaqueRule,
  requiredUnreadRule,
} from "./widget-rules";

const GROUP = "declarations";

/** Writes through a temp file so a reader never sees half of it. */
function writeAtomic(path: string, text: string) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

export const unresolvedRule: Rule = {
  id: "declarations/unresolved",
  group: GROUP,
  check({ scan }: CheckContext): FixableFinding[] {
    const seen = new Set<string>();
    const out: FixableFinding[] = [];
    for (const widget of scan.widgets) {
      for (const miss of widget.unresolved) {
        const key = `${miss.file}:${miss.line}:${miss.call}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          rule: "declarations/unresolved",
          severity: "error",
          file: miss.file,
          line: miss.line,
          message: `${miss.call}() reads something the scanner cannot name: ${miss.reason}.`,
          fixable: false,
          fix: "Write `// gonogo:reads <topic id or family pattern>` on the line above the call, naming what it reads.",
        });
      }
    }
    return out;
  },
};

export const staleRule: Rule = {
  id: "declarations/stale",
  group: GROUP,
  check({ scan }: CheckContext): FixableFinding[] {
    const out: FixableFinding[] = [];
    for (const widget of scan.widgets) {
      const { registration } = widget;
      if (registration.opaque || !registration.id) continue;
      if (widget.unresolved.length > 0) continue;
      const path = declarationsPath(widget);
      const expected = emitDeclarations(widget);
      const present = existsSync(path);
      if (!present && isEmpty(declarationsOf(widget))) continue;
      if (present && readFileSync(path, "utf8") === expected) continue;
      out.push({
        rule: "declarations/stale",
        severity: "error",
        file: present ? path : registration.file,
        line: present ? 1 : registration.line,
        message: present
          ? `${path} no longer matches what ${registration.id} reads.`
          : `${registration.id} reads Topics beyond its required channels, and ${path} does not declare them.`,
        fixable: true,
        fix: "uplink-tools check --fix --only declarations",
        apply: () => writeAtomic(path, expected),
      });
    }
    return out;
  },
};

export const indexMissingRule: Rule = {
  id: "declarations/index-missing",
  group: GROUP,
  check({ scan }: CheckContext): FixableFinding[] {
    const seen = new Set<string>();
    const out: FixableFinding[] = [];
    for (const miss of scan.indexMissing) {
      const key = `${miss.file}:${miss.line}:${miss.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        rule: "declarations/index-missing",
        severity: "error",
        file: miss.file,
        line: miss.line,
        message: `${miss.name}() from ${miss.specifier} reads Topics the scan cannot list: ${miss.reason}.`,
        fixable: false,
        fix: `Install a release of ${miss.specifier} that ships reads-index.json, or write \`// gonogo:reads <topic id or family pattern>\` above the call.`,
      });
    }
    return out;
  },
};

export const declarationRules: Rule[] = [
  unresolvedRule,
  staleRule,
  indexMissingRule,
  requiredUnreadRule,
  fieldNotReadRule,
  legacyDeclarationRule,
  registrationOpaqueRule,
  configReadUndeclaredRule,
  directiveStaleRule,
  familyUnregisteredRule,
];
