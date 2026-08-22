import {
  CELESTIAL_FACTS,
  type CelestialFacts,
  defineProcessorContract,
  useProcessor,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * The type half of `shared-processor-contract.test.tsx`, which the runtime half
 * cannot assert: a handle carries its result type, and that is the ONLY thing a
 * consumer has to go on.
 *
 * It sits in its own `.test-d.ts` because the package's `tsconfig.json` excludes
 * `*.test.ts`/`*.test.tsx` from the build, so a type annotation written inside
 * the runtime test is erased by the bundler and never checked by anything. That
 * was measured, not assumed: with `defineProcessorContract` deliberately
 * narrowed to return `ProcessorHandle<unknown>`, the runtime file's annotated
 * `HabSummary | undefined` went on compiling and the whole suite stayed green.
 *
 * Run by this package's `test` script (`tsc -p tsconfig.test-d.json` ahead of
 * vitest) rather than only by `typecheck`, because CI runs `pnpm test` and does
 * not run `pnpm typecheck`. A gate CI never executes reports green for the same
 * reason a recorder nobody wired reports zero.
 *
 * Nothing here is called. The declarations exist to be compiled, and the
 * component wrapper is only what the rules-of-hooks lint needs to see.
 */

interface HabSummary {
  readonly occupied: number;
}

const HAB_SUMMARY = defineProcessorContract<HabSummary>("othermod:hab-summary");

export function TypeOnlyConsumer(): null {
  // The load-bearing assertion. If the brand ever stops carrying `R`,
  // `useProcessor` answers `unknown` and this assignment stops compiling, which
  // is the whole difference between a shared Processor and a shared id.
  const fromContract: HabSummary | undefined = useProcessor(HAB_SUMMARY);

  // The same property for an SDK-declared handle, so the two routes are locked
  // together: a change that types one and not the other is worth seeing.
  const fromSdkHandle: CelestialFacts | undefined =
    useProcessor(CELESTIAL_FACTS);

  // @ts-expect-error a contract for one result type does not satisfy another
  const mismatched: CelestialFacts | undefined = useProcessor(HAB_SUMMARY);

  void fromContract;
  void fromSdkHandle;
  void mismatched;
  return null;
}
