import { Badge, Cluster, type Severity } from "@ksp-gonogo/ui-kit";

/**
 * A badge naming the SUBSYSTEM and a plain sentence saying what is wrong. A
 * `Badge` is nowrap by design, so the sentence stays outside it.
 */
export function AbsenceLine({
  severity,
  state,
  label,
}: {
  severity: Severity;
  /** The sentence beside the badge: what is wrong, in the operator's terms. */
  state: string;
  label: string;
}) {
  return (
    <Cluster
      justify="start"
      align="baseline"
      wrap
      role="status"
      aria-label={label}
    >
      <Badge severity={severity}>reliability</Badge>
      <span>{state}</span>
    </Cluster>
  );
}
