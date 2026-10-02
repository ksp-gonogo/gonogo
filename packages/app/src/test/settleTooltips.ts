import { act } from "@ksp-gonogo/test-utils";

/**
 * Holds the test's `act` scope open past the kit Tooltip's pointer-leave
 * delay (120 ms), whose timer updates state when it fires. A test that moves
 * the pointer off a tooltip anchor ends its body before that timer does, and the
 * update then lands outside `act`.
 */
export async function settleTooltips(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
}
