/**
 * Topics that exist only for the reckoner suites, declared the way an Uplink
 * declares its own.
 *
 * `registerReckoner` used to take a bare `string`, so a test could register a
 * model under any name it liked with any payload type it liked, and three of
 * them did: `"temperature"` is not a Topic at all, and two suites registered a
 * hand-rolled two-field stand-in against `"vessel.target"`, a payload that
 * really has forty-seven paths. Neither was checkable, which is the same hole
 * the signature had in production.
 *
 * Now the topic is `TopicId` and the payload falls out of it, so these get
 * declared instead of assumed. They go through `declare module`, the SAME
 * mechanism a bundled Uplink's own `topics.ts` uses for the Topics only that
 * Uplink can source, which makes this file a second proof that an outside
 * author can register a model for a Topic the SDK has never heard of.
 *
 * TYPE only, with no `registerBarePrimitiveTopic` call: the augmentation is
 * erased at runtime and the store is keyed by plain strings, so nothing here
 * puts a fake Topic into `getAllKnownTopicIds()` where another suite could
 * enumerate it.
 *
 * Two segments each, deliberately: `resolveRawFieldSubtopic` treats a
 * three-segment name as `<domain>.<channel>.<fieldPath>`, so `test.target` is a
 * whole topic and `test.target.relativePosition` is a field of it, exactly as
 * `vessel.target` and `vessel.target.relativePosition` behave.
 */

/** A nested vector plus a sibling no model moves: the field-scoping case. */
export interface TestTarget {
  relativePosition: { x: number };
  name: string;
}

/** The same shape flattened, for the tests that only need one number. */
export interface TestContact {
  relativePosition: number;
  name: string;
}

/**
 * Two fields where one name is a STRING prefix of the other, which is the trap
 * segment-wise path matching exists to avoid.
 */
export interface TestPrefixed {
  relativePosition: number;
  relativePositionError: number;
}

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "test.temperature": number;
    "test.target": TestTarget;
    "test.contact": TestContact;
    "test.dock": TestPrefixed;
  }
}
