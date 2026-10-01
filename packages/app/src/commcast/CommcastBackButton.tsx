import { ArrowLeftIcon } from "@ksp-gonogo/ui-kit";
import { Commcast__Back } from "./commcastStyles";

/** Back out of a view, named for where it leads: the inbox, unless a thread is what it returns to. */
export function CommcastBackButton({
  onClick,
  label = "Inbox",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <Commcast__Back type="button" onClick={onClick}>
      <ArrowLeftIcon size="var(--icon-size-control)" />
      {label}
    </Commcast__Back>
  );
}
