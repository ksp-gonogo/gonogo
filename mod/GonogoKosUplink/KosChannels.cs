// GonogoKosUplink: GPLv3. See GonogoKosUplink.csproj's header comment for the
// licence/linkage rationale.

namespace Gonogo.KosUplink
{
    /// <summary>
    /// Pure (kOS/KSP-type-free) channel/command topic conventions for the
    /// kOS Uplink P1 surface: the exact wire strings the client consumes,
    /// kept in one place so both the manifest wiring
    /// (<see cref="KosExtension"/>) and the headless tests reference the same
    /// constants. See <c>kos-migration-spec.md</c> §4.4's topic table.
    ///
    /// <para><b>The compute namespace has no client left.</b>
    /// <c>kos.compute.&lt;id&gt;.&lt;field&gt;</c> kept the app's old
    /// centralised-feed keys byte-for-byte so the client could migrate without
    /// a wire change; that registry was later deleted and nothing subscribes.
    /// <see cref="ComputePrefix"/> and <see cref="ComputeStatusSubTopic"/>
    /// survive as the shape a compute feed WOULD take, not as a live
    /// surface.</para>
    /// </summary>
    public static class KosChannels
    {
        /// <summary>Static channel: the list of live CPUs (was the telnet menu-scrape). Payload = <c>List&lt;KosProcessorInfo&gt;</c>.</summary>
        public const string ProcessorsTopic = "kos.processors";

        /// <summary>Dynamic namespace prefix for every compute feed's parsed values: <c>kos.compute.&lt;id&gt;.&lt;field&gt;</c>.</summary>
        public const string ComputePrefix = "kos.compute.";

        /// <summary>
        /// Dynamic namespace prefix for the interactive terminal screen
        /// downlink: <c>kos.terminal.&lt;coreId&gt;</c>
        /// (<c>Delivery.ReliableOrdered</c>, <c>DelayRole.Delayed</c>). Payload
        /// = <see cref="Sitrep.Contract.KosTerminalFrame"/>. Replaces the
        /// standalone telnet proxy's byte stream: the mod reads the CPU screen
        /// in-process and publishes xterm-ready diffs.
        /// </summary>
        public const string TerminalPrefix = "kos.terminal.";

        /// <summary>Command: acquire the single-owner write lease on a CPU terminal (<see cref="Sitrep.Contract.KosTerminalOpenArgs"/>).</summary>
        public const string TerminalOpenCommand = "kos.terminal.open";

        /// <summary>Command: type input into a leased CPU terminal (<see cref="Sitrep.Contract.KosKeystrokeArgs"/>).</summary>
        public const string KeystrokeCommand = "kos.keystroke";

        /// <summary>Command: resize a leased CPU terminal (<see cref="Sitrep.Contract.KosTerminalResizeArgs"/>).</summary>
        public const string TerminalResizeCommand = "kos.terminal.resize";

        /// <summary>Command: release the write lease on a CPU terminal (<see cref="Sitrep.Contract.KosTerminalCloseArgs"/>).</summary>
        public const string TerminalCloseCommand = "kos.terminal.close";

        /// <summary>The concrete downlink sub-topic (relative to <see cref="TerminalPrefix"/>) for one CPU: the <c>KOSCoreId</c> as a string.</summary>
        public static string TerminalSubTopic(int coreId) => coreId.ToString(System.Globalization.CultureInfo.InvariantCulture);

        /// <summary>The full downlink topic for one CPU: <c>kos.terminal.&lt;coreId&gt;</c>.</summary>
        public static string TerminalTopic(int coreId) => TerminalPrefix + TerminalSubTopic(coreId);

        /// <summary>
        /// The reverse of <see cref="TerminalTopic"/>: recovers the
        /// <c>coreId</c> from a concrete <c>kos.terminal.&lt;coreId&gt;</c>
        /// topic string. Used by the <see cref="TerminalPrefix"/> dynamic
        /// namespace's <c>IDynamicChannelSource.OnSubscribed</c> listener to
        /// translate the subscribed TOPIC the engine hands back into the
        /// coreId <c>KosTerminalManager.NotifySubscribed</c> expects: see
        /// Gap A of the terminal-integrity adversarial review. Returns false for
        /// anything not under <see cref="TerminalPrefix"/> or whose
        /// sub-topic isn't a plain integer.
        /// </summary>
        public static bool TryParseTerminalCoreId(string topic, out int coreId)
        {
            coreId = 0;
            if (string.IsNullOrEmpty(topic) || !topic.StartsWith(TerminalPrefix, System.StringComparison.Ordinal))
            {
                return false;
            }
            var subTopic = topic.Substring(TerminalPrefix.Length);
            return int.TryParse(
                subTopic,
                System.Globalization.NumberStyles.Integer,
                System.Globalization.CultureInfo.InvariantCulture,
                out coreId);
        }

        /// <summary>Sub-topic (relative to <see cref="ComputePrefix"/>) for one compute field: <c>"&lt;id&gt;.&lt;field&gt;"</c>.</summary>
        public static string ComputeFieldSubTopic(string scriptId, string field) => scriptId + "." + field;

        /// <summary>
        /// Sub-topic (relative to <see cref="ComputePrefix"/>) for one compute
        /// feed's status: <c>"&lt;id&gt;.status"</c>.
        ///
        /// <para><b>Nothing produces this sub-topic.</b> The status channel
        /// (<c>KosComputeStatus</c>: running / lastGoodAt / scriptError /
        /// parseError / paused) needs a mod-side per-topic breaker, which was
        /// never built, and the app-side registry that would have consumed it
        /// has since been deleted. The contract type and the topic convention
        /// are all that survive: a subscriber gets nothing.</para>
        /// </summary>
        public static string ComputeStatusSubTopic(string scriptId) => scriptId + ".status";

        /// <summary>
        /// Command: run an arbitrary, caller-supplied command line on a CPU's
        /// REPL and correlate the resulting <c>[KOSDATA]</c>/<c>[KOSERROR]</c>
        /// block back via <see cref="RunTopic"/> (<see cref="Sitrep.Contract.KosRunArgs"/>).
        /// The general-purpose replacement for the standalone telnet proxy's
        /// ad-hoc <c>executeScript</c> RPC: see
        /// <c>kos-uplink-full-migration.md</c>. The only way to run anything on
        /// a CPU now that the fixed pre-registered compute-script trigger is
        /// gone: it runs whatever command text the caller built and reports back
        /// exactly that call's result.
        /// </summary>
        public const string RunCommand = "kos.run";

        /// <summary>
        /// Dynamic namespace prefix for the <c>kos.run</c> result channel:
        /// <c>kos.run.&lt;coreId&gt;</c> (<c>Delivery.ReliableOrdered</c>,
        /// <c>DelayRole.Delayed</c>). Payload = <see cref="Sitrep.Contract.KosRunResult"/>.
        /// </summary>
        public const string RunPrefix = "kos.run.";

        /// <summary>The concrete result sub-topic (relative to <see cref="RunPrefix"/>) for one CPU: the <c>KOSCoreId</c> as a string.</summary>
        public static string RunSubTopic(int coreId) => coreId.ToString(System.Globalization.CultureInfo.InvariantCulture);

        /// <summary>The full result topic for one CPU: <c>kos.run.&lt;coreId&gt;</c>.</summary>
        public static string RunTopic(int coreId) => RunPrefix + RunSubTopic(coreId);
    }
}
