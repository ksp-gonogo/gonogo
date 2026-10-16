import { File } from "@asyncapi/generator-react-sdk";
import { parse } from "yaml";
import { renderPage } from "../lib/page.mjs";

/**
 * Reads the document as written rather than the parser's resolved model, so
 * every `$ref` still names its schema and the page can link to it.
 */
export default function ApiPage({ originalAsyncAPI }) {
  return <File name="index.html">{renderPage(parse(originalAsyncAPI))}</File>;
}
