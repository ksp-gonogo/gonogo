/**
 * One story file per component `@ksp-gonogo/ui-kit` exports, from the
 * compiler's own reading of its props: a default story where every required
 * prop can be given a plain value, the preset states where `uiKitPresets.tsx`
 * names some, and nothing but a line in the report where neither holds.
 */
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { storyNameFromExport, toId } from "storybook/internal/csf";
import { loadCsf } from "storybook/internal/csf-tools";
import { Project, type Symbol as TsSymbol, type Type, ts } from "ts-morph";

export interface UiKitCoverage {
  /** Stories generated with a synthesised default. */
  defaults: string[];
  /** Stories generated from preset states. */
  presets: string[];
  /** Stories written by hand under `src/stories/ui-kit/`. */
  handwritten: string[];
  /** Exports with no story, and why. */
  uncovered: { name: string; reason: string }[];
  /** Context providers, which draw nothing of their own and are left out of the list. */
  omitted: string[];
  /** Each covered export's story ids, the one to open first leading. */
  stories: Record<string, string[]>;
}

/** What a synthesised `children` holds: content of the kind a widget puts there. */
const SAMPLE_TEXT =
  "Kerbin orbit reached; circularisation burn complete with 212 m/s to spare.";

/** Whether `type` is one of React's renderable-node types. */
function isNodeType(type: Type): boolean {
  const text = type.getText(undefined, ts.TypeFormatFlags.NoTruncation);
  return /ReactNode|ReactElement|JSX\.Element/.test(text);
}

/**
 * A literal a story can pass for a required prop, or `undefined` when the prop
 * needs a real value (a quantity, a reading, a handle) that only a preset can
 * give it.
 */
function synthesise(name: string, type: Type): string | undefined {
  const title = name[0].toUpperCase() + name.slice(1);
  if (name === "children" && (type.isString() || isNodeType(type))) {
    return JSON.stringify(SAMPLE_TEXT);
  }
  if (isNodeType(type)) return JSON.stringify(title);
  if (type.isString()) return JSON.stringify(title);
  if (type.isNumber()) return "1";
  if (type.isBoolean() || type.isBooleanLiteral()) return "false";
  if (type.isStringLiteral()) return type.getText();
  const call = type.getCallSignatures()[0];
  if (call) return `() => ${returnLiteral(call.getReturnType())}`;
  if (type.isArray() || type.isReadonlyArray?.()) return "[]";
  if (type.isUnion()) {
    const members = type.getUnionTypes();
    if (members.some((m) => m.isNull())) return "null";
    if (members.some((m) => m.isUndefined())) return "undefined";
    if (members.every((m) => m.isArray() || m.isReadonlyArray?.())) return "[]";
    const literal = members.find((m) => m.isStringLiteral());
    if (literal) return literal.getText();
    if (members.every((m) => m.isBooleanLiteral())) return "false";
  }
  return undefined;
}

/** Whether the kit declares `prop` itself, rather than inheriting it from a DOM element's attributes. */
function declaredByTheKit(prop: TsSymbol): boolean {
  return prop
    .getDeclarations()
    .some((d) =>
      d.getSourceFile().getFilePath().includes("/packages/ui-kit/src/"),
    );
}

/** A value a synthesised callback can return that satisfies its return type. */
function returnLiteral(type: Type): string {
  if (type.isString()) return '""';
  if (type.isNumber()) return "0";
  if (type.isBoolean()) return "false";
  return "{}";
}

/** The HTML tag a `styled.<tag>` export draws, when the declaration says. */
function styledTag(initializer: string): string | undefined {
  return /styled\.(\w+)/.exec(initializer)?.[1];
}

const VOID_TAGS = new Set(["input", "img", "br", "hr", "textarea", "select"]);

interface Plan {
  name: string;
  args: Record<string, string>;
}

/** What story one export gets, or why it gets none. */
function planFor(
  name: string,
  props: Type | undefined,
  at: import("ts-morph").Node,
  styled: boolean,
): Plan | { reason: string } {
  if (!props) return { name, args: {} };
  // A props union is a set of alternatives: the first one every required prop of which has a plain value.
  if (props.isUnion() && !props.isBoolean()) {
    let last: { reason: string } = { reason: "no alternative" };
    for (const member of props.getUnionTypes()) {
      const plan = planFor(name, member, at, styled);
      if (!("reason" in plan)) return plan;
      last = plan;
    }
    return last;
  }
  const args: Record<string, string> = {};
  const missing: string[] = [];
  for (const prop of props.getProperties() as TsSymbol[]) {
    const propName = prop.getName();
    if (propName === "ref" || propName === "key") continue;
    // A styled component's own props are its transient `$` ones; the rest are the element's.
    if (styled && !propName.startsWith("$")) continue;
    const optional = (prop.getFlags() & ts.SymbolFlags.Optional) !== 0;
    const type = prop.getTypeAtLocation(at);
    if (optional) {
      if (
        !styled &&
        propName === "children" &&
        isNodeType(type) &&
        declaredByTheKit(prop)
      ) {
        args.children = JSON.stringify(SAMPLE_TEXT);
      }
      continue;
    }
    const literal = synthesise(propName, type);
    if (literal === undefined) {
      missing.push(propName);
      continue;
    }
    args[propName] = literal;
  }
  if (missing.length > 0) {
    return { reason: `needs a real value for ${missing.join(", ")}` };
  }
  return { name, args };
}

function importPath(fromDir: string, file: string): string {
  const rel = relative(fromDir, file).replace(/\.tsx?$/, "");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export async function writeUiKitStories(opts: {
  repo: string;
  out: string;
  src: string;
  presets: readonly string[];
  header: string;
}): Promise<UiKitCoverage> {
  const project = new Project({
    tsConfigFilePath: resolve(opts.repo, "packages/ui-kit/tsconfig.json"),
  });
  const index = project.getSourceFileOrThrow(
    resolve(opts.repo, "packages/ui-kit/src/index.ts"),
  );
  const coverage: UiKitCoverage = {
    defaults: [],
    presets: [],
    handwritten: [],
    uncovered: [],
    omitted: [],
    stories: {},
  };
  const dir = opts.out;
  const frame = importPath(dir, resolve(opts.src, "frame.tsx"));
  const presetsModule = importPath(dir, resolve(opts.src, "uiKitPresets.tsx"));

  for (const [name, decls] of index.getExportedDeclarations()) {
    if (!/^[A-Z]/.test(name)) continue;
    const decl = decls[0];
    const type = decl.getType();
    const signatures = type.getCallSignatures();
    if (signatures.length === 0) continue;
    if (name.endsWith("Provider")) {
      coverage.omitted.push(name);
      continue;
    }
    const handwritten = resolve(
      opts.src,
      "stories/ui-kit",
      `${name}.stories.tsx`,
    );
    if (existsSync(handwritten)) {
      coverage.handwritten.push(name);
      coverage.stories[name] = loadCsf(readFileSync(handwritten, "utf8"), {
        fileName: handwritten,
        makeTitle: (title) => title,
      })
        .parse()
        .stories.map((story) => story.id);
      continue;
    }
    const title = `ui-kit/${name}`;

    const styled = type.getProperty("styledComponentId") !== undefined;
    const lines = [
      opts.header,
      `import type { Meta, StoryObj } from "@storybook/react-vite";`,
      `import { ${name} } from "@ksp-gonogo/ui-kit";`,
      `import { withGonogoFrame } from ${JSON.stringify(frame)};`,
    ];
    const metaFor = (args: Record<string, string>) => {
      const body = Object.entries(args)
        .map(([k, v]) => `${JSON.stringify(k)}: ${v}`)
        .join(", ");
      return `
const meta = {
  title: ${JSON.stringify(title)},
  component: ${name},
  decorators: [
    (Story) => (
      <div style={{ width: 480 }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
  args: { ${body} },
} satisfies Meta<typeof ${name}>;

export default meta;
type Story = StoryObj<typeof meta>;
`;
    };

    if (opts.presets.includes(name)) {
      lines.push(
        `import { UI_KIT_PRESETS } from ${JSON.stringify(presetsModule)};`,
      );
      lines.push(
        metaFor({}).replace(
          "args: {  },",
          `args: UI_KIT_PRESETS.${name}[0].args,`,
        ),
      );
      lines.push(`
/** Each preset state, by name. */
export const States: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 16 }}>
      {UI_KIT_PRESETS.${name}.map((preset) => (
        <figure key={preset.name} style={{ margin: 0 }}>
          <figcaption>{preset.name}</figcaption>
          <${name} {...(preset.args as typeof meta.args)} />
        </figure>
      ))}
    </div>
  ),
};

/** The first preset, with its args on the controls. */
export const Default: Story = {};
`);
      coverage.presets.push(name);
      coverage.stories[name] = ["States", "Default"].map((story) =>
        toId(title, storyNameFromExport(story)),
      );
      await writeFile(resolve(dir, `${name}.stories.tsx`), lines.join("\n"));
      continue;
    }

    const param = signatures[signatures.length - 1].getParameters()[0];
    const plan = planFor(name, param?.getTypeAtLocation(decl), decl, styled);
    if (styled && !("reason" in plan)) {
      const initializer =
        decl
          .asKind(ts.SyntaxKind.VariableDeclaration)
          ?.getInitializer()
          ?.getText() ?? "";
      const tag = styledTag(initializer);
      if (!tag || !VOID_TAGS.has(tag))
        plan.args.children = JSON.stringify(SAMPLE_TEXT);
    }
    if ("reason" in plan) {
      coverage.uncovered.push({ name, reason: plan.reason });
      continue;
    }
    lines.push(metaFor(plan.args), "export const Default: Story = {};\n");
    coverage.defaults.push(name);
    coverage.stories[name] = [toId(title, storyNameFromExport("Default"))];
    await writeFile(resolve(dir, `${name}.stories.tsx`), lines.join("\n"));
  }
  return coverage;
}
