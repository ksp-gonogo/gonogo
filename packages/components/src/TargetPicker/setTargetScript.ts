/**
 * One-shot kerboscript that sets the KSP target by vessel name (or clears
 * it). Runs from the Target Picker's "click a vessel name to target it"
 * flow via `executeScript` — not a feed, so it doesn't go through the
 * centralised `kos.compute.*` registry.
 *
 * Pass `<clear>` to clear the target (kerboscript's `SET TARGET TO ""`
 * semantics); any other non-empty string is treated as a vessel NAME to
 * look up and SET TARGET to.
 *
 * Output contract:
 *   [KOSDATA]ok=true[/KOSDATA]              — completed cleanly
 *   [KOSDATA]ok=false;reason=<text>[/KOSDATA] — name didn't match any vessel
 *
 * The widget mostly ignores the body — it just needs to know the call
 * resolved so it can trigger a refresh of the centralised feed.
 */
export const SET_TARGET_SCRIPT = `// gonogo target-picker — set the KSP target by vessel name (or clear).
PARAMETER setTargetName IS "".

LOCAL ts IS LIST().
LIST TARGETS IN ts.

IF setTargetName:LENGTH = 0 {
  PRINT "[KOSDATA]ok=true[/KOSDATA]".
} ELSE IF setTargetName = "<clear>" {
  SET TARGET TO "".
  PRINT "[KOSDATA]ok=true[/KOSDATA]".
} ELSE {
  LOCAL found IS FALSE.
  FOR v IN ts {
    IF NOT found AND v:NAME = setTargetName {
      SET TARGET TO v.
      SET found TO TRUE.
    }
  }
  IF found {
    PRINT "[KOSDATA]ok=true[/KOSDATA]".
  } ELSE {
    PRINT "[KOSDATA]ok=false;reason=no match[/KOSDATA]".
  }
}
`;

/** Path on the kOS Archive volume — same convention as registered scripts. */
export const SET_TARGET_SCRIPT_NAME = "0:/widget_scripts/setTarget.ks";
