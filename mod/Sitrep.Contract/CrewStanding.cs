#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /*
     * The crew-standing capability: whether a kerbal off the flight roster is
     * dead, or merely finished flying.
     *
     * KSP's ProtoCrewMember.RosterStatus has four members and no notion of a
     * career ending any way but badly. RP-1 retires a kerbal by assigning
     * rosterStatus = (RosterStatus)2, which is stock's Dead, and remembers who is
     * a retiree in a private set on its own CrewHandler. KerbalRoster.Crew
     * filters on type only, so the retiree stays on the published roster, and no
     * reading of the stock field can tell a retiree from a fatality.
     *
     * One exclusive capability "crewStanding" whose active instance is an
     * ICrewStandingBackend. A core registrar owns the capability, supplies the
     * stock backend as its Vanilla factory, and stamps the elected backend's
     * reading onto the crew entries it already publishes. A career-overhaul mod
     * registers a provider from its own Uplink's Register, gated by its own
     * presence probe.
     *
     * The vocabulary is an enum this contract owns rather than an open string: a
     * standing an operator acts on differently is a standing the contract should
     * name.
     */

    /// <summary>
    /// What a kerbal's place on the books IS, as the dashboard means it: this
    /// contract's own vocabulary, not a mirror of any game enum.
    ///
    /// <para>The roster-status members line up with
    /// <see cref="KspRosterStatus"/> in meaning but NOT in numbering, so never
    /// cast one to the other. <see cref="Applicant"/> is a standing KSP
    /// expresses as a KerbalType rather than a RosterStatus, and it sits in one
    /// enumeration with the rest so "what is this kerbal's standing" is one
    /// value.</para>
    ///
    /// <para>Behind <c>spaceCenter.crewRoster[].standing</c>, and it is the
    /// field to branch on; see <see cref="CrewRosterEntry.SituationOrdinal"/>
    /// for what the raw KSP ordinal beside it is still good for.</para>
    ///
    /// <para><b>The numbering IS the reading order</b>: sorted by value, a crew
    /// surface reads free to fly, then committed, then off the books. The SDK's
    /// <c>CREW_STANDING_ORDER</c> is derived from it. A new member is inserted at
    /// its place in that order rather than appended.</para>
    /// <internal>
    /// A numbering mirror of KspRosterStatus would tie growth here to Squad
    /// shipping a new roster status, which is the assumption that let a retiree
    /// read as a fatality.
    /// </internal>
    /// </summary>
    /// <category>Crew</category>
#if SITREP_CODEGEN
    [TsEnum]
#endif
    [SitrepContract]
    public enum CrewStanding
    {
        /// <summary>
        /// No backend could say. Distinct from every member below, and never a
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
        /// On the books, committed to a training course, and not assignable
        /// until it finishes. <see cref="CrewStandingReading.StandingEndsAtUt"/>
        /// carries the course's own ETA.
        ///
        /// <para>Reachable only through a backend that models training. Stock has
        /// no courses, so a stock install never reports it, and KSP's roster
        /// status for a kerbal mid-course is <c>Available</c>, so the game field
        /// alone does not say it.</para>
        /// </summary>
        Training = 4,

        /// <summary>
        /// On the books, standing down after a flight, and not assignable until
        /// the rest period ends.
        /// <see cref="CrewStandingReading.StandingEndsAtUt"/> carries its end.
        ///
        /// <para>Derived from KSP's own <c>ProtoCrewMember.inactive</c>, so the
        /// stock backend reports it and every install gets it. Stock rarely sets
        /// the field; a career overhaul's post-flight R&amp;R is what usually
        /// does.</para>
        /// </summary>
        Resting = 5,

        /// <summary>
        /// Finished flying, alive, off the flight roster for good. Reachable
        /// only through a backend that models a career ending well; stock has no
        /// such concept and never reports it.
        /// </summary>
        Retired = 6,

        /// <summary>Killed.</summary>
        Dead = 7,

        /// <summary>Missing: KSP's own <c>Missing</c> roster status, kept separate from <see cref="Dead"/>.</summary>
        Missing = 8,
    }

    /// <summary>
    /// The mapping between the two enums this contract declares: what KSP's own
    /// roster status means in the vocabulary above, before any backend has a say.
    /// The core registrar applies it wherever a backend declines to read a
    /// kerbal, and a mod backend that corrects one standing can use it for the
    /// default of every other kerbal it is handed.
    /// </summary>
    /// <category>Uplink API</category>
    public static class CrewStandings
    {
        /// <summary>
        /// What <c>standingSource</c> reads when the standing is the stock map:
        /// either no backend was reachable, or the elected one declined for this
        /// kerbal. Both cases share this one spelling.
        /// </summary>
        public const string StockSource = "stock";

        /// <summary>
        /// Whether a standing means the kerbal can be assigned to a flight
        /// today, and the single definition of it: true only for
        /// <see cref="CrewStanding.Available"/> and
        /// <see cref="CrewStanding.Applicant"/>.
        ///
        /// <para>A WHITELIST, so any standing added later reads as unavailable
        /// until it is written down as flyable. An applicant counts as free:
        /// nothing blocks hiring one, and the hire surface reads this
        /// field.</para>
        /// <internal>
        /// As a blocklist, every standing added later would be flyable until
        /// somebody remembered to add it, and the standing most likely to be
        /// added is another way of being committed: a course, a medical, a
        /// quarantine.
        /// </internal>
        /// </summary>
        /// <param name="standing">The standing to test.</param>
        /// <returns>True when a kerbal with this standing can be assigned today.</returns>
        public static bool CanFly(CrewStanding standing) =>
            standing == CrewStanding.Available || standing == CrewStanding.Applicant;

        /// <summary>
        /// The human reason a kerbal cannot fly, in this contract's own words:
        /// <c>"On mission"</c>, <c>"In training"</c>, <c>"Standing down"</c>, or
        /// the standing's own name for the rest. Empty string when they can fly,
        /// and for <see cref="CrewStanding.Unknown"/>.
        ///
        /// <para>PROSE ONLY, carrying no date. The when rides
        /// <see cref="CrewStandingResolution.StandingEndsAtUt"/> as a <c>ut</c>
        /// value instead, because a date formatted here would use the mod's idea
        /// of a calendar: an RSS save counts years differently from a stock one,
        /// and the client owns that model.</para>
        /// <internal>
        /// Unknown returns empty rather than the word "Unknown" because this
        /// string sits in a tooltip beside a disabled control, where "Unknown"
        /// reads as a diagnosis.
        /// </internal>
        /// </summary>
        /// <param name="standing">The standing to describe.</param>
        /// <returns>The reason text, or an empty string.</returns>
        public static string UnavailableReason(CrewStanding standing)
        {
            switch (standing)
            {
                case CrewStanding.Available:
                case CrewStanding.Applicant:
                case CrewStanding.Unknown:
                    return "";
                case CrewStanding.Assigned: return "On mission";
                case CrewStanding.Training: return "In training";
                case CrewStanding.Resting: return "Standing down";
                default: return standing.ToString();
            }
        }

        /// <summary>
        /// The stock reading over EVERY axis KSP itself exposes: the roster
        /// status, applicant-hood, and the stand-down flag. Where
        /// <see cref="FromRosterStatus"/> says what an ordinal means, this says
        /// what stock makes of the whole kerbal.
        ///
        /// <para><c>inactive</c> only turns <see cref="CrewStanding.Available"/>
        /// into <see cref="CrewStanding.Resting"/>. A kerbal crewing a vessel is
        /// <see cref="CrewStanding.Assigned"/> whatever the flag says, because
        /// they are on a mission and stock leaves the flag set from the last rest
        /// period.</para>
        /// </summary>
        /// <param name="query">What the capture read about the kerbal.</param>
        /// <returns>The stock standing.</returns>
        public static CrewStanding FromQuery(CrewStandingQuery query)
        {
            var standing = FromRosterStatus(query.RosterStatusOrdinal, query.IsApplicant);
            return standing == CrewStanding.Available && query.Inactive
                ? CrewStanding.Resting
                : standing;
        }

        /// <summary>
        /// The whole derivation, in ONE place: a backend's reading folded onto
        /// the stock standing, and <c>available</c>, <c>unavailableReason</c> and
        /// the scheduled times derived from the result.
        ///
        /// <para>Every field a backend leaves null falls back to the stock
        /// derivation, so a backend that corrects one kerbal's standing gets
        /// correct availability and wording without restating them. The
        /// stand-down's end is quoted only while the kerbal is actually
        /// resting.</para>
        /// <internal>
        /// In the contract so the capture and the space-centre view provider
        /// cannot each derive half of it: split across two assemblies, neither
        /// half consulted the stand-down flag.
        /// </internal>
        /// </summary>
        /// <param name="query">What the capture read about the kerbal.</param>
        /// <param name="reading">The elected backend's reading, or null when it declined.</param>
        /// <param name="providerId">The elected backend's provider id, credited as the source when its reading supplies the standing.</param>
        /// <returns>The resolved standing, source, availability, reason and times.</returns>
        public static CrewStandingResolution Resolve(
            CrewStandingQuery query,
            CrewStandingReading? reading,
            string? providerId)
        {
            var standing = reading?.Standing ?? FromQuery(query);

            // The stand-down's end is stock's own answer and is quoted only while
            // the stand-down is live: KSP leaves the field at whatever the last
            // rest period set, so a kerbal back on duty would be dated to a rest
            // already over.
            var stockEndsAt = standing == CrewStanding.Resting && query.Inactive
                ? query.InactiveUntilUt
                : null;

            return new CrewStandingResolution
            {
                Standing = standing,
                // The stock map is core's own, not the elected backend's, so a
                // backend that declined is not credited with the answer it
                // declined to give.
                Source = reading?.Standing == null ? StockSource : providerId,
                Available = reading?.Available ?? CanFly(standing),
                UnavailableReason = reading?.UnavailableReason ?? UnavailableReason(standing),
                StandingEndsAtUt = reading?.StandingEndsAtUt ?? stockEndsAt,
                RetiresAtUt = reading?.RetiresAtUt,
            };
        }

        /// <summary>
        /// KSP's roster status as a <see cref="CrewStanding"/>. An applicant
        /// maps to <see cref="CrewStanding.Applicant"/> without consulting the
        /// ordinal at all, because an applicant has none; an unreadable or
        /// unrecognised ordinal maps to <see cref="CrewStanding.Unknown"/> rather
        /// than the friendliest guess.
        /// </summary>
        /// <param name="rosterStatusOrdinal">KSP's <c>(int)ProtoCrewMember.RosterStatus</c>, or null when none was read.</param>
        /// <param name="isApplicant">Whether the kerbal is a hireable candidate rather than owned crew.</param>
        /// <returns>The stock standing for that status.</returns>
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
    /// One backend's reading of a single kerbal's standing: what
    /// <see cref="ICrewStandingBackend.Read"/> returns. Plain data with no KSP
    /// types, so a backend can be exercised headless.
    ///
    /// <para>Not a wire type. Every member is nullable, and null means this
    /// backend does not model that field, so the stock derivation stands for
    /// it.</para>
    /// </summary>
    /// <category>Uplink API</category>
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

        /// <summary>
        /// When the CURRENT standing lapses, as universal time: a course's ETA
        /// for <see cref="CrewStanding.Training"/>, the rest period's end for
        /// <see cref="CrewStanding.Resting"/>. Null when the standing has no
        /// scheduled end, which is most of them.
        ///
        /// <para>A <c>ut</c> value and never a formatted date, for the reason
        /// <see cref="CrewStandings.UnavailableReason"/> gives.</para>
        /// </summary>
        public double? StandingEndsAtUt { get; set; }

        /// <summary>
        /// When this kerbal is scheduled to become
        /// <see cref="CrewStanding.Retired"/>, as universal time. Null under any
        /// backend that does not schedule retirements, which includes stock.
        ///
        /// <para>A SEPARATE field from <see cref="StandingEndsAtUt"/> rather than
        /// a reuse of it, because the two are live at the same time and mean
        /// different things: a kerbal is Available or Assigned or Training for
        /// years while a retirement date sits in the future. Folded together, an
        /// operator planning a mission around a crew's remaining career would
        /// read a course ETA as the end of it.</para>
        ///
        /// <para>Absent rather than zero when a backend holds no date. A career
        /// overhaul's own getter commonly returns 0 for "no record", and 0 is a
        /// date: it would retire the whole roster at the epoch.</para>
        /// </summary>
        public double? RetiresAtUt { get; set; }
    }

    /// <summary>
    /// Everything a backend is handed about one kerbal, and everything the stock
    /// derivation needs. A struct rather than a parameter list, so a field added
    /// later does not break a backend's signature: an author who ignores a field
    /// they have never heard of keeps compiling.
    ///
    /// <para>Nothing here is a KSP type: the capture reads the game objects and
    /// hands over primitives.</para>
    /// </summary>
    /// <category>Uplink API</category>
    public struct CrewStandingQuery
    {
        /// <summary>
        /// The kerbal's <c>ProtoCrewMember.name</c>, which is the id every
        /// career-overhaul mod on record keys its own crew bookkeeping by.
        /// </summary>
        public string KerbalName { get; set; }

        /// <summary>
        /// KSP's own <c>(int)ProtoCrewMember.RosterStatus</c>, or null for an
        /// applicant (who has none) and when the capture could not read one.
        /// Handed over rather than read because the value is not in dispute,
        /// only what it means.
        /// </summary>
        public int? RosterStatusOrdinal { get; set; }

        /// <summary>
        /// Whether this entry is a hireable candidate rather than owned crew. A
        /// backend that models applicant retirement needs to know which it is
        /// looking at.
        /// </summary>
        public bool IsApplicant { get; set; }

        /// <summary>
        /// KSP's <c>ProtoCrewMember.inactive</c>: the kerbal is standing down
        /// rather than on duty. The axis behind
        /// <see cref="CrewStanding.Resting"/>.
        /// </summary>
        public bool Inactive { get; set; }

        /// <summary>
        /// KSP's <c>ProtoCrewMember.inactiveTimeEnd</c>, as universal time.
        /// Meaningless unless <see cref="Inactive"/> is set: KSP leaves it at
        /// whatever the last rest period wrote.
        /// </summary>
        public double? InactiveUntilUt { get; set; }

        /// <summary>
        /// Universal time at the moment of the capture, in seconds. Carried because
        /// a backend's reading can be a DEADLINE, and a deadline derived from a
        /// remaining amount over a rate needs the now it is measured from. A
        /// backend must not read the clock itself: the capture's own UT is what
        /// every other field on this tick was read against.
        /// </summary>
        public double Ut { get; set; }
    }

    /// <summary>
    /// The derivation's whole result for one kerbal: what
    /// <see cref="CrewStandings.Resolve"/> returns and what the capture stamps
    /// onto the published crew entry.
    /// </summary>
    /// <category>Uplink API</category>
    public struct CrewStandingResolution
    {
        /// <summary>The standing itself: the field a client branches on.</summary>
        public CrewStanding Standing { get; set; }

        /// <summary>
        /// Which provider decided <see cref="Standing"/>, or
        /// <see cref="CrewStandings.StockSource"/> when it is the stock map.
        /// </summary>
        public string? Source { get; set; }

        /// <summary>Whether the kerbal can be assigned to a flight today.</summary>
        public bool Available { get; set; }

        /// <summary>Why not, in prose with no date. Empty string when they can.</summary>
        public string UnavailableReason { get; set; }

        /// <summary>When the current standing lapses, as universal time in seconds, or null.</summary>
        public double? StandingEndsAtUt { get; set; }

        /// <summary>When the kerbal is scheduled to retire, as universal time in seconds, or null.</summary>
        public double? RetiresAtUt { get; set; }
    }

    /// <summary>
    /// The exclusive capability id every crew-standing backend competes for,
    /// declared in the contract so a backend and the core registrar spell it
    /// from one constant.
    /// </summary>
    /// <category>Uplink API</category>
    public static class CrewStandingCapability
    {
        /// <summary>The capability id, <c>"crewStanding"</c>.</summary>
        public const string Id = "crewStanding";
    }

    /// <summary>
    /// The active instance of the exclusive <c>"crewStanding"</c> capability:
    /// what this install makes of a kerbal whose roster status alone does not
    /// say their standing.
    /// </summary>
    /// <category>Uplink API</category>
    public interface ICrewStandingBackend : ISitrepProvider
    {
        /// <summary>
        /// Read one kerbal's standing.
        /// </summary>
        /// <param name="query">
        /// Everything the capture read about this kerbal, including the axes a
        /// backend cannot reach for itself. See <see cref="CrewStandingQuery"/>.
        /// </param>
        /// <returns>
        /// The reading, or null when this backend has nothing to add for this
        /// kerbal. Null is the common result and is not a failure: every field
        /// left null falls back to the stock derivation.
        /// </returns>
        CrewStandingReading? Read(CrewStandingQuery query);
    }
}
