namespace Sitrep.Contract
{
    // ─────────────────────────────────────────────────────────────────────────
    // Which vessel gonogo is reporting, as a capability rather than as a
    // convention each Uplink reinvents.
    //
    // WHAT WAS MISSING. "The active vessel" used to be one answer, KSP's, and
    // every Uplink read it straight off FlightGlobals. It is now two: while a
    // kerbal is on EVA, core reports the craft they stepped out of, because a
    // one-part kerbal with no antenna, no resources and no action groups is not
    // what mission control is watching. Core's own reads moved onto that seam.
    // An Uplink's could not: the seam lives in an assembly an Uplink may not
    // reference, so every Uplink kept answering with the kerbal.
    //
    // That is not a cosmetic split. The parts channel lists the CRAFT's parts,
    // so a repair addressed by part id resolved against the KERBAL and failed
    // for every part the operator could see - and repairing a failed part is
    // the reason to go outside in the first place.
    //
    // So core publishes the answer and an Uplink asks for it, through the
    // sanctioned seam: the interface is declared here, in the only assembly an
    // Uplink may reference, and the implementation is resolved through
    // host.Kernel.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>The capability id, and the reason it is not an election.</summary>
    /// <remarks>
    /// One provider, core's, and nothing to elect: which vessel the stream is
    /// scoped to is a decision core makes and publishes, not a model a mod could
    /// hold a rival opinion about. It is a capability all the same, because that
    /// is the only route an Uplink has into core.
    /// </remarks>
    public static class ActiveVesselCapability
    {
        public const string Id = "activeVessel";
    }

    /// <summary>
    /// The vessel every active-vessel-scoped channel is about, which is not
    /// always the one KSP is flying.
    ///
    /// <para><b>Read it per call, never cache it.</b> The answer changes on a
    /// vessel switch, a dock, an undock, and on both ends of an EVA, and a
    /// handle held across any of those addresses a craft that is no longer the
    /// subject.</para>
    ///
    /// <para><b>Main thread only.</b> This reads live game state, on the same
    /// terms as <see cref="IManeuverPlanSource"/>: call it from a command
    /// handler or a main-thread capture, never from a channel-source closure.
    /// </para>
    /// </summary>
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
        /// <para>What it is for is COMMANDS. A read wants
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
