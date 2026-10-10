/** The widget's own default size, which a test holds equal to the one it registers: the default stories show what an operator gets when they add the widget. */
export const DEFAULT_SIZE = { w: 14, h: 24 };

/** The smallest size the widget can be given, which a test holds equal to the one it registers: below eight columns its plots fold away into plain readouts. */
export const MIN_SIZE = { w: 4, h: 6 };

/** The smallest tile that shows a three-plot descent whole, every row in view with no scrolling and the three plots side by side: measured on the atmospheric and ocean stories in a built Storybook, and held three across by a test. */
export const COMPACT_SIZE = { w: 13, h: 21 };

/** A large tile, for how the plots grow with the room they are given. */
export const LARGE_SIZE = { w: 24, h: 30 };

/** The wide stories' size: the touchdown plot beside the cross-section, the readouts under them in view. */
export const WIDE_SIZE = { w: 16, h: 24 };
