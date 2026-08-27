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
    ///
    /// <para><b>The numbering IS the reading order</b>, and members are inserted
    /// rather than appended for that reason. The SDK's
    /// <c>CREW_STANDING_ORDER</c> sorts by value so a crew surface reads free to
    /// fly, then committed, then off the books, and derives that from the enum so
    /// nobody has to maintain a second list. Appending <see cref="Training"/>
    /// would have filed it after <see cref="Dead"/>.</para>
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
        /// On the books, committed to a training course, and not assignable
        /// until it finishes. <see cref="CrewStandingReading.StandingEndsAtUt"/>
        /// carries the course's own ETA.
        ///
        /// <para>Reachable only through a backend that models training. Stock has
        /// no courses, so a stock install never reports it, and KSP's roster
        /// status for a kerbal mid-course is <c>Available</c>: the same shape as
        /// the retiree, where the game field is not the answer.</para>
        /// </summary>
        Training = 4,

        /// <summary>
        /// On the books, standing down after a flight, and not assignable until
        /// the rest period ends.
        /// <see cref="CrewStandingReading.StandingEndsAtUt"/> carries its end.
        ///
        /// <para>Derived from KSP's own <c>ProtoCrewMember.inactive</c>, so the
        /// stock backend answers it and every install gets it. Stock rarely sets
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

        /// <summary>Missing: KSP's own separate answer, kept separate.</summary>
        Missing = 8,
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
        /// What <c>standingSource</c> reads when the answer is the stock map:
        /// either no backend was reachable, or the elected one declined for this
        /// kerbal. One spelling, because a client that groups by source needs the
        /// two halves of "nobody corrected this" to agree.
        /// </summary>
        public const string StockSource = "stock";

        /// <summary>
        /// Whether a standing means the kerbal can be assigned to a flight
        /// today, and the single definition of it.
        /// </summary>
        /// <remarks>
        /// A WHITELIST, deliberately, and the reason is the failure this whole
        /// file exists for. Stated as a blocklist, every standing added later is
        /// flyable until somebody remembers to add it, and the standing most
        /// likely to be added is another way of being committed: a course, a
        /// medical, a quarantine. Stated as a whitelist, a new member is
        /// unavailable until somebody writes down that it is not, which is the
        /// direction that fails safely and needs no edit here.
        ///
        /// <para>An applicant counts as free: nothing blocks hiring one, and the
        /// hire surface reads this field.</para>
        /// </remarks>
        public static bool CanFly(CrewStanding standing) =>
            standing == CrewStanding.Available || standing == CrewStanding.Applicant;

        /// <summary>
        /// The human reason a kerbal cannot fly, in this contract's own words.
        /// Empty string when they can.
        /// </summary>
        /// <remarks>
        /// PROSE ONLY, carrying no date. The when rides
        /// <see cref="CrewStandingResolution.StandingEndsAtUt"/> as a <c>ut</c>
        /// value instead, because a date formatted here would be formatted in the
        /// mod's idea of a calendar: an RSS save counts years differently from a
        /// stock one, and the client owns that model. A string with a date baked
        /// into it is the one field on the payload a client cannot re-render.
        ///
        /// <para><see cref="CrewStanding.Unknown"/> answers empty rather than the
        /// word "Unknown". This string sits in a tooltip beside a disabled
        /// control, where "Unknown" reads as a diagnosis; a standing nobody could
        /// read is a standing this field has nothing to say about.</para>
        /// </remarks>
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
        /// KSP's roster status as a <see cref="CrewStanding"/>. An applicant
        /// answers <see cref="CrewStanding.Applicant"/> without consulting the
        /// ordinal at all, because an applicant has none; an unreadable or
        /// unrecognised ordinal answers <see cref="CrewStanding.Unknown"/> rather
        /// than the friendliest guess.
        /// </summary>
        /// <summary>
        /// The stock reading over EVERY axis KSP itself exposes: the roster
        /// status, applicant-hood, and the stand-down flag.
        /// </summary>
        /// <remarks>
        /// Separate from <see cref="FromRosterStatus"/> rather than folded into
        /// it because the two answer different questions and both callers exist.
        /// This one is "what does stock make of this kerbal"; that one is "what
        /// does this ordinal mean", which is what a mod backend wants when it
        /// corrects one kerbal and needs the default for the rest.
        ///
        /// <para><c>inactive</c> only reaches <see cref="CrewStanding.Resting"/>
        /// from <see cref="CrewStanding.Available"/>. A kerbal crewing a vessel
        /// is <see cref="CrewStanding.Assigned"/> whatever the flag says: they
        /// are on a mission, which is the more specific and more useful answer,
        /// and stock leaves the flag set from the last rest period.</para>
        /// </remarks>
        public static CrewStanding FromQuery(CrewStandingQuery query)
        {
            var standing = FromRosterStatus(query.RosterStatusOrdinal, query.IsApplicant);
            return standing == CrewStanding.Available && query.Inactive
                ? CrewStanding.Resting
                : standing;
        }

        /// <summary>
        /// The whole derivation, in ONE place: a backend's reading folded onto
        /// the stock answer, and <c>available</c> / <c>unavailableReason</c> /
        /// the scheduled whens derived from the result.
        /// </summary>
        /// <remarks>
        /// It lives here, in the contract, because the alternative already
        /// failed. The capture stamped a standing and the space-centre view
        /// provider derived availability from it, in two assemblies, and neither
        /// half ever consulted the stand-down flag: a kerbal resting after a
        /// flight reached the wire <c>available: true</c> with an empty reason,
        /// for the same reason a retiree had reached it as a fatality. A
        /// derivation split across two files is a derivation with axes nobody
        /// owns.
        ///
        /// <para>Every field a backend leaves null falls back to the stock
        /// answer, so a backend that corrects one kerbal's standing gets correct
        /// availability and wording for free and never restates them.</para>
        /// </remarks>
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
        /// overhaul's own getter commonly answers 0 for "no record", and 0 is a
        /// date: it would retire the whole roster at the epoch.</para>
        /// </summary>
        public double? RetiresAtUt { get; set; }
    }

    /// <summary>
    /// Everything a backend is handed about one kerbal, and everything the stock
    /// derivation needs: one struct rather than a parameter list.
    /// </summary>
    /// <remarks>
    /// A struct because the list was three parameters and is now six, and every
    /// future axis would break every third-party backend's signature. An author
    /// who ignores a field they have never heard of keeps compiling.
    ///
    /// <para>Nothing here is a KSP type. This assembly has none and must not
    /// acquire any, so the capture reads the game objects and hands over
    /// primitives, the same split every other capability in this contract
    /// uses.</para>
    /// </remarks>
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
        /// Handed over rather than read for the reason
        /// <see cref="IEconomyBackend"/> is handed the reputation: the value is
        /// not in dispute, only what it means.
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
        /// <see cref="CrewStanding.Resting"/>, and the one the derivation used to
        /// publish without consulting.
        /// </summary>
        public bool Inactive { get; set; }

        /// <summary>
        /// KSP's <c>ProtoCrewMember.inactiveTimeEnd</c>, as universal time.
        /// Meaningless unless <see cref="Inactive"/> is set: KSP leaves it at
        /// whatever the last rest period wrote.
        /// </summary>
        public double? InactiveUntilUt { get; set; }

        /// <summary>
        /// Universal time at the moment of the capture. Carried because a
        /// backend's answer can be a DEADLINE, and a deadline derived from a
        /// remaining amount over a rate needs the now it is measured from. A
        /// backend must not read the clock itself: the capture's own UT is what
        /// every other field on this tick was read against.
        /// </summary>
        public double Ut { get; set; }
    }

    /// <summary>
    /// The derivation's whole answer for one kerbal: what
    /// <see cref="CrewStandings.Resolve"/> returns and what the capture stamps.
    /// </summary>
    /// <remarks>
    /// A type rather than a tuple because six of these travel together from the
    /// capture through to the wire, and a positional tuple crossing an assembly
    /// boundary is a rename waiting to silently swap two fields.
    /// </remarks>
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

        /// <summary>When the current standing lapses, or null.</summary>
        public double? StandingEndsAtUt { get; set; }

        /// <summary>When the kerbal is scheduled to retire, or null.</summary>
        public double? RetiresAtUt { get; set; }
    }

    /// <summary>
    /// The exclusive capability id every crew-standing backend competes for,
    /// declared HERE rather than beside the election.
    /// </summary>
    /// <remarks>
    /// An id both halves must spell identically belongs where both halves can
    /// reach it. <c>ActionGroupsElection.CapabilityId</c> is the counter-example:
    /// it lives in the unpublished <c>Sitrep.Host</c>, so the AGX uplink has to
    /// re-declare <c>"actionGroups"</c> as a constant of its own and a test pins
    /// the two equal. A test that pins two constants together is a test that
    /// exists because there should only have been one.
    /// </remarks>
    public static class CrewStandingCapability
    {
        /// <summary>The capability id. One declaration, reachable from an Uplink.</summary>
        public const string Id = "crewStanding";
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
        /// <param name="query">
        /// Everything the capture read about this kerbal, including the axes a
        /// backend cannot reach for itself. See <see cref="CrewStandingQuery"/>.
        /// </param>
        /// <returns>
        /// The reading, or null when this backend has nothing to add for this
        /// kerbal. Null is the common answer and is not a failure: every field
        /// left null falls back to the stock derivation.
        /// </returns>
        CrewStandingReading? Read(CrewStandingQuery query);
    }
}
