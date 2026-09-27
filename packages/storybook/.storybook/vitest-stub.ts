/**
 * Storybook's stand-in for `vitest`. The render probe reaches the kit's testing
 * entry, which imports `expect` for an assertion no story makes, and the real
 * module needs a running test runner to evaluate.
 */
export const expect = { extend: () => {} };
