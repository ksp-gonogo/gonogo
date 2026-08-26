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
    /// <para><b>What it deliberately does NOT do.</b> It corrects the retirees and
    /// declines for everyone else, returning null so core's own map of KSP's
    /// roster status stands. Answering for the whole roster would mean copying that
    /// map into this assembly, and a mod's copy of core's map is a copy that
    /// drifts. It also never claims a retirement for a kerbal RP-1 is not
    /// managing: an absent handler answers an empty retiree set, so a stock save,
    /// the main menu and a save RP-1 does not manage all read exactly as they did
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

        public CrewStandingReading? Read(string kerbalName, int? rosterStatusOrdinal, bool isApplicant)
        {
            if (string.IsNullOrEmpty(kerbalName))
            {
                return null;
            }

            try
            {
                return _crew.IsRetired(kerbalName)
                    ? new CrewStandingReading { Standing = CrewStanding.Retired }
                    : null;
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
