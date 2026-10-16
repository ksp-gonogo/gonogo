using System;
using Gonogo.KSP.CommandCentres;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP.CurrencyDelay
{
    // This file references Vessel and CommNet types that only resolve against
    // the real KSP/Unity reference DLLs, so it compiles wherever KspManaged is
    // configured. The routed-or-unroutable decision it wraps lives in
    // KscLightTimeMath.cs, which has no such dependency and is unit-tested on
    // every checkout.

    /// <summary>
    /// KSC-anchored one-way signal delay for a currency-earning event:
    /// earn-location -&gt; KSC, always, regardless of any command-centre
    /// vantage (the currency-delay design's deliberate simplification,
    /// distinct from CommandCentreDelayUplink's per-vantage authority
    /// matrix). The delay is FleetCommsReader's reading of the live vessel's
    /// control path; a vessel that is not live, or has no path, is unroutable.
    /// </summary>
    public static class KscLightTime
    {
        /// <summary>
        /// The routed one-way signal delay from a live vessel to KSC, or
        /// <see cref="KscDelay.Unroutable"/> when no control path reaches
        /// home. <see cref="KscDelay.Instant"/> when the delay feature is off.
        ///
        /// <para>There is no proto-vessel counterpart any more. A ProtoVessel
        /// has no live CommNet connection, so the only thing that function
        /// could ever do was measure a straight line, the exact fallback this
        /// subsystem now refuses. Its one real caller was vessel recovery,
        /// which is not an away event at all: <c>Vessel.IsRecoverable</c> is
        /// <c>LandedOrSplashed &amp;&amp; mainBody.isHomeWorld</c>, so a
        /// recovered craft is physically in KSC's hands and its funds are not
        /// in flight anywhere.</para>
        /// </summary>
        public static KscDelay ForVessel(Vessel vessel, SignalDelayConfig? config)
        {
            if (vessel == null)
            {
                return KscDelay.Unroutable;
            }

            try
            {
                var (routedOneWay, _) = FleetCommsReader.ReadVessel(vessel, config);
                return KscLightTimeMath.Resolve(routedOneWay, config);
            }
            catch (Exception ex)
            {
                // Fail toward silence: a route read that threw is not evidence
                // of a reachable craft, so the event blocks rather than
                // revealing on a fabricated zero.
                GonogoLog.WarnLimited("KscLightTime.ForVessel failed (treating as unroutable)", ex);
                return KscDelay.Unroutable;
            }
        }

        /// <summary>
        /// How many seconds lie between the home command's ledger and a vessel, in
        /// either direction: what a currency award from the vessel waits before it is
        /// booked, and what a change to the ledger waits before the vessel learns it.
        /// One definition for both legs of that round trip, so a transmission and the
        /// new total coming back can never be timed by two different numbers.
        ///
        /// <para>The silence-declaration deadline for a vessel with no route home, and
        /// zero with signal delay switched off, both by <see cref="KscDelayPolicy"/>.</para>
        /// </summary>
        internal static double SecondsToHome(string vesselId, SignalDelayConfig? config) =>
            KscDelayPolicy.DelaySeconds(ForVesselId(vesselId, config), config);

        /// <summary>As <see cref="SecondsToHome"/> for a science credit: null for one held until home hears from its craft. See <see cref="KscDelayPolicy.ScienceDelaySeconds"/>.</summary>
        internal static double? ScienceSecondsToHome(string vesselId, SignalDelayConfig? config) =>
            KscDelayPolicy.ScienceDelaySeconds(ForVesselId(vesselId, config), config);

        /// <summary>
        /// The routed one-way signal delay for a vessel named only by its id, found
        /// among the vessels the game currently holds.
        ///
        /// <para>This is how an away currency event resolves an origin it was
        /// handed no live handle for, which is most of them: a science
        /// transmission arrives with a ProtoVessel, and a ProtoVessel has no
        /// CommNet connection to read. Its live counterpart does, and is in the
        /// roster whether it is loaded or on rails, so the id is enough. Only an
        /// origin nothing in the roster carries is
        /// <see cref="KscDelay.Unroutable"/>.</para>
        /// </summary>
        internal static KscDelay ForVesselId(string vesselId, SignalDelayConfig? config)
        {
            try
            {
                return LiveOriginDelay.Resolve(
                    vesselId,
                    FlightGlobals.Vessels,
                    // The Unity equality overload, deliberately: a destroyed vessel
                    // still in the list answers null here rather than throwing on
                    // its torn-down id.
                    vessel => vessel != null ? vessel.id.ToString() : null,
                    vessel => ForVessel(vessel, config));
            }
            catch (Exception ex)
            {
                // Fail toward silence, same as ForVessel above: a roster read that
                // threw is not evidence of a reachable craft.
                GonogoLog.WarnLimited("KscLightTime.ForVesselId failed (treating as unroutable)", ex);
                return KscDelay.Unroutable;
            }
        }
    }
}
