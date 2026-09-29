namespace Sitrep.Contract
{
    /// <summary>
    /// The capability id an <see cref="IActiveVessel"/> is registered under.
    /// Resolve it through <c>host.Kernel</c>, or use
    /// <see cref="ActiveVesselQuery"/>, which does that per call.
    /// </summary>
    /// <remarks>
    /// There is one provider, the mod's own, and nothing to elect: which vessel
    /// the stream is scoped to is a decision the mod makes and publishes. It is
    /// a capability because that is how an Uplink reaches the mod.
    /// </remarks>
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
    /// <para><b>Read it per call, never cache it.</b> The value changes on a
    /// vessel switch, a dock, an undock, and on both ends of an EVA, and a
    /// handle held across any of those addresses a craft that is no longer the
    /// subject.</para>
    ///
    /// <para><b>Main thread only.</b> This reads live game state, on the same
    /// terms as <see cref="IManeuverPlanSource"/>: call it from a command
    /// handler or a main-thread capture, never from a channel-source closure.
    /// </para>
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
        /// <para>It is for commands. A read wants
        /// <see cref="Reported"/> and nothing else. A write has to know, because
        /// most stock calls take no vessel and resolve KSP's own active one
        /// themselves, so a command issued in this state acts on the kerbal, or
        /// on nothing, while reporting success. A provider that cannot reach the
        /// reported craft should refuse with
        /// <see cref="CommandErrorCode.WrongState"/>: the craft is in a state
        /// this command does not work in, and it resolves when the kerbal
        /// boards, which is an act rather than a wait.</para>
        ///
        /// <para>False when there is no flight, because there is then nothing to
        /// substitute.</para>
        /// </summary>
        bool SubstitutedForEva { get; }
    }
}
