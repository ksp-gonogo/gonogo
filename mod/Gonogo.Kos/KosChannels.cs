// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

namespace Gonogo.Kos
{
    /// <summary>
    /// Pure (kOS/KSP-type-free) channel/command topic conventions for the
    /// kOS Uplink P1 surface — the exact wire strings the client consumes,
    /// kept in one place so both the manifest wiring
    /// (<see cref="KosExtension"/>) and the headless tests reference the same
    /// constants. See <c>kos-migration-spec.md</c> §4.4's topic table.
    ///
    /// <para><b>The compute topics are byte-identical to today's app-side
    /// centralised-feed keys</b> (<c>kos.compute.&lt;id&gt;.&lt;field&gt;</c>
    /// / <c>.status</c> — see the repo CLAUDE.md "Centralised kOS scripts"
    /// section and <c>packages/core/src/kos/scriptRegistry.ts</c>), so the
    /// client migrates by a pure <c>useDataValue → useStream</c> swap with no
    /// topic change on the wire.</para>
    /// </summary>
    public static class KosChannels
    {
        /// <summary>Static channel: the list of live CPUs (was the telnet menu-scrape). Payload = <c>List&lt;KosProcessorInfo&gt;</c>.</summary>
        public const string ProcessorsTopic = "kos.processors";

        /// <summary>Dynamic namespace prefix for every compute feed's parsed values: <c>kos.compute.&lt;id&gt;.&lt;field&gt;</c>.</summary>
        public const string ComputePrefix = "kos.compute.";

        /// <summary>Command: run a registered compute script on a CPU (the <c>RUNPATH</c> trigger).</summary>
        public const string ExecCommand = "kos.exec";

        /// <summary>Command alias for <see cref="ExecCommand"/> — the app-side <c>dispatchNow</c> affordance.</summary>
        public const string DispatchNowCommand = "kos.dispatchNow";

        /// <summary>Command: re-arm a tripped per-topic compute breaker.</summary>
        public const string ReEnableCommand = "kos.reEnable";

        /// <summary>Sub-topic (relative to <see cref="ComputePrefix"/>) for one compute field: <c>"&lt;id&gt;.&lt;field&gt;"</c>.</summary>
        public static string ComputeFieldSubTopic(string scriptId, string field) => scriptId + "." + field;

        /// <summary>
        /// Sub-topic (relative to <see cref="ComputePrefix"/>) for one compute
        /// feed's status: <c>"&lt;id&gt;.status"</c>.
        ///
        /// <para><b>P1 has no producer for this sub-topic.</b> The status channel
        /// (<c>KosComputeStatus</c> — running / lastGoodAt / scriptError /
        /// parseError / paused) is only fed once the mod-side per-topic breaker
        /// lands in P2 (see <see cref="ReEnableCommand"/>'s P1-no-op note and the
        /// spec §4.4 breaker). Until then the client's <c>useKosScriptStatus</c>
        /// receives nothing on this topic — the additive contract type + the
        /// topic convention ship now (so the wire shape is fixed and the client
        /// can migrate), the producer follows in P2. This is a deliberate,
        /// disclosed gap, not a wiring omission.</para>
        /// </summary>
        public static string ComputeStatusSubTopic(string scriptId) => scriptId + ".status";
    }
}
