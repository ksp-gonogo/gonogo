import { value } from "@ksp-gonogo/sitrep-sdk";

/**
 * A measured light-time delay as a value in seconds, rounded to the second from one second up. The kit's time ladder truncates, which is right for a countdown and would read 3.9998 s as 3s.
 */
export function measuredDelay(seconds: number) {
  return value("s", seconds >= 1 ? Math.round(seconds) : seconds);
}
