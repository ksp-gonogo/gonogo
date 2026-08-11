using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// Kerbalism's <see cref="IScienceBackend"/>: the provider that WINS the
    /// <c>"science"</c> capability election when Kerbalism is installed, so the
    /// existing <c>science.*</c> topics carry Kerbalism's model instead of a stock
    /// walk that would report an empty vessel. Registered at
    /// <see cref="KerbalismUplink"/>'s Register, only when the reflection probe
    /// confirms the mod is loaded: registering IS the gate.
    ///
    /// <para><b>Why it wins outright rather than augmenting.</b> Kerbalism does not
    /// add to stock science, it replaces it: results live on its own drives, not in
    /// <c>ModuleScienceExperiment</c>, so the stock backend genuinely has nothing to
    /// report on a Kerbalism vessel. Two parallel topics would have meant two
    /// widgets and two mental models permanently.</para>
    ///
    /// <para><b>Why this reads a STASH rather than live Kerbalism.</b> The elected
    /// backend's read methods are called from a channel mapper, which runs on the
    /// engine's Courier thread, where touching a live KSP/Unity API is a crash or
    /// garbage-data risk. So the Uplink captures Kerbalism on the MAIN thread
    /// through <c>AddSampledSource</c> (the seam that exists for exactly this) and
    /// hands the plain <see cref="ScienceRaw"/> bundle here via
    /// <see cref="Stash"/>; the mapping itself is pure and runs where it is asked
    /// to. Both the stash write (that source's handle-on-Courier half) and every
    /// read below are on the Courier thread, so there is no cross-thread hazard to
    /// guard: the hand-off across threads is the engine's, already done, in plain
    /// data.</para>
    ///
    /// <para>Before the first capture lands, and whenever Kerbalism is not
    /// modelling science, every read returns null: "nothing to say", which leaves
    /// the channel unborn and silent rather than publishing an empty list (see
    /// <see cref="IScienceBackend"/>).</para>
    /// </summary>
    public sealed class KerbalismScienceBackend : IScienceBackend
    {
        /// <summary>
        /// The latest main-thread capture. Courier-thread-only: written by the
        /// Uplink's handle-on-Courier half, read by the channel mappers, both on
        /// that one thread.
        /// </summary>
        private ScienceRaw _latest = new ScienceRaw();

        public string BackendId => KerbalismScienceMap.ProviderId;

        /// <summary>Hand the tick's main-thread capture over. Called from the Courier thread.</summary>
        public void Stash(ScienceRaw raw) => _latest = raw;

        public object? Experiments(KspSnapshot? snapshot) => KerbalismScienceMap.Experiments(_latest);

        public object? Instruments(KspSnapshot? snapshot) => KerbalismScienceMap.Instruments(_latest);

        public object? Sensors(KspSnapshot? snapshot) => KerbalismScienceMap.Sensors(_latest);

        public object? Lab(KspSnapshot? snapshot) => KerbalismScienceMap.Lab(_latest);

        public object? ExperimentBreakdown(KspSnapshot? snapshot) => KerbalismScienceMap.ExperimentBreakdown(_latest);

        /// <summary>
        /// Kerbalism has no fire-once "run this experiment now": running is a
        /// continuous state its own state machine owns, started from the part's UI
        /// or by its automation, and gated on the requirements the
        /// <c>issue</c> field reports. There is no honest actuation for this command
        /// to perform, so it refuses with a typed
        /// <see cref="CommandErrorCode.ModeUnavailable"/> rather than reporting a
        /// success that changed nothing.
        ///
        /// <para>A start/stop command surface that fits BOTH models is the right fix
        /// and belongs to the command-verb step, not here: adding it would change
        /// the shared command contract, which this pass deliberately does not
        /// touch.</para>
        /// </summary>
        public CommandResult DeployExperiment(ExperimentActionArgs args) =>
            CommandResult.Fail(CommandErrorCode.ModeUnavailable);

        /// <summary>
        /// Same as <see cref="DeployExperiment"/>: Kerbalism transmits continuously,
        /// draining files highest-value-first whenever the link and EC allow, so
        /// "transmit this now" has nothing to trigger. The live rate and the
        /// transmitting flag are on the entry's extension namespace, which is how a
        /// widget shows the operator what IS happening instead of offering a button
        /// that does nothing.
        /// </summary>
        public CommandResult TransmitExperiment(ExperimentActionArgs args) =>
            CommandResult.Fail(CommandErrorCode.ModeUnavailable);
    }
}
