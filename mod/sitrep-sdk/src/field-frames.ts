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
 * The reference frame a vector field is expressed in, as {@link frameOf}
 * returns it.
 *
 * @category Units and values
 */
export interface FieldFrame {
  /** The frame the field is in, such as `"part-local"`. */
  readonly frame: string;
  /** For a field whose frame can switch, the frame it is in while `selectedBy` is `true`. */
  readonly whenSet?: string;
  /** For a field whose frame can switch, the boolean field on the same payload that switches it. */
  readonly selectedBy?: string;
}

const TOPIC_FRAMES: Readonly<
  Record<string, Readonly<Record<string, GeneratedFrameDeclaration>>>
> = GENERATED_TOPIC_FRAMES;
const TYPE_FRAMES: Readonly<
  Record<string, Readonly<Record<string, GeneratedFrameDeclaration>>>
> = GENERATED_TYPE_FRAMES;

/**
 * Returns the reference frame of the field at `path` under `topic`, or
 * `undefined` when the field declares none. Every vector in Gonogo's own
 * Topics declares one.
 *
 * `path` is dotted from the payload root, or from one element for a Topic
 * whose payload is an array. It may pass through nested objects and lists, so
 * `frameOf("vessel.parts", "parts.bounds.center")` is `"part-local"`. A path
 * into a vector's components, such as `position.x`, returns the vector's
 * frame. A path into a map stops at the map and returns `undefined`.
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
