import {
  getRuntimeRegisteredTopicIds,
  topicDisplayNameOf,
} from "@ksp-gonogo/sitrep-sdk";
import { humaniseFieldPath, type TopicFieldKey } from "./topicFieldCatalog";

/** The Topics a picker offers before any search is typed. */
const COMMON_TOPICS: ReadonlySet<string> = new Set([
  "vessel.flight",
  "vessel.orbit",
  "vessel.propulsion",
  "vessel.resources",
]);

export interface SeriesChoice {
  /** The heading the field is listed under. */
  group: string;
  /** The field as the list shows it under its heading. */
  label: string;
  /** The subject and field together, which is what reads unambiguously once picked. */
  summary: string;
  /** Offered before any search is typed. */
  common: boolean;
}

/** "acme.reactor" becomes "Acme". */
function uplinkName(topic: string): string {
  return humaniseFieldPath(topic.split(".")[0]);
}

/**
 * The picker wording for one catalogue field: a core Topic is listed under what
 * it describes, an Uplink's Topic under that Uplink's own name. Each name is the
 * one the Topic's contract declares, and a tidied id where it declares none.
 */
export function seriesChoice(
  entry: TopicFieldKey,
  uplinkTopics: ReadonlySet<string> = new Set(getRuntimeRegisteredTopicIds()),
): SeriesChoice {
  const subject = topicDisplayNameOf(entry.topic);
  if (uplinkTopics.has(entry.topic)) {
    const rest = entry.topic.split(".").slice(1).join(".");
    const topicName =
      subject ?? (rest === "" ? undefined : humaniseFieldPath(rest));
    const label =
      topicName === undefined ? entry.label : `${topicName} › ${entry.label}`;
    const group = uplinkName(entry.topic);
    return { group, label, summary: `${group} › ${label}`, common: false };
  }
  const group = subject ?? humaniseFieldPath(entry.topic);
  return {
    group,
    label: entry.label,
    summary: `${group} › ${entry.label}`,
    common: COMMON_TOPICS.has(entry.topic),
  };
}
