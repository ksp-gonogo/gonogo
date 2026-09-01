// The Sitrep contract, read off its GENERATED TypeScript rather than its C#.
//
// ## Why the TypeScript and not the C#
//
// The C# is the source of truth and this is a projection of it, one step
// downstream. Reading it here would mean a second parser for a second language,
// a `dotnet build` in the job, and a second opinion about what a `[SitrepTopic]`
// means. `mod/codegen.sh` already answers that question, `codegen-check.sh`
// already fails when its output drifts from its input, and the generated files
// are committed. So the emitted contract is the same fact, cheaper to read, and
// already gated.
//
// It also settles the doc-comment rule for free. `RtDocVisitor` carries a `cref`
// as a code-form pointer ONLY when the target is emitted into the SDK and
// degrades every other one to plain prose, so no reader is pointed at something
// they cannot reach. Reading the emitted TSDoc inherits that property; reading
// the C# XMLDoc would have re-opened the decision and got it wrong.
//
// ## Syntactic, deliberately
//
// `ts.createSourceFile` and no `Program`: no type checker, no module resolution,
// no `lib.d.ts` to load. The contract is one self-contained file of interfaces
// and enums, the shapes it uses are enumerable (see `parseTypeNode`), and an
// unrecognised one THROWS rather than degrading to a permissive schema. A
// checker would have made an unknown shape resolve to something plausible, which
// is the failure mode that matters here: a schema that says `object` about a
// field nobody understood reads exactly like a schema that understood it.

import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * One declaration's TSDoc, as the markdown the generator will carry into a
 * `description`.
 *
 * The emitted contract carries prose and nothing else: no `@tag`, no
 * `{@link}` (checked, both are zero across all eleven generated contracts), so
 * there is no tag-stripping to do and a `comment` that is not a plain string
 * means the generator's assumption about the emitter has changed.
 */
function docOf(node) {
  const blocks = node.jsDoc ?? [];
  const parts = [];
  for (const block of blocks) {
    const comment = block.comment;
    if (comment === undefined) continue;
    if (typeof comment !== "string") {
      throw new Error(
        `asyncapi: TSDoc on ${node.name?.text ?? "<anonymous>"} is not plain text. ` +
          "The contract emitter has started writing tags or links; teach docOf about them.",
      );
    }
    parts.push(comment);
  }
  if (parts.length === 0) return undefined;
  // A hard-wrapped C# summary arrives wrapped at the same column it was
  // authored at. Left alone in markdown that is one paragraph, which is what it
  // was, so the wrapping is cosmetic and kept: rewrapping would churn the
  // emitted document on every re-indent of the C#.
  return parts.join("\n\n");
}

/** `Value<"m">` -> `m`, for the one generic whose argument is the unit token. */
function unitArgument(node, owner) {
  const args = node.typeArguments ?? [];
  if (args.length !== 1 || !ts.isLiteralTypeNode(args[0])) {
    throw new Error(
      `asyncapi: ${owner} is a quantity with no literal unit argument. ` +
        "Every Value/Vec3Of in the emitted contract carries one.",
    );
  }
  const literal = args[0].literal;
  if (!ts.isStringLiteral(literal)) {
    throw new Error(`asyncapi: ${owner}'s unit argument is not a string`);
  }
  return literal.text;
}

/**
 * A field's declared type, as the small closed model the schema builder walks.
 *
 * Every form is one the emitted contract actually contains. An unrecognised one
 * throws, naming the site, because the alternative is a schema that quietly
 * describes a field as less than it is.
 */
export function parseTypeNode(node, owner) {
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { k: "prim", t: "string" };
    case ts.SyntaxKind.NumberKeyword:
      return { k: "prim", t: "number" };
    case ts.SyntaxKind.BooleanKeyword:
      return { k: "prim", t: "boolean" };
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return { k: "opaque" };
    default:
      break;
  }

  if (ts.isArrayTypeNode(node)) {
    return { k: "array", of: parseTypeNode(node.elementType, owner) };
  }

  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
    return { k: "literal", v: node.literal.text };
  }

  if (ts.isTypeLiteralNode(node)) {
    const index = node.members.find(ts.isIndexSignatureDeclaration);
    if (index && node.members.length === 1) {
      return { k: "map", of: parseTypeNode(index.type, owner) };
    }
    throw new Error(
      `asyncapi: ${owner} is an inline object literal the model does not cover`,
    );
  }

  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    if (name === "Value")
      return { k: "value", unit: unitArgument(node, owner) };
    if (name === "Vec3Of")
      return { k: "vec3", unit: unitArgument(node, owner) };
    return {
      k: "ref",
      name,
      args: (node.typeArguments ?? []).map((a) => parseTypeNode(a, owner)),
    };
  }

  throw new Error(
    `asyncapi: ${owner} has type form ${ts.SyntaxKind[node.kind]}, which the ` +
      "model does not cover. Add it to parseTypeNode rather than widening the schema.",
  );
}

/**
 * An enum member's integer value, which is the whole of what crosses the wire:
 * this codec serialises every enum as its ordinal, never as its name.
 *
 * A negative sentinel (`none = -1`) parses as a prefixed literal rather than a
 * numeric one, so both forms are read here and anything else throws. An implicit
 * value would be a silent renumbering hazard and the emitter has never written
 * one.
 */
function enumValue(member, owner, file) {
  const initialiser = member.initializer;
  const label = `${owner}.${member.name.getText(file)}`;
  if (initialiser && ts.isNumericLiteral(initialiser)) {
    return Number(initialiser.text);
  }
  if (
    initialiser &&
    ts.isPrefixUnaryExpression(initialiser) &&
    initialiser.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(initialiser.operand)
  ) {
    return -Number(initialiser.operand.text);
  }
  throw new Error(
    `asyncapi: ${label} has no explicit integer value. Enums cross this wire ` +
      "as their ordinal, so the value is the fact and cannot be implied.",
  );
}

function sourceOf(path) {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
  );
}

/**
 * Every interface and enum the generated contract declares.
 *
 * Interfaces keep their type parameters, because the four envelope types are
 * generic over their payload and the document binds those parameters per
 * channel.
 */
export function readContract(path) {
  const file = sourceOf(path);
  const interfaces = new Map();
  const enums = new Map();
  const methodLeaks = [];

  for (const statement of file.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      const name = statement.name.text;
      interfaces.set(name, {
        name,
        description: docOf(statement),
        typeParameters: (statement.typeParameters ?? []).map(
          (p) => p.name.text,
        ),
        extends: (statement.heritageClauses ?? []).flatMap((clause) =>
          clause.types.map((base) => {
            if (!ts.isIdentifier(base.expression)) {
              throw new Error(
                `asyncapi: ${name} extends an expression the model does not cover`,
              );
            }
            return base.expression.text;
          }),
        ),
        fields: statement.members
          .filter((member) => {
            // A method signature is not a wire field. Two of them reach the
            // emitted contract, from C# static factory helpers on a payload
            // type, and a schema that listed them would tell a reader the wire
            // carries a `Refused` property. Dropped here and COUNTED, because a
            // silent drop and a codegen leak look the same from the output.
            if (ts.isMethodSignature(member)) {
              methodLeaks.push(`${name}.${member.name.getText(file)}`);
              return false;
            }
            if (!ts.isPropertySignature(member) || !member.type) {
              throw new Error(
                `asyncapi: ${name} has a member the model does not cover`,
              );
            }
            return true;
          })
          .map((member) => {
            const field = member.name.getText(file);
            return {
              name: field,
              optional: member.questionToken !== undefined,
              description: docOf(member),
              type: parseTypeNode(member.type, `${name}.${field}`),
            };
          }),
      });
      continue;
    }
    if (ts.isEnumDeclaration(statement)) {
      const name = statement.name.text;
      enums.set(name, {
        name,
        description: docOf(statement),
        members: statement.members.map((member) => ({
          name: member.name.getText(file),
          value: enumValue(member, name, file),
          description: docOf(member),
        })),
      });
    }
  }

  if (interfaces.size === 0) {
    throw new Error(`asyncapi: no interfaces parsed out of ${path}`);
  }
  return { interfaces, enums, methodLeaks };
}

/**
 * The members of one generated map interface, e.g. `GeneratedTopicPayloadMap`.
 *
 * Returns `[key, parsedType]` pairs in declaration order, which is the emitter's
 * own sort and so is stable.
 */
export function readMapInterface(path, interfaceName) {
  const file = sourceOf(path);
  for (const statement of file.statements) {
    if (
      ts.isInterfaceDeclaration(statement) &&
      statement.name.text === interfaceName
    ) {
      return statement.members.map((member) => {
        if (!ts.isPropertySignature(member) || !member.type) {
          throw new Error(
            `asyncapi: ${interfaceName} has a member the model does not cover`,
          );
        }
        const key = ts.isStringLiteral(member.name)
          ? member.name.text
          : member.name.getText(file);
        return {
          key,
          type: parseTypeNode(member.type, `${interfaceName}["${key}"]`),
        };
      });
    }
  }
  throw new Error(`asyncapi: ${interfaceName} not found in ${path}`);
}
