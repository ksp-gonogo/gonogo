import { reckonableValuesOf } from "@ksp-gonogo/sitrep-sdk";

/**
 * Whether a contract declares a forward model on the value at `fieldPath` of
 * `topic`, so a reading of it between observations is the model's estimate
 * rather than a measurement. A declared path covers the values beneath it, and
 * a `*` segment stands for any list index or dictionary key.
 *
 * Read from the same contract declarations the reckoners run on, so the answer
 * moves with them. Used by the alarm picker to keep reckoned values out of its
 * default list and by the alarm roster to mark an alarm armed on one.
 */
export function isReckonedField(topic: string, fieldPath: string): boolean {
  if (topic === "" || fieldPath === "") return false;
  const wanted = fieldPath.split(".");
  return reckonableValuesOf(topic).some((row) => {
    const declared = row.field.split(".");
    if (declared.length > wanted.length) return false;
    return declared.every((seg, i) => seg === "*" || seg === wanted[i]);
  });
}
