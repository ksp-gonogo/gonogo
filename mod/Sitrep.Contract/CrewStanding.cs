#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    // ─────────────────────────────────────────────────────────────────────────
    // The crew-standing capability: whether a kerbal off the flight roster is
    // dead, or merely finished flying.
    //
    // KSP's ProtoCrewMember.RosterStatus has four members and no notion of a
    // career ending any way but badly. RP-1 retires a kerbal by assigning
    // rosterStatus = (RosterStatus)2, which is stock's Dead, and remembers who
    // is a retiree in a private HashSet on its own CrewHandler. Verified in the
    // disassembly of the shipped RP-1 v4.6.0.0 RP0.dll: ProcessRetirements sets
    // exactly that value and adds the name to _retirees, and IsRetired is a
    // lookup in that set. KerbalRoster.Crew filters on type only, so the retiree
    // stays on the roster we publish.
    //
    // So a retiree reached the wire indistinguishable from a fatality, and a
    // mission-control board told an operator their astronauts had been killed.
    // No reading of the stock field can recover the difference, because the
    // difference is not in the stock field.
    //
    //   • ONE exclusive capability "crewStanding" whose active instance is an
    //     ICrewStandingBackend.
    //   • A core registrar owns the capability, supplies the stock backend as its
    //     Vanilla factory, and stamps the elected backend's answer onto the
    //     crew entries it already publishes.
    //   • A career-overhaul mod registers a provider from its OWN uplink's
    //     Register, gated by its own presence probe: registering IS the gate.
    //
    // ── Why an enum core owns, rather than an open string ────────────────────
    // The obvious cheaper fix is to let a mod put any label it likes on the
    // wire and have the client group by whatever it finds. That is what the
    // roster channel already did, and what the comment on
    // CrewRosterEntry.Situation claimed would give RP-1 "a tab for free". It
    // gave nothing, because RP-1 introduces no new RosterStatus: an open label
    // channel only works when somebody is writing a new label into it, and
    // nobody was. A standing an operator acts on differently is a standing this
    // contract should name, and naming it is free.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// What a kerbal's place on the books IS, as the dashboard means it: this
    /// contract's own vocabulary, not a mirror of any game enum.
    ///
    /// <para>The first four members line up with
    /// <see cref="KspRosterStatus"/> in meaning but deliberately NOT in
    /// numbering: a mirror would tie growth here to Squad shipping a new roster
    /// status, which is the assumption that let a retiree read as a fatality.
    /// <see cref="Applicant"/> is a standing KSP expresses as a KerbalType
    /// rather than a RosterStatus, and it belongs in one enumeration with the
    /// rest because a client asking "what is this kerbal's standing" wants one
    /// answer.</para>
    ///
    /// <para>Behind <c>spaceCenter.crewRoster[].standing</c>, and it is the
    /// field to branch on; see <see cref="CrewRosterEntry.SituationOrdinal"/>
    /// for what the raw KSP ordinal beside it is still good for.</para>
    /// </summary>
#if SITREP_CODEGEN
    [TsEnum]
#endif
    [SitrepContract]
    public enum CrewStanding
    {
        /// <summary>
        /// No backend could say. Distinct from every answer below, and never a
        /// stand-in for one: a capture that read no roster status at all reports
        /// this rather than guessing at Available.
        /// </summary>
        Unknown = 0,

        /// <summary>A hireable candidate, not yet on the books.</summary>
        Applicant = 1,

        /// <summary>On the books and free to fly.</summary>
        Available = 2,

        /// <summary>On the books and currently crewing a vessel.</summary>
        Assigned = 3,

        /// <summary>
        /// Finished flying, alive, off the flight roster for good. Reachable
        /// only through a backend that models a career ending well; stock has no
        /// such concept and never reports it.
        /// </summary>
        Retired = 4,

        /// <summary>Killed.</summary>
        Dead = 5,

        /// <summary>Missing: KSP's own separate answer, kept separate.</summary>
        Missing = 6,
    }

    /// <summary>
    /// The mapping between the two enums this contract declares: what KSP's own
    /// roster status means in the vocabulary above, before any backend has a say.
    /// </summary>
    /// <remarks>
    /// In the contract rather than in the stock backend because BOTH halves need
    /// it and they live in different assemblies: the core registrar applies it
    /// wherever a backend declines to answer, and a mod backend that corrects one
    /// standing needs the default for every other kerbal it is handed. An Uplink
    /// may reference only this assembly, so a copy in <c>Sitrep.Host</c> would be
    /// a copy an Uplink author has to rewrite.
    /// </remarks>
    public static class CrewStandings
    {
        /// <summary>
        /// KSP's roster status as a <see cref="CrewStanding"/>. An applicant
        /// answers <see cref="CrewStanding.Applicant"/> without consulting the
        /// ordinal at all, because an applicant has none; an unreadable or
        /// unrecognised ordinal answers <see cref="CrewStanding.Unknown"/> rather
        /// than the friendliest guess.
        /// </summary>
        public static CrewStanding FromRosterStatus(int? rosterStatusOrdinal, bool isApplicant)
        {
            if (isApplicant)
            {
                return CrewStanding.Applicant;
            }
            switch (rosterStatusOrdinal)
            {
                case (int)KspRosterStatus.Available: return CrewStanding.Available;
                case (int)KspRosterStatus.Assigned: return CrewStanding.Assigned;
                case (int)KspRosterStatus.Dead: return CrewStanding.Dead;
                case (int)KspRosterStatus.Missing: return CrewStanding.Missing;
                default: return CrewStanding.Unknown;
            }
        }
    }

    /// <summary>
    /// One backend's reading of a single kerbal's standing. Plain data, no KSP
    /// and no game types, so this assembly stays KSP-free and a backend can be
    /// exercised headless.
    /// </summary>
    /// <remarks>
    /// Not a wire type: the wire keys are built by the space-centre view
    /// provider, and this is the SPI shape a backend answers in. Every member is
    /// nullable and null means this backend does not model that field, so the
    /// core registrar's own derivation stands for it.
    /// </remarks>
    public sealed class CrewStandingReading
    {
        /// <summary>
        /// The standing itself. Null when the backend has nothing to say about
        /// this kerbal, which for a mod backend is the ordinary case: RP-1
        /// corrects the handful of names in its retiree set and leaves every
        /// other kerbal to the stock reading.
        /// </summary>
        public CrewStanding? Standing { get; set; }

        /// <summary>
        /// Whether the kerbal is free to fly. Null to leave the derivation from
        /// <see cref="Standing"/> standing, which is what a backend that only
        /// corrects the standing wants.
        /// </summary>
        public bool? Available { get; set; }

        /// <summary>
        /// Why the kerbal cannot fly, when the backend wants to say it in its
        /// own words rather than let the standing be relabelled. Null to leave
        /// the derivation standing.
        /// </summary>
        public string? UnavailableReason { get; set; }
    }

    /// <summary>
    /// The active instance of the exclusive <c>"crewStanding"</c> capability:
    /// what this install makes of a kerbal whose roster status alone is not the
    /// answer.
    /// </summary>
    public interface ICrewStandingBackend : ISitrepProvider
    {
        /// <summary>
        /// Read one kerbal's standing.
        /// </summary>
        /// <param name="kerbalName">
        /// The kerbal's <c>ProtoCrewMember.name</c>, which is the id every
        /// career-overhaul mod on record keys its own crew bookkeeping by. A
        /// NAME rather than the crew member itself because this assembly has no
        /// KSP types and must not acquire any.
        /// </param>
        /// <param name="rosterStatusOrdinal">
        /// KSP's own <c>(int)ProtoCrewMember.RosterStatus</c>, or null when the
        /// capture could not read one. Passed in rather than read for the same
        /// reason <see cref="IEconomyBackend"/> is handed the reputation: the
        /// value is not in dispute, only what it means, and a backend that only
        /// disambiguates one value needs to see which value it got.
        /// </param>
        /// <param name="isApplicant">
        /// Whether this entry is a hireable candidate rather than owned crew. An
        /// applicant has no roster status at all, and a backend that models
        /// applicant retirement (RP-1 does) needs to know which it is looking at.
        /// </param>
        /// <returns>
        /// The reading, or null when this backend has nothing to add for this
        /// kerbal. Null is the common answer and is not a failure.
        /// </returns>
        CrewStandingReading? Read(string kerbalName, int? rosterStatusOrdinal, bool isApplicant);
    }
}
