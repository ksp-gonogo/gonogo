export const SCREENSHOT_MAX_EDGE_PX = 1600;
export const SCREENSHOT_JPEG_QUALITY = 0.8;
export const SCREENSHOT_WARN_BYTES = 700 * 1024;
export const SCREENSHOT_REFUSE_BYTES = 1.5 * 1024 * 1024;

export interface EncodedScreenshot {
  mimeType: "image/jpeg";
  base64: string;
  originalSize: number;
  encodedSize: number;
  width: number;
  height: number;
}

export class ScreenshotTooLargeError extends Error {
  constructor(
    message: string,
    public encodedSize: number,
  ) {
    super(message);
    this.name = "ScreenshotTooLargeError";
  }
}

export async function encodeScreenshot(file: File): Promise<EncodedScreenshot> {
  const bitmap = await loadBitmap(file);
  const { canvas, width, height } = drawScaled(bitmap, SCREENSHOT_MAX_EDGE_PX);
  releaseBitmap(bitmap);

  const blob = await canvasToJpegBlob(canvas, SCREENSHOT_JPEG_QUALITY);
  const base64 = await blobToBase64(blob);

  if (blob.size > SCREENSHOT_REFUSE_BYTES) {
    throw new ScreenshotTooLargeError(
      `Screenshot is still ${Math.round(blob.size / 1024)} KB after compression — please pick a smaller image.`,
      blob.size,
    );
  }

  return {
    mimeType: "image/jpeg",
    base64,
    originalSize: file.size,
    encodedSize: blob.size,
    width,
    height,
  };
}

interface DrawSource {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

async function loadBitmap(file: File): Promise<DrawSource> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(file);
    return {
      width: bmp.width,
      height: bmp.height,
      draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
    };
  }
  // Fallback for environments without createImageBitmap (older Safari, jsdom).
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not load image"));
      el.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function releaseBitmap(source: DrawSource): void {
  // ImageBitmap.close() releases GPU memory eagerly; HTMLImageElement is GC'd.
  const maybeBitmap = source as unknown as { close?: () => void };
  if (typeof maybeBitmap.close === "function") maybeBitmap.close();
}

function drawScaled(
  source: DrawSource,
  maxEdge: number,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const longest = Math.max(source.width, source.height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  source.draw(ctx, width, height);
  return { canvas, width, height };
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode JPEG"));
      },
      "image/jpeg",
      quality,
    );
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected FileReader result"));
        return;
      }
      // strip the `data:image/jpeg;base64,` prefix — Axiom only needs the payload
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
