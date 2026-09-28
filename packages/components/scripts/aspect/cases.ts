export interface Size {
  width: number;
  height: number;
}

export interface AspectCase {
  name: string;
  /** The box the frame is laid out in, CSS px. */
  tile: Size;
  /** `tile` fills it; a size is a frame fitted to the picture, as CameraFeed's `frameBox` does. */
  frame: "tile" | Size;
  fit: "cover" | "fill";
  /** A camera render: 1024x576, the shipped default size, in 64px cells. */
  picture: { columns: number; rows: number; cell: number };
  /**
   * True for the planted case: a stretched picture the gate must read as
   * distorted, or it is not measuring anything.
   */
  plant?: boolean;
}

const CAMERA = { columns: 16, rows: 9, cell: 64 };

/** The largest box of `aspect` that fits in `box`, as CameraFeed's `frameBox` computes it. */
function fitted(box: Size, aspect: number): Size {
  const width = Math.floor(Math.min(box.width, box.height * aspect));
  return { width, height: Math.floor(width / aspect) };
}

export const CASES: AspectCase[] = [
  {
    name: "landscape-cover",
    tile: { width: 480, height: 200 },
    frame: "tile",
    fit: "cover",
    picture: CAMERA,
  },
  {
    name: "portrait-cover",
    tile: { width: 200, height: 480 },
    frame: "tile",
    fit: "cover",
    picture: CAMERA,
  },
  {
    name: "square-cover",
    tile: { width: 320, height: 320 },
    frame: "tile",
    fit: "cover",
    picture: CAMERA,
  },
  {
    name: "portrait-fitted",
    tile: { width: 200, height: 480 },
    frame: fitted({ width: 200, height: 480 }, 16 / 9),
    fit: "cover",
    picture: CAMERA,
  },
  {
    name: "landscape-stretched",
    tile: { width: 480, height: 200 },
    frame: "tile",
    fit: "fill",
    picture: CAMERA,
    plant: true,
  },
];

/**
 * How many cells a box shows of a picture painted into it with
 * `object-fit: cover`: the picture scales until it covers the box on both
 * axes, so the longer axis is cropped.
 */
export function coverCells(
  box: Size,
  spec: AspectCase,
): { columns: number; rows: number } {
  const { columns, rows, cell } = spec.picture;
  const scale = Math.max(
    box.width / (columns * cell),
    box.height / (rows * cell),
  );
  return {
    columns: box.width / (cell * scale),
    rows: box.height / (cell * scale),
  };
}
