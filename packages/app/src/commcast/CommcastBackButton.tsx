import { ArrowLeftIcon } from "@ksp-gonogo/ui-kit";
import { Commcast__Back } from "./commcastStyles";

/** Out of a conversation and back to the list of them. */
export function CommcastBackButton({ onClick }: { onClick: () => void }) {
  return (
    <Commcast__Back type="button" onClick={onClick}>
      <ArrowLeftIcon size={14} />
      Inbox
    </Commcast__Back>
  );
}
