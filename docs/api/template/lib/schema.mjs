/**
 * Reads the JSON Schemas of the raw AsyncAPI document: follows `$ref`s,
 * flattens `allOf` objects, names a type for the page, and builds an example
 * value for the request console.
 */

const SCHEMA_REF = "#/components/schemas/";

/** How deep an example follows nested `$ref`s before it stops at `null`. */
const EXAMPLE_DEPTH = 8;

export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The schema name a `$ref` points at, or `null` for any other reference. */
export function refName(ref) {
  return typeof ref === "string" && ref.startsWith(SCHEMA_REF)
    ? ref.slice(SCHEMA_REF.length)
    : null;
}

export function schemaAnchor(name) {
  return `schema-${name}`;
}

export function createSchemas(doc) {
  const named = doc.components?.schemas ?? {};

  function resolve(schema) {
    if (!schema || typeof schema !== "object") return undefined;
    let current = schema;
    for (let hops = 0; current?.$ref && hops < 20; hops++) {
      const name = refName(current.$ref);
      current = name ? named[name] : undefined;
    }
    return current;
  }

  /**
   * The properties of an object schema, with every `allOf` part and `$ref`
   * merged in. A property that only narrows another (an `allOf` part that
   * fixes `topic` to a constant) replaces the broader one.
   */
  function objectShape(schema) {
    const properties = {};
    const required = new Set();
    const visit = (part, depth) => {
      const resolved = resolve(part);
      if (!resolved || depth > 10) return;
      for (const sub of resolved.allOf ?? []) visit(sub, depth + 1);
      for (const [key, value] of Object.entries(resolved.properties ?? {}))
        properties[key] = value;
      for (const key of resolved.required ?? []) required.add(key);
    };
    visit(schema, 0);
    return { properties, required };
  }

  /** The `const` options of a closed enum, or `null` when the schema is not one. */
  function enumMembers(schema) {
    const resolved = resolve(schema);
    const options = resolved?.oneOf;
    if (!Array.isArray(options) || options.length === 0) return null;
    if (!options.every((option) => "const" in option)) return null;
    return options.map((option) => ({
      value: option.const,
      name: option.title ?? "",
      description: option.description ?? "",
    }));
  }

  /** A short type name, with every named schema linked to its own section. */
  function typeHtml(schema, depth = 0) {
    if (!schema || typeof schema !== "object" || depth > 6) return "any";
    if (schema.$ref) {
      const name = refName(schema.$ref);
      return name
        ? `<a class="type-ref" href="#${schemaAnchor(name)}">${escapeHtml(name)}</a>`
        : escapeHtml(schema.$ref);
    }
    if ("const" in schema)
      return `<code>${escapeHtml(JSON.stringify(schema.const))}</code>`;
    if (Array.isArray(schema.allOf)) {
      if (schema.allOf.length === 1 && !schema.properties)
        return typeHtml(schema.allOf[0], depth + 1);
      return schema.allOf.map((part) => typeHtml(part, depth + 1)).join(" & ");
    }
    if (enumMembers(schema)) return "enum";
    const union = schema.oneOf ?? schema.anyOf;
    if (Array.isArray(union))
      return union.map((part) => typeHtml(part, depth + 1)).join(" | ");
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types[0] === undefined) return schema.properties ? "object" : "any";
    return types
      .map((type) => {
        if (type === "array") return `${typeHtml(schema.items, depth + 1)}[]`;
        if (
          type === "object" &&
          schema.additionalProperties &&
          !schema.properties
        )
          return `map of ${typeHtml(schema.additionalProperties, depth + 1)}`;
        return escapeHtml(type);
      })
      .join(" | ");
  }

  /**
   * A value that satisfies the schema, used to prefill the request console:
   * the schema's own example when it has one, otherwise its constants and
   * defaults, with zero values for the rest. An object carries its required
   * fields, or every field when none is required.
   */
  function example(schema, depth = 0, seen = new Set()) {
    if (!schema || typeof schema !== "object" || depth > EXAMPLE_DEPTH)
      return null;
    if (Array.isArray(schema.examples) && schema.examples.length > 0)
      return structuredClone(schema.examples[0]);
    if ("const" in schema) return schema.const;
    if ("default" in schema) return schema.default;
    if (schema.$ref) {
      const name = refName(schema.$ref);
      if (!name || seen.has(name)) return null;
      return example(named[name], depth + 1, new Set([...seen, name]));
    }
    if (Array.isArray(schema.allOf)) {
      if (schema.allOf.length === 1 && !schema.properties)
        return example(schema.allOf[0], depth + 1, seen);
      return objectExample(schema, depth, seen);
    }
    const union = schema.oneOf ?? schema.anyOf;
    if (Array.isArray(union) && union.length > 0)
      return example(union[0], depth + 1, seen);
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const type = types.find((candidate) => candidate !== "null") ?? types[0];
    switch (type) {
      case "object":
        return objectExample(schema, depth, seen);
      case "array":
        return [];
      case "string":
        return "";
      case "number":
      case "integer":
        return 0;
      case "boolean":
        return false;
      case "null":
        return null;
      default:
        return schema.properties ? objectExample(schema, depth, seen) : null;
    }
  }

  function objectExample(schema, depth, seen) {
    const { properties, required } = objectShape(schema);
    const keys =
      required.size > 0
        ? Object.keys(properties).filter((key) => required.has(key))
        : Object.keys(properties);
    const value = {};
    for (const key of keys)
      value[key] = example(properties[key], depth + 1, seen);
    return value;
  }

  /**
   * A value that shows a payload's shape without pretending to be real data:
   * every leaf is a string naming what goes there (`"<altitudeAsl: number m>"`),
   * constants and the schema's own examples are kept. A command filled this
   * way is refused by the mod until the reader fills it in, so opening one in
   * the console never acts on a save by surprise.
   *
   * @param {{ requiredOnly?: boolean }} [options] `requiredOnly` keeps only the
   *   fields a command must send
   */
  function placeholder(
    schema,
    options = {},
    name = "value",
    depth = 0,
    seen = new Set(),
  ) {
    if (!schema || typeof schema !== "object" || depth > EXAMPLE_DEPTH)
      return null;
    if (Array.isArray(schema.examples) && schema.examples.length > 0)
      return structuredClone(schema.examples[0]);
    if ("const" in schema) return schema.const;
    if (schema.$ref) {
      const ref = refName(schema.$ref);
      if (!ref || seen.has(ref)) return `<${name}>`;
      return placeholder(
        named[ref],
        options,
        name,
        depth + 1,
        new Set([...seen, ref]),
      );
    }
    const members = enumMembers(schema);
    if (members) {
      const listed = members
        .map((member) => `${JSON.stringify(member.value)} ${member.name}`)
        .join(", ");
      return `<${name}: ${listed}>`;
    }
    if (
      Array.isArray(schema.allOf) &&
      schema.allOf.length === 1 &&
      !schema.properties
    )
      return placeholder(schema.allOf[0], options, name, depth + 1, seen);
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const nullable = types.includes("null") ? " or null" : "";
    const type = types.find((candidate) => candidate && candidate !== "null");
    const unit = schema["x-sitrep-unit"];
    const unitText =
      unit && !["id", "text", "flag", "enum", "n/a", "1"].includes(unit)
        ? ` ${unit}`
        : "";
    if (type === "object" || (!type && (schema.properties || schema.allOf))) {
      const { properties, required } = objectShape(schema);
      const keys = Object.keys(properties).filter(
        (key) => !options.requiredOnly || required.has(key),
      );
      const value = {};
      for (const key of keys)
        value[key] = placeholder(
          properties[key],
          options,
          key,
          depth + 1,
          seen,
        );
      return value;
    }
    if (type === "array")
      return options.requiredOnly
        ? []
        : [placeholder(schema.items, options, `${name} item`, depth + 1, seen)];
    if (type === "boolean") return `<${name}: true or false${nullable}>`;
    if (type === "number" || type === "integer")
      return `<${name}: ${type}${unitText}${nullable}>`;
    if (type === "string") return `<${name}${nullable ? ", or null" : ""}>`;
    return `<${name}>`;
  }

  return {
    named,
    resolve,
    objectShape,
    enumMembers,
    typeHtml,
    example,
    placeholder,
  };
}
