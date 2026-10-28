let generation = 0;

/** Counts a model being registered, so a read cached against the store's data knows a model may now answer differently. */
export function bumpReckonerGeneration(): void {
  generation++;
}

/** How many models have been registered since the page loaded. */
export function reckonerGeneration(): number {
  return generation;
}
