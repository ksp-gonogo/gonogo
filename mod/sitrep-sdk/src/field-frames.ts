// Runtime accessor for the contract's coordinate-frame declarations.
//
// A frame is declared PER PROPERTY, in C# ([SitrepFrame] on a Vec3), and codegen
// emits it into ./__generated__/frames.ts. This module is the hand-written
// accessor over that data, mirroring reckonability.ts: the generated file stays
// free to change shape, and every consumer holds a named function.

import {
  GENERATED_TOPIC_FRAMES,
  GENERATED_TYPE_FRAMES,
  type GeneratedFrameDeclaration,
} from "./__generated__/frames";
import type { TopicId } from "./topics";
import { shapesForTopic, shapesForType, shapeTypeName } from "./units";

export type { GeneratedFrameDeclaration };

/**
 * The reference frame a field's value is expressed in.
 *
 * `frame` is the token the field is in by default. A field whose axes switch per
 * tick also carries `whenSet` (the frame it is in instead) and `selectedBy` (the
 * camelCased `bool` field on the same payload that picks between the two).
 *
 * @category Units and values
 */
export interface FieldFrame {
  readonly frame: string;
  readonly whenSet?: string;
  readonly selectedBy?: string;
}

const TOPIC_FRAMES: Readonly<
  Record<string, Readonly<Record<string, GeneratedFrameDeclaration>>>
> = GENERATED_TOPIC_FRAMES;
const TYPE_FRAMES: Readonly<
  Record<string, Readonly<Record<string, GeneratedFrameDeclaration>>>
> = GENERATED_TYPE_FRAMES;

/**
 * The frame the contract declares for `path` under `topic`, or `undefined` when
 * the field declares none.
 *
 * `path` is a dotted field path from the Topic's payload (for an array Topic,
 * from its element). It descends through nested payload shapes and through the
 * elements of a list, so `frameOf("vessel.parts", "parts.bounds.center")` is
 * `part-local`. A path that reaches a framed vector and continues into its
 * components (`position.x`) resolves to that vector's frame. A dictionary
 * collection ends the walk, because the key that follows is not a field.
 *
 * `undefined` means no frame is declared, which is not the same as a frame that
 * is unknown: every Vec3 in the core contract declares one.
 *
 * @category Units and values
 */
export function frameOf(topic: TopicId, path: string): FieldFrame | undefined {
  const segments = path.split(".");
  let frames: Readonly<Record<string, GeneratedFrameDeclaration>> | undefined =
    TOPIC_FRAMES[topic];
  let shapes: Readonly<Record<string, string>> = shapesForTopic(topic);

  for (const segment of segments) {
    const declared = frames?.[segment];
    if (declared !== undefined) return declared;

    const shape: string | undefined = shapes[segment];
    if (shape === undefined || shape.startsWith("*")) return undefined;
    const nested = shapeTypeName(shape);
    frames = TYPE_FRAMES[nested];
    shapes = shapesForType(nested);
  }
  return undefined;
}
