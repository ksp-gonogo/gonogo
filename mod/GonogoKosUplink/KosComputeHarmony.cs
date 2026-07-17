// GonogoKosUplink — GPLv3. See GonogoKosUplink.csproj's header comment for the
// licence/linkage rationale.

using System;
using System.Reflection;
using HarmonyLib;
using kOS.Safe.Screen;

namespace Gonogo.KosUplink
{
    /// <summary>
    /// The ONE Harmony patch this Uplink ships — an OBSERVE-ONLY postfix on
    /// <c>kOS.Safe.Screen.ScreenBuffer.Print(string, bool)</c>
    /// (<c>kos-migration-spec.md</c> §4(b)/§4.1, <c>ScreenBuffer.cs:167</c>).
    /// Every kerboscript <c>PRINT</c> flows through this one method BEFORE it
    /// is line-wrapped into the grid, so the postfix sees the clean,
    /// un-wrapped, un-ANSI'd source text — the strictly-better input for
    /// <c>[KOSDATA]</c> capture than the old rendered-grid scrape.
    ///
    /// <para>The postfix runs on the KSP main thread (inside <c>PRINT</c>) and
    /// MUST NOT block: it only forwards <c>(screen, text)</c> to
    /// <see cref="Sink"/>, which the Uplink sets to its own main-thread
    /// resolve+accumulate+publish path. If <see cref="Sink"/> is null (patch
    /// installed but Uplink torn down) or throws, the postfix swallows it —
    /// an observe-only patch must never disturb kOS's own <c>PRINT</c>.</para>
    ///
    /// <para>Installed manually (not <c>PatchAll</c>) and ONLY when the
    /// version-guard confirms the <c>Print(string,bool)</c> target exists
    /// (<see cref="KosVersionGuard"/>'s <c>ComputePostfixAvailable</c>);
    /// otherwise compute falls back to the public snapshot-scrape (spec §4.4).</para>
    /// </summary>
    public static class KosComputeHarmony
    {
        /// <summary>
        /// Set by <see cref="KosExtension"/> to its main-thread capture path:
        /// <c>(screenBuffer, printedText)</c>. Called on the KSP main thread,
        /// synchronously inside kOS's <c>PRINT</c>.
        /// </summary>
        public static Action<object, string>? Sink;

        private const string HarmonyId = "gonogo.kos.compute.print";

        /// <summary>
        /// Installs the postfix on <c>ScreenBuffer.Print(string, bool)</c>.
        /// Idempotent-ish: a fresh <see cref="Harmony"/> instance is created
        /// per call, so callers should install exactly once (the Uplink does,
        /// from <c>Register</c>). Returns false (and installs nothing) if the
        /// pinned target can't be resolved — the caller then stays on the
        /// snapshot-scrape fallback.
        /// </summary>
        public static bool Install()
        {
            MethodInfo? target = AccessTools.Method(
                typeof(ScreenBuffer),
                nameof(ScreenBuffer.Print),
                new[] { typeof(string), typeof(bool) });
            if (target == null)
            {
                return false;
            }

            var postfix = new HarmonyMethod(
                typeof(KosComputeHarmony).GetMethod(nameof(PrintPostfix),
                    BindingFlags.Static | BindingFlags.NonPublic));

            var harmony = new Harmony(HarmonyId);
            harmony.Patch(target, postfix: postfix);
            return true;
        }

        // __instance is the ScreenBuffer PRINT was called on. Observe-only:
        // never reads/writes the return (Print is void) and never touches kOS
        // state — just forwards the text. Fully guarded so a sink fault can
        // never surface inside kOS's PRINT.
        private static void PrintPostfix(ScreenBuffer __instance, string textToPrint)
        {
            try
            {
                Sink?.Invoke(__instance, textToPrint);
            }
            catch
            {
                // Observe-only — swallow. A compute-capture fault must not
                // disturb the terminal.
            }
        }
    }
}
