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

        public string ProviderId => KerbalismScienceMap.ProviderId;

        /// <summary>Hand the tick's main-thread capture over. Called from the Courier thread.</summary>
        public void Stash(ScienceRaw raw) => _latest = raw;

        /// <summary>
        /// The latest capture, for the File Manager command handlers'
        /// KSP-free pre-filter (<see cref="KerbalismFileCommandProvider"/>).
        /// Same Courier-thread-only data as every read method below.
        ///
        /// <para><b>This is refreshed only while something under <c>science.</c> is
        /// subscribed</b>, because the capture that stashes it is registered with
        /// that prefix and the engine skips a gated capture entirely on any tick
        /// where nothing under its prefixes is watched. The channel mappers above
        /// are unaffected, since their topics ARE the gated ones. The command
        /// pre-filter is not: a caller that sends a file verb without ever having
        /// subscribed a science topic in this session reads the default bundle,
        /// whose <c>Modeled</c> is false, and every verb refuses with
        /// ModeUnavailable, meaning "Kerbalism is not modelling science", about an
        /// install that is.</para>
        ///
        /// <para>Left gated rather than fixed by ungating, and the reason is the
        /// cost: the capture walks every drive and science module on the vessel, and
        /// nothing needs that per tick the way the trajectory capabilities need
        /// their readings. In the shipped path the dependency is satisfied, because
        /// the File Manager widget subscribes <c>science.experiments</c> and
        /// <c>science.lab</c> in the same component that sends the verbs, and the
        /// subject id it sends comes off those rows. That is a coincidence of how
        /// one client is built, not a guarantee: a command centre or an automation
        /// holding a subject id and no science subscription gets the false refusal.
        /// If that becomes a real path, the fix is to read the drive live at command
        /// time on the main thread, not to ungate this.</para>
        /// </summary>
        public ScienceRaw Latest => _latest;

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
