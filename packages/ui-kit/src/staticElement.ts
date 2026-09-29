/**
 * The elements a layout or text primitive may render as: every one of them
 * holds content and none of them is a control. A primitive that could become
 * a `button`, a link or a form field would be a control drawn outside the
 * `Button` family, with none of its colour, focus or states.
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
