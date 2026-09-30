/**
 * The tags a layout or text primitive's `as` prop accepts: every one holds
 * content and none is a control. For a button or link, use the
 * {@link Button} family.
 *
 * @category Layout
 */
export type StaticElement =
  | "div"
  | "span"
  | "section"
  | "article"
  | "aside"
  | "header"
  | "footer"
  | "nav"
  | "main"
  | "figure"
  | "figcaption"
  | "ul"
  | "ol"
  | "li"
  | "dl"
  | "dt"
  | "dd"
  | "p"
  | "blockquote"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "legend";
