import type * as TS from "typescript";
import type { TypeScript } from "./program";
import type { SlotUse } from "./types";

const REGISTRIES: ReadonlySet<string> = new Set([
  "SlotRegistry",
  "ContributionRegistry",
]);

/** The trailing names every widget completes to `<widget id>.<segment>`, so any widget id may precede them. */
export const STANDARD_SEGMENTS: readonly string[] = [
  "sections",
  "actions",
  "badges",
  "filters",
  "meters",
];

const nameOf = (ts: TypeScript, name: TS.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;

/**
 * Every slot id the program's sdk declares, read from the members of
 * `SlotRegistry` and `ContributionRegistry` wherever they are declared or
 * merged into, so a slot the client declares for its own widgets is included.
 * Empty when neither interface is in the program, which means the sdk's types
 * could not be read.
 */
export function declaredSlots(ts: TypeScript, program: TS.Program): string[] {
  const out = new Set<string>();
  const visit = (node: TS.Node): void => {
    if (ts.isInterfaceDeclaration(node) && REGISTRIES.has(node.name.text)) {
      for (const member of node.members) {
        const name = member.name && nameOf(ts, member.name);
        if (name) out.add(name);
      }
      return;
    }
    if (ts.isModuleDeclaration(node) || ts.isModuleBlock(node)) {
      ts.forEachChild(node, visit);
    }
  };
  for (const file of program.getSourceFiles()) {
    if (
      !file.text.includes("SlotRegistry") &&
      !file.text.includes("ContributionRegistry")
    ) {
      continue;
    }
    for (const statement of file.statements) visit(statement);
  }
  return [...out];
}

const propertyOf = (
  ts: TypeScript,
  object: TS.ObjectLiteralExpression,
  name: string,
): TS.Expression | undefined => {
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      property.name &&
      nameOf(ts, property.name) === name
    ) {
      return property.initializer;
    }
  }
  return undefined;
};

const literalText = (
  ts: TypeScript,
  node: TS.Expression | undefined,
): string | undefined => {
  let current = node;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current && ts.isStringLiteralLike(current) ? current.text : undefined;
};

const calleeText = (ts: TypeScript, call: TS.CallExpression) => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
};

/**
 * Every literal slot id a file names: the `contributes` of a
 * `registerContribution` call, the `augments` of a `registerAugment` call, and
 * the slots a `registerComponent` call declares for its own widget. It reads
 * the call by name alone, so it serves a bundle as well as a source file.
 */
export function slotUsesIn(
  ts: TypeScript,
  file: TS.SourceFile,
): { uses: SlotUse[]; declared: string[] } {
  const uses: SlotUse[] = [];
  const declared: string[] = [];
  const find = (node: TS.Node): void => {
    if (ts.isCallExpression(node) && node.arguments[0]) {
      const callee = calleeText(ts, node);
      const first = node.arguments[0];
      if (ts.isObjectLiteralExpression(first)) {
        const line = () =>
          file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        if (callee === "registerContribution" || callee === "registerAugment") {
          const field =
            callee === "registerContribution" ? "contributes" : "augments";
          const slot = literalText(ts, propertyOf(ts, first, field));
          if (slot !== undefined) {
            uses.push({
              kind:
                callee === "registerContribution" ? "contribution" : "augment",
              slot,
              id: literalText(ts, propertyOf(ts, first, "id")),
              file: file.fileName,
              line: line(),
            });
          }
        }
        if (callee === "registerComponent") {
          for (const field of ["augmentSlots", "contributionSlots"]) {
            const list = propertyOf(ts, first, field);
            if (list && ts.isArrayLiteralExpression(list)) {
              for (const element of list.elements) {
                const slot = literalText(ts, element);
                if (slot !== undefined) declared.push(slot);
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, find);
  };
  find(file);
  return { uses, declared };
}

/** Whether `slot` completes a standard segment under some widget id. */
export const isStandardSegment = (slot: string): boolean => {
  const dot = slot.lastIndexOf(".");
  return dot > 0 && STANDARD_SEGMENTS.includes(slot.slice(dot + 1));
};

const editDistance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous[b.length];
};

/** The known slots nearest to `slot`: a small edit distance, or the same trailing segment under another widget. At most three. */
export function closestSlots(slot: string, known: readonly string[]): string[] {
  const tail = (id: string) => id.slice(id.lastIndexOf(".") + 1);
  return known
    .map((id) => {
      const distance = editDistance(slot, id);
      const sameTail = id.includes(".") && tail(id) === tail(slot);
      return { id, rank: sameTail ? Math.min(distance, 4) : distance };
    })
    .filter((c) => c.rank <= 4)
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((c) => c.id);
}

/** The uses whose slot no widget draws, each with the message that names it. Empty when the known slots could not be read. */
export function unknownSlotUses(
  uses: readonly SlotUse[],
  known: readonly string[],
): { use: SlotUse; message: string }[] {
  if (known.length === 0) return [];
  const set = new Set(known);
  const out: { use: SlotUse; message: string }[] = [];
  for (const use of uses) {
    if (set.has(use.slot) || isStandardSegment(use.slot)) continue;
    const close = closestSlots(use.slot, known);
    const named = use.id ? ` "${use.id}"` : "";
    const hint =
      close.length > 0
        ? ` Close slots: ${close.map((c) => `"${c}"`).join(", ")}.`
        : "";
    out.push({
      use,
      message: `The ${use.kind}${named} names slot "${use.slot}", which no widget draws, so it renders nothing.${hint}`,
    });
  }
  return out;
}
