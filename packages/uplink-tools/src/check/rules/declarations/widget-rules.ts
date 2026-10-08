import type {
  CheckContext,
  ClientScan,
  FixableFinding,
  Rule,
  WidgetScan,
} from "../../types";
import {
  isValidFamily,
  normalizeFamily,
  pathIsUnderFamily,
  pathIsUnderTopic,
  prefixOfFamily,
} from "./family";

const GROUP = "declarations";

/** Until the built-in widgets are migrated this is a warning; it becomes an error with them. */
export const LEGACY_SEVERITY = "warning" as const;

/** A scan that is missing reads cannot prove that anything is unread. */
const provable = (widget: WidgetScan) =>
  !widget.registration.opaque && widget.unresolved.length === 0;

/** The marker's channels the named augment really declares: what the widget's built-in augment reads for it. */
const augmentReadIds = (widget: WidgetScan, scan: ClientScan): string[] => {
  const marker = widget.registration.augmentReads;
  if (!marker) return [];
  const augment = scan.augments.find((a) => a.id === marker.augment);
  if (!augment) return [];
  return marker.channels.filter((c) => augment.channels.includes(c));
};

const where = (widget: WidgetScan) => ({
  file: widget.registration.file,
  line: widget.registration.line,
});

export const requiredUnreadRule: Rule = {
  id: "declarations/required-unread",
  group: GROUP,
  check({ scan }: CheckContext): FixableFinding[] {
    const out: FixableFinding[] = [];
    for (const widget of scan.widgets) {
      if (!provable(widget) || widget.readsFromConfig) continue;
      const { registration } = widget;
      const ids = new Set([
        ...widget.reads.flatMap((r) => (r.id ? [r.id] : [])),
        ...augmentReadIds(widget, scan),
      ]);
      const families = new Set(
        widget.reads.flatMap((r) =>
          r.family ? [normalizeFamily(r.family)] : [],
        ),
      );
      const unread = [
        ...(registration.channels ?? []).filter((t) => !ids.has(t)),
        ...(registration.channelFamilies ?? []).filter(
          (f) => !families.has(normalizeFamily(f)),
        ),
      ];
      for (const topic of unread) {
        out.push({
          rule: "declarations/required-unread",
          severity: "error",
          ...where(widget),
          message: `${registration.id} requires "${topic}" and nothing it renders reads it, so it would lock for a feed it never uses.`,
          fixable: false,
          fix: `Remove "${topic}" from its channels, or read it in the widget.`,
        });
      }
    }
    return out;
  },
};

export const augmentMarkerRule: Rule = {
  id: "declarations/augment-marker",
  group: GROUP,
  check({ scan }: CheckContext): FixableFinding[] {
    const out: FixableFinding[] = [];
    for (const widget of scan.widgets) {
      const marker = widget.registration.augmentReads;
      if (!marker) continue;
      const { registration } = widget;
      const augment = scan.augments.find((a) => a.id === marker.augment);
      const at = { file: registration.file, line: marker.line };
      if (!augment) {
        out.push({
          rule: "declarations/augment-marker",
          severity: "error",
          ...at,
          message: `${registration.id} says augment "${marker.augment}" reads for it, and no registerAugment in this client has that id.`,
          fixable: false,
          fix: `Name an augment registered in this client, or delete the marker.`,
        });
        continue;
      }
      for (const channel of marker.channels) {
        if (augment.channels.includes(channel)) continue;
        out.push({
          rule: "declarations/augment-marker",
          severity: "error",
          ...at,
          message: `${registration.id} says augment "${marker.augment}" reads "${channel}", and the augment does not declare it in its channels.`,
          fixable: false,
          fix: `Add "${channel}" to the augment's channels, or remove it from the marker.`,
        });
      }
    }
    return out;
  },
};

export const fieldNotReadRule: Rule = {
  id: "declarations/field-not-read",
  group: GROUP,
  check({ scan }: CheckContext): FixableFinding[] {
    const out: FixableFinding[] = [];
    for (const widget of scan.widgets) {
      if (!provable(widget) || widget.readsFromConfig) continue;
      const { registration } = widget;
      const ids = [
        ...widget.reads.flatMap((r) => (r.id ? [r.id] : [])),
        ...augmentReadIds(widget, scan),
      ];
      const families = widget.reads.flatMap((r) =>
        r.family ? [r.family] : [],
      );
      for (const field of registration.fields ?? []) {
        const read =
          ids.some((id) => pathIsUnderTopic(field, id)) ||
          families.some((f) => pathIsUnderFamily(field, f));
        if (read) continue;
        out.push({
          rule: "declarations/field-not-read",
          severity: "error",
          ...where(widget),
          message: `${registration.id} says it draws "${field}", and nothing it renders reads that Topic.`,
          fixable: false,
          fix: `Remove "${field}" from its fields, or read its Topic in the widget.`,
        });
      }
    }
    return out;
  },
};

export const legacyDeclarationRule: Rule = {
  id: "declarations/legacy-declaration",
  group: GROUP,
  check({ scan }: CheckContext): FixableFinding[] {
    return scan.widgets.flatMap((widget) => {
      const { registration } = widget;
      if (!registration.hasDataRequirements) return [];
      if (registration.channels !== undefined) return [];
      return [
        {
          rule: "declarations/legacy-declaration",
          severity: LEGACY_SEVERITY,
          ...where(widget),
          message: `${registration.id || "a widget"} declares dataRequirements and no channels. --fix cannot tell which of its Topics are required and which it can do without.`,
          fixable: false,
          fix: "List the Topics the widget cannot work without in channels and drop dataRequirements; check writes the rest.",
        },
      ];
    });
  },
};

export const registrationOpaqueRule: Rule = {
  id: "declarations/registration-opaque",
  group: GROUP,
  check({ scan }: CheckContext): FixableFinding[] {
    return scan.widgets.flatMap((widget) =>
      widget.registration.opaque
        ? [
            {
              rule: "declarations/registration-opaque",
              severity: "error" as const,
              ...where(widget),
              message: `${widget.registration.id || "A registration"} cannot be read statically: ${widget.registration.opaque}.`,
              fixable: false,
              fix: "Write the registration as an object literal with a literal id and component, spreading nothing but its generated declarations.",
            },
          ]
        : [],
    );
  },
};

export const configReadUndeclaredRule: Rule = {
  id: "declarations/config-read-undeclared",
  group: GROUP,
  check({ scan }: CheckContext): FixableFinding[] {
    return scan.widgets.flatMap((widget) =>
      widget.readsFromConfig && !widget.registration.hasChannelsFromConfig
        ? [
            {
              rule: "declarations/config-read-undeclared",
              severity: "error" as const,
              ...where(widget),
              message: `${widget.registration.id} reads Topics named in its saved settings and has no channelsFromConfig to say which.`,
              fixable: false,
              fix: "Add channelsFromConfig to the registration: a function from the tile's config to the Topic ids it reads.",
            },
          ]
        : [],
    );
  },
};

export const directiveStaleRule: Rule = {
  id: "declarations/directive-stale",
  group: GROUP,
  check({ scan }: CheckContext): FixableFinding[] {
    return scan.directives.flatMap((directive) => {
      if (directive.attached && directive.needed) return [];
      return [
        {
          rule: "declarations/directive-stale",
          severity: "error" as const,
          file: directive.file,
          line: directive.line,
          message: directive.attached
            ? `This gonogo:reads comment sits on a call the scan reads without it.`
            : `This gonogo:reads comment points at no call the scan reads.`,
          fixable: false,
          fix: "Delete the comment.",
        },
      ];
    });
  },
};

export const familyUnregisteredRule: Rule = {
  id: "declarations/family-unregistered",
  group: GROUP,
  check({
    scan,
    dynamicPrefixes,
    dynamicPrefixesProblem,
  }: CheckContext): FixableFinding[] {
    const registered = [...dynamicPrefixes, ...scan.registeredPrefixes];
    const out: FixableFinding[] = [];
    const seen = new Set<string>();
    const judge = (
      pattern: string,
      file: string,
      line: number,
      owner: string,
    ) => {
      const key = `${file}:${line}:${pattern}`;
      if (seen.has(key)) return;
      seen.add(key);
      const finding = (message: string, fix: string): FixableFinding => ({
        rule: "declarations/family-unregistered",
        severity: "error",
        file,
        line,
        message,
        fixable: false,
        fix,
      });
      if (!isValidFamily(pattern)) {
        out.push(
          finding(
            `${owner} names the family "${pattern}", which is not one placeholder per whole segment.`,
            "Write it as dotted segments with each <name> filling a whole segment, such as fleet.<vessel>.contact.",
          ),
        );
        return;
      }
      const prefix = prefixOfFamily(pattern);
      if (prefix === "") return;
      if (registered.some((p) => `${prefix}x`.startsWith(p))) return;
      if (dynamicPrefixesProblem) {
        out.push(
          finding(
            `${owner} names the family "${pattern}", and its prefix cannot be checked: ${dynamicPrefixesProblem}.`,
            "Install and build @ksp-gonogo/sitrep-sdk, or register the prefix with registerDynamicTopicPrefix.",
          ),
        );
        return;
      }
      out.push(
        finding(
          `${owner} names the family "${pattern}", and no dynamic prefix covers "${prefix}", so the store would read its members as fields of a shorter Topic.`,
          `Call registerDynamicTopicPrefix("${prefix}") when the client loads, with the prefix the mod registers.`,
        ),
      );
    };
    for (const widget of scan.widgets) {
      const { registration } = widget;
      const owner = registration.id || "A widget";
      for (const pattern of registration.channelFamilies ?? []) {
        judge(pattern, registration.file, registration.line, owner);
      }
      for (const read of widget.reads) {
        if (read.family) judge(read.family, read.file, read.line, owner);
      }
    }
    return out;
  },
};
