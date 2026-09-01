// The contract model as JSON Schema, and the three places the emitted
// TypeScript is not the whole story.
//
// ## A unit reaches the client through two channels
//
// See `withUnit`. Most fields carry theirs in the TYPE, as `Value<"m">`; the
// rest generate bare and carry it only in the generated unit MAP. Reading the
// type alone dropped 514 declared units, including the four on the arguments to
// the command that plans a burn.
//
// ## `Value<unit>` is not the wire shape
//
// The generated contract types every quantity as `Value<"m">`, an object with a
// magnitude and a unit and dimension-safe arithmetic. Nothing of that crosses
// the socket: the mod serialises a bare `double`, and `wrapTopicPayload` in the
// SDK is what turns it into a `Value` on arrival, driven by the generated unit
// map. A schema describing the wire therefore says `number`, and the unit is
// carried as `x-sitrep-unit`, which is the fact the type was expressing.
//
// A document that copied the TypeScript here would have told every reader to
// send and expect `{ magnitude, unit }` objects, which the mod does not emit and
// would not accept.
//
// ## An enum crosses as its ordinal, and one kind of enum has no member set
//
// Every enum in this codec serialises as its integer value, never its name. Most
// are ordinals, and their member set is a real constraint worth validating. A
// `[Flags]` bitmask is not: the wire carries an OR of members, so `Gear | Light`
// is `6`, a legal value that is no member at all. Constraining those to the
// member set would reject correct traffic, so they carry the member table as an
// annotation and the constraint stays `integer`.
//
// Nothing machine-readable in the contract separates the two, so both are
// derived and CROSS-CHECKED against each other: the values (a bitmask's are not
// consecutive) and the prose (a bitmask's says so). A disagreement throws rather
// than picking one, because each instrument is blind in the direction the other
// sees.

/** Component-key safe: AsyncAPI keys allow letters, digits, dot, dash, underscore. */
export function componentKey(id) {
  const key = id.replace(/[^A-Za-z0-9._-]/g, "_");
  if (key.length === 0)
    throw new Error(`asyncapi: empty component key for ${id}`);
  return key;
}

const FLAGS_PROSE = /\[Flags\]|BITMASK/;

/**
 * Is this enum's integer set an ordinal run, `0..n-1` with negative sentinels
 * allowed alongside?
 *
 * A `[Flags]` enum with three or more real members cannot look like one: powers
 * of two reach 4 before an ordinal run has left 2.
 */
function isOrdinalRun(members) {
  const nonNegative = members
    .map((m) => m.value)
    .filter((v) => v >= 0)
    .sort((a, b) => a - b);
  return nonNegative.every((v, index) => v === index);
}

function classifyEnum(declaration) {
  const ordinal = isOrdinalRun(declaration.members);
  const proseSaysFlags = FLAGS_PROSE.test(declaration.description ?? "");
  if (ordinal === proseSaysFlags) {
    throw new Error(
      `asyncapi: enum ${declaration.name} is classified ${ordinal ? "ordinal" : "bitmask"} ` +
        `by its values and ${proseSaysFlags ? "bitmask" : "ordinal"} by its prose. ` +
        "The two instruments must agree; fix the contract's doc comment or teach classifyEnum.",
    );
  }
  return ordinal ? "ordinal" : "bitmask";
}

function enumSchema(declaration) {
  const kind = classifyEnum(declaration);
  const schema = { type: "integer" };
  if (declaration.description) schema.description = declaration.description;
  schema["x-sitrep-enum-kind"] = kind;

  if (kind === "bitmask") {
    schema["x-sitrep-enum"] = Object.fromEntries(
      declaration.members.map((m) => [m.name, m.value]),
    );
    return schema;
  }

  // `oneOf` of consts is the only slot JSON Schema has for a per-member
  // description, and 77 members in this contract carry one.
  schema.oneOf = declaration.members.map((member) => {
    const arm = { const: member.value, title: member.name };
    if (member.description) arm.description = member.description;
    return arm;
  });
  return schema;
}

/**
 * Attaches a field's declared unit where the field's TYPE did not already carry
 * one.
 *
 * ## The contract declares a unit through two channels, not one
 *
 * `[SitrepUnit]` in the C# reaches the client twice over. For most fields the
 * codegen puts it IN THE TYPE, as `Value<"m/s">`. For the rest the field
 * generates as a bare `string` / `number` / `boolean` / enum ref and the unit
 * arrives only in the generated unit MAP, `__generated__/units.json`, keyed by
 * type and field name.
 *
 * Reading the type alone loses the second channel entirely, and it is not a
 * small remainder: 514 of the 884 map entries are on a field the type leaves
 * bare. `AddManeuverNodeArgs`'s four fields, the arguments to the command that
 * plans a burn, are declared `ut`, `m/s`, `m/s`, `m/s` in `VesselCommands.cs`
 * and generate as four bare `number`s, so a type-only read published them with
 * no unit at all and it read as a contract that had never declared any.
 *
 * The two channels agree wherever both speak: checked, zero disagreements
 * across all 370 fields carrying a unit in both. So the type wins when it has
 * one and the map fills in the rest, and `asyncapi-doc.mjs` refuses to emit a
 * document that has dropped a unit the map declares.
 *
 * ## Every declared token, including the ones that are not quantities
 *
 * `text`, `flag`, `id`, `enum` and `n/a` are declared units in this contract's
 * vocabulary, and the runtime does not WRAP them because they have no
 * magnitude. That is a decision about hydration, not about meaning: "this string
 * is an id" and "this number is an enum ordinal" are facts the contract states,
 * and the document states them too. Absent, `n/a` and `1` are three different
 * things here, exactly as the generated unit map's own header says, and
 * filtering any of them out would collapse two of the three.
 */
function withUnit(schema, unit) {
  if (unit === undefined || schema["x-sitrep-unit"] !== undefined)
    return schema;
  // On the ITEMS of an array: the unit belongs to each element, and a declared
  // unit on the array itself would say the list has a magnitude.
  if (schema.type === "array" && schema.items) {
    return { ...schema, items: withUnit(schema.items, unit) };
  }
  return { ...schema, "x-sitrep-unit": unit };
}

/** The three components of a vector, all sharing the holder's unit. */
function vec3Schema(unit) {
  const component = { type: "number", "x-sitrep-unit": unit };
  return {
    type: "object",
    description:
      "A three-component vector. Its components share one unit, declared on " +
      "the field that holds the vector rather than on the shape.",
    required: ["x", "y", "z"],
    properties: { x: component, y: component, z: component },
  };
}

/**
 * Builds `components.schemas` on demand, so the document carries exactly the
 * shapes it references and an unreferenced contract type is visibly absent
 * rather than padding the page.
 */
export class SchemaBuilder {
  constructor(contract, unitsByType = {}) {
    this.contract = contract;
    this.units = unitsByType;
    this.schemas = new Map();
    /** Type-parameter names bound to a concrete type by the current channel. */
    this.bindings = new Map();
  }

  /** Emitted `components.schemas`, key-sorted so the output does not depend on walk order. */
  components() {
    return Object.fromEntries(
      [...this.schemas.entries()].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
  }

  ref(name) {
    this.ensure(name);
    return { $ref: `#/components/schemas/${componentKey(name)}` };
  }

  /**
   * Registers a schema this builder cannot derive, and hands back a `$ref` to
   * it.
   *
   * The envelopes are the whole of the need. `StreamData<T>`,
   * `CommandRequest<TArgs>` and `CommandResponse<TResult>` are generic over the
   * slot each channel fills, so the walk has no single shape to emit for them:
   * the caller binds the generic slot to a described placeholder and the
   * per-channel message narrows it. A name already emitted from the contract is
   * a collision rather than an override, because the two would disagree
   * silently.
   */
  define(name, schema) {
    const key = componentKey(name);
    if (this.schemas.has(key)) {
      throw new Error(
        `asyncapi: ${name} is already in components.schemas, so defining it here ` +
          "would overwrite a shape the contract produced. Rename one of the two.",
      );
    }
    this.schemas.set(key, schema);
    return { $ref: `#/components/schemas/${key}` };
  }

  /**
   * Prose for a contract type the C# documents nowhere, written onto the SCHEMA
   * rather than onto the one message that happens to carry it.
   *
   * `EventMsg` and `ErrorMsg` are the two frames a client routes on that are not
   * envelopes, so they are read through `InboundFrame`'s `oneOf` as often as
   * through a message, and an arm with no description is an arm a router author
   * has nothing to write against. Prose hung on the message reached only the
   * second of those two routes.
   *
   * Refuses to overwrite: a description here means the contract carries none,
   * and the day the C# gains a `<summary>` the two would disagree with the
   * generator silently preferring this one.
   */
  describe(name, description) {
    this.ensure(name);
    const schema = this.schemas.get(componentKey(name));
    if (schema.description) {
      throw new Error(
        `asyncapi: ${name} already carries a description from the contract, so the ` +
          "document-level prose for it is now a second answer to the same question. " +
          "Delete the one in document.mjs and let the C# doc comment through.",
      );
    }
    // Rebuilt rather than assigned into, so the description sits where every
    // other schema's does: `type` then the prose, ahead of `required` and
    // `properties`. YAML preserves insertion order, so an assignment would have
    // put the paragraph after the fields it introduces.
    const { type, ...rest } = schema;
    this.schemas.set(componentKey(name), { type, description, ...rest });
    return { $ref: `#/components/schemas/${componentKey(name)}` };
  }

  ensure(name) {
    if (this.schemas.has(componentKey(name))) return;
    const enumeration = this.contract.enums.get(name);
    if (enumeration) {
      // Placed before the recursive walk so a self-referencing shape terminates.
      this.schemas.set(componentKey(name), {});
      this.schemas.set(componentKey(name), enumSchema(enumeration));
      return;
    }
    const declaration = this.contract.interfaces.get(name);
    if (!declaration) {
      throw new Error(
        `asyncapi: no contract declaration named ${name}. It is referenced by a ` +
          "field or a channel map, so either the contract is incomplete or the model dropped it.",
      );
    }
    this.schemas.set(componentKey(name), {});
    this.schemas.set(componentKey(name), this.inherited(declaration));
  }

  /** A declaration's own properties, under any base it extends. */
  inherited(declaration) {
    const own = this.objectSchema(declaration);
    if (declaration.extends.length === 0) return own;
    const bases = declaration.extends.map((base) => this.ref(base));
    const { description, ...rest } = own;
    const schema = {};
    if (description) schema.description = description;
    schema.allOf = [...bases, rest];
    return schema;
  }

  objectSchema(declaration) {
    const schema = { type: "object" };
    if (declaration.description) schema.description = declaration.description;
    const required = [];
    const properties = {};
    for (const field of declaration.fields) {
      properties[field.name] = this.fieldSchema(field, declaration.name);
      if (!field.optional) required.push(field.name);
    }
    if (required.length > 0) schema.required = required;
    schema.properties = properties;
    if (declaration.fields.length === 0) {
      // `NoCommandArgs` and the Uplink markers modelled on it: the shape IS the
      // absence of one, and saying so beats an empty `properties` map.
      schema["x-sitrep-empty"] = true;
    }
    return schema;
  }

  /**
   * A discriminant: a field the envelope pins to one literal value.
   *
   * Built here rather than inline because the unit map annotates these too, and
   * a hand-written `{ type: "string", const: x }` silently loses it. The check
   * that every declared unit reaches the document is what caught that, on four
   * fields, the day the envelope types were first annotated.
   */
  constSchema(owner, name, literal) {
    return withUnit(
      { type: "string", const: literal },
      this.units[owner]?.[name],
    );
  }

  fieldSchema(field, owner) {
    const base = withUnit(
      this.typeSchema(field.type, `${owner}.${field.name}`),
      this.units[owner]?.[field.name],
    );
    return this.decorate(base, field.description, field.optional);
  }

  /**
   * Attaches a field's own prose, and its nullability, to a type's schema.
   *
   * A `$ref` under draft-07 IGNORES its siblings, so a description written
   * beside one is dropped by every validator that follows the spec. Wrapping in
   * a single-armed `allOf` is what carries the prose, and prose is the point of
   * this document. Bare refs stay bare where there is nothing to attach.
   *
   * An optional field is nullable rather than merely absent: the contract makes
   * a C# nullable optional here, and the codec writes an explicit `null` for it
   * (`FleetVesselLink.oneWaySeconds` is the worked case, and its own doc comment
   * says a sentinel zero would have read as a zero-delay link).
   */
  decorate(base, description, optional) {
    const isRef = base.$ref !== undefined;
    if (!isRef) {
      const schema = { ...base };
      if (description) schema.description = description;
      if (optional && typeof schema.type === "string") {
        schema.type = [schema.type, "null"];
      }
      return schema;
    }
    if (!description && !optional) return base;
    const schema = {};
    if (description) schema.description = description;
    schema[optional ? "anyOf" : "allOf"] = optional
      ? [base, { type: "null" }]
      : [base];
    return schema;
  }

  typeSchema(type, owner) {
    switch (type.k) {
      case "prim":
        return { type: type.t };
      case "literal":
        return { type: "string", const: type.v };
      case "value":
        return { type: "number", "x-sitrep-unit": type.unit };
      case "vec3":
        return vec3Schema(type.unit);
      case "array":
        return { type: "array", items: this.typeSchema(type.of, owner) };
      case "map":
        return {
          type: "object",
          additionalProperties: this.typeSchema(type.of, owner),
        };
      case "opaque":
        return {
          description:
            "Opaque at this layer: the contract declares no shape for it, so " +
            "nothing here constrains it.",
        };
      case "ref":
        return this.refSchema(type, owner);
      default:
        throw new Error(
          `asyncapi: ${owner} has unhandled model kind ${type.k}`,
        );
    }
  }

  refSchema(type, owner) {
    const bound = this.bindings.get(type.name);
    if (bound) return this.typeSchema(bound, owner);

    if (type.name === "ProviderExtensions") {
      // Core cannot type a provider's sub-tree and deliberately does not try.
      return {
        type: "object",
        description:
          "Provider extension bag, keyed by provider id. A capability publishes " +
          "one shared payload shape, and a provider modelling something that " +
          "shape does not declare writes it under its own id here rather than " +
          "having a field added to core. Core cannot type the sub-tree, so " +
          "nothing here constrains it: the owning provider's package supplies " +
          "the type and the reader for its own namespace.",
        additionalProperties: true,
      };
    }

    const declaration = this.contract.interfaces.get(type.name);
    if (declaration && declaration.typeParameters.length > 0) {
      if (declaration.typeParameters.length !== type.args.length) {
        throw new Error(
          `asyncapi: ${owner} uses ${type.name} with ${type.args.length} type ` +
            `arguments for ${declaration.typeParameters.length} parameters`,
        );
      }
      return this.bind(declaration, type.args, owner);
    }
    return this.ref(type.name);
  }

  /**
   * A generic contract type with its parameters bound, inlined rather than
   * `$ref`ed.
   *
   * `CommandResultOf<RepairOutcome>` and `CommandResultOf<number>` are two
   * different schemas off one declaration, so there is no single component to
   * point at. Inlining keeps the reply schema on the command that resolves it,
   * which is where a reader is standing when they ask.
   */
  bind(declaration, args, owner) {
    const saved = new Map(this.bindings);
    declaration.typeParameters.forEach((name, index) => {
      this.bindings.set(name, args[index]);
    });
    try {
      const schema = this.inherited(declaration);
      this.bindings = saved;
      return schema;
    } catch (error) {
      this.bindings = saved;
      throw new Error(
        `asyncapi: binding ${declaration.name} for ${owner}: ${error.message}`,
      );
    }
  }
}
