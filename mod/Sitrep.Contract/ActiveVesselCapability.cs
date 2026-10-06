namespace Sitrep.Contract
{
    /// <summary>
    /// The capability id an <see cref="IActiveVessel"/> is registered under.
    /// Resolve it through <see cref="IUplinkHost.Kernel"/>, or use
    /// <see cref="ActiveVesselQuery"/>, which does that on each call. Gonogo
    /// registers the only provider.
    /// <internal>
    /// There is nothing to elect: which vessel the stream is scoped to is a
    /// decision the mod makes and publishes. It is a capability because that is
    /// how an Uplink reaches the mod.
    /// </internal>
    /// </summary>
    /// <category>Host and Kernel</category>
    public static class ActiveVesselCapability
    {
        /// <summary>The capability id, <c>"activeVessel"</c>.</summary>
        public const string Id = "activeVessel";
    }

    /// <summary>
    /// The vessel every active-vessel-scoped channel is about, which is not
    /// always the one KSP is flying: while a kerbal is on EVA, it is the craft
    /// they stepped out of. An Uplink that reports on or commands "the vessel"
    /// should use this rather than <c>FlightGlobals.ActiveVessel</c>, so that
    /// part ids from the parts channel resolve against the craft the operator
    /// sees.
    ///
    /// <para>Read it on each call and never cache it. The value changes on a
    /// vessel switch, a dock, an undock, and on both ends of an EVA, and a
    /// handle held across any of those points at a craft that is no longer the
    /// subject.</para>
    ///
    /// <para>Main thread only, because it reads live game state: call it from a
    /// command handler or the main-thread capture of
    /// <see cref="IUplinkHost.AddSampledSource(System.Func{KspSnapshot?, object?}, System.Action{object?})"/>,
    /// never from a map passed to <see cref="IUplinkHost.AddChannelSource"/>.</para>
    /// </summary>
    /// <category>Host and Kernel</category>
    public interface IActiveVessel : ISitrepProvider
    {
        /// <summary>
        /// The reported vessel as an opaque handle: a KSP <c>Vessel</c>, which a
        /// consumer that already references KSP casts, and one that does not
        /// passes on without naming.
        ///
        /// <para>Null when there is no flight. Never a stand-in: a consumer that
        /// acted on a substituted vessel would act on the wrong craft.</para>
        /// </summary>
        object? Reported { get; }

        /// <summary>
        /// The same vessel's id, in the <c>vessel.id.ToString()</c> form every
        /// fleet topic keys on, or null when there is no flight. The half of
        /// this a consumer can use without naming a KSP type.
        /// </summary>
        string? ReportedId { get; }

        /// <summary>
        /// True while <see cref="Reported"/> is NOT what KSP is flying: a kerbal
        /// is outside, and this is the craft they left.
        ///
        /// <para>It matters to commands, not reads. Most stock calls take no
        /// vessel and act on KSP's own active one, so a command issued in this
        /// state acts on the kerbal, or on nothing, while reporting success. A
        /// command handler that cannot reach the reported craft should refuse
        /// with <see cref="CommandErrorCode.WrongState"/>; the command works again
        /// once the kerbal boards.</para>
        ///
        /// <para>False when there is no flight, because there is then nothing to
        /// substitute.</para>
        /// </summary>
        bool SubstitutedForEva { get; }
    }
}
