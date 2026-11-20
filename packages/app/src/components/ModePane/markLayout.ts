/**
 * Where each mark's label sits along a track `total` wide, as the left edge of
 * each, in the order given. A label is centred on its own moment where there
 * is room, and otherwise moved along just far enough to clear its neighbours
 * and the track's ends. `centres` must rise. Labels that cannot all fit keep
 * their order and overlap at the left end.
 */
export function layoutMarks(
  centres: readonly number[],
  widths: readonly number[],
  total: number,
  gap: number,
): number[] {
  const left = centres.map((c, i) => {
    const w = widths[i] ?? 0;
    return Math.min(Math.max(c - w / 2, 0), Math.max(total - w, 0));
  });
  for (let i = 1; i < left.length; i += 1) {
    const prevEnd = (left[i - 1] ?? 0) + (widths[i - 1] ?? 0) + gap;
    left[i] = Math.max(left[i] ?? 0, prevEnd);
  }
  for (let i = left.length - 1; i >= 0; i -= 1) {
    const w = widths[i] ?? 0;
    const limit =
      i === left.length - 1 ? total - w : (left[i + 1] ?? 0) - w - gap;
    left[i] = Math.max(Math.min(left[i] ?? 0, limit), 0);
  }
  return left;
}
