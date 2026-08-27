using System;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// RP-1's answer to whether a kerbal off the flight roster is dead: offered to
    /// the exclusive <c>"crewStanding"</c> capability.
    ///
    /// <para><b>The defect this exists for.</b> RP-1 retires a kerbal by writing
    /// <c>rosterStatus = (RosterStatus)2</c>, which is stock's <c>Dead</c>, and
    /// remembers the name in a private set on its own CrewHandler. So a living
    /// retiree reached the wire indistinguishable from a fatality, and gonogo told
    /// operators their astronauts had been killed. The correction cannot be a
    /// widget's job: a widget that has never heard of RP-1 would keep reporting the
    /// fatality, and the default of a client-side join is the wrong answer,
    /// silently. It goes on the wire instead, before any consumer sees the
    /// roster.</para>
    ///
    /// <para><b>What it answers, and what it declines.</b> Three facts, all of
    /// them ones RP-1 owns and core cannot reach: a retiree is
    /// <see cref="CrewStanding.Retired"/> rather than dead, a kerbal on a started
    /// course is <see cref="CrewStanding.Training"/> until its ETA, and a career
    /// has a retirement DATE. Everything else it declines by returning null, so
    /// core's own derivation stands. Answering for the whole roster would mean
    /// copying core's map into this assembly, and a mod's copy of core's map is a
    /// copy that drifts.</para>
    ///
    /// <para><b>Retirement outranks training</b>, which matters because RP-1 can
    /// hold both for one name. A retiree is off the books; a course they are
    /// enrolled on is a course nobody will finish.</para>
    ///
    /// <para><b>R&amp;R is core's answer, not this one.</b> RP-1's post-flight rest
    /// sets KSP's own <c>ProtoCrewMember.inactive</c>, and the stock backend reads
    /// that field into <see cref="CrewStanding.Resting"/>. Correcting it here
    /// would be a second derivation of a value core already has, which is the
    /// mistake this whole capability exists to undo.</para>
    ///
    /// <para>It never claims anything for a kerbal RP-1 is not managing: an absent
    /// handler answers an empty retiree set and no dates, so a stock save, the
    /// main menu and a save RP-1 does not manage all read exactly as they did
    /// before this class existed.</para>
    ///
    /// <para><b>Read live, never cached from a capture.</b> The roster is built by
    /// core's space-centre capture, which runs whether or not anything of ours is
    /// subscribed, while this Uplink's own crew capture is subscription-gated.
    /// Answering from state that capture stashed would starve the correction on
    /// every dashboard not watching an <c>rp1.*</c> topic: the exact
    /// gated-capture starvation shape that has already shipped three times here,
    /// and the reason <see cref="Rp1CrewReflection.IsRetired"/> is its own read.</para>
    /// </summary>
    public sealed class Rp1CrewStandingBackend : ICrewStandingBackend
    {
        private readonly Rp1CrewReflection _crew;

        public Rp1CrewStandingBackend(Rp1CrewReflection crew)
        {
            _crew = crew;
        }

        public string ProviderId => "rp1";

        /// <summary>Whether RP-1's crew handler type resolved, for the health facts.</summary>
        public bool IsAvailable => _crew.IsAvailable;

        public CrewStandingReading? Read(CrewStandingQuery query)
        {
            if (string.IsNullOrEmpty(query.KerbalName))
            {
                return null;
            }

            try
            {
                // A kerbal stock already reads as dead or missing, and who is not
                // one of RP-1's retirees, is a genuine casualty: RP-1 keeps their
                // row in its dictionaries regardless, and a retirement date beside
                // a fatality is a schedule for a career that ended.
                var offTheBooks = CrewStandings.FromQuery(query) == CrewStanding.Dead
                    || CrewStandings.FromQuery(query) == CrewStanding.Missing;

                if (_crew.IsRetired(query.KerbalName))
                {
                    // No RetiresAtUt beside it: the date has passed, and quoting a
                    // schedule for a career that has already ended reads as one
                    // still to come.
                    return new CrewStandingReading { Standing = CrewStanding.Retired };
                }

                if (offTheBooks)
                {
                    return null;
                }

                var facts = _crew.StandingFacts(query.KerbalName, query.Ut);

                if (facts.TrainingStarted)
                {
                    return new CrewStandingReading
                    {
                        Standing = CrewStanding.Training,
                        // Null when RP-1 has not rated the course's build rate,
                        // which is the state a freshly queued course sits in for a
                        // tick. Its own helper answers an infinity there, and an
                        // infinity is not a date.
                        StandingEndsAtUt = facts.TrainingFinishesAtUt,
                        RetiresAtUt = facts.RetiresAtUt,
                    };
                }

                // No standing to correct, but a date to add. The standing stays
                // null so core's derivation decides it, which is how a kerbal
                // standing down still reads Resting from the stock backend while
                // carrying RP-1's retirement date.
                return facts.RetiresAtUt == null
                    ? null
                    : new CrewStandingReading { RetiresAtUt = facts.RetiresAtUt };
            }
            catch (Exception)
            {
                // fail-soft: an unreadable retiree set leaves the stock reading
                // standing, which is the state that existed before this backend
                return null;
            }
        }
    }
}
