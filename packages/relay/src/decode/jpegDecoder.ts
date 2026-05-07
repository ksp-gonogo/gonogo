import jpeg from "jpeg-js";

export interface DecodedFrame {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export function decodeJpeg(bytes: Uint8Array | Buffer): DecodedFrame {
  const raw = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  return {
    width: raw.width,
    height: raw.height,
    rgba: raw.data,
  };
}
