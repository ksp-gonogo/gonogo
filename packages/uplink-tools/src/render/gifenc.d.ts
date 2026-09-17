/**
 * `gifenc` ships no types and has no `@types` package. Only the three functions
 * the encoder here calls are declared, so a fourth one used by accident is a
 * compile error rather than an implicit `any`.
 */
declare module "gifenc" {
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
  ): number[][];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
  ): Uint8Array;

  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: { palette: number[][]; delay: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
