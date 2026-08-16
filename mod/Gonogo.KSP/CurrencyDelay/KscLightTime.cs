using System;
using Gonogo.KSP.CommandCentres;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP.CurrencyDelay
{
    // This file references Vessel/ProtoVessel/CelestialBody/CommNet types
    // that only resolve against the real KSP/Unity reference DLLs, so a
    // worktree without KspManaged configured cannot compile it standalone;
    // it builds as part of Gonogo.KSP.csproj wherever those DLLs are
    // available. Member usage (Vessel.GetWorldPos3D,
    // ProtoVessel.orbitSnapShot/landed/splashed/latitude/longitude/altitude,
    // OrbitSnapshot.Load/ReferenceBodyIndex, Orbit.getPositionAtUT,
    // CelestialBody.GetWorldSurfacePosition) is decompile-confirmed against
    // Assembly-CSharp.dll and mirrors KspHost.cs's own
    // orbit.getPositionAtUT(ut) usage. The pure distance/light-speed math +
    // routed-vs-straight-line decision this wraps lives in
    // KscLightTimeMath.cs, which has no such dependency and is unit-tested
    // unconditionally.

    /// <summary>
    /// KSC-anchored one-way light-time for a currency-earning event:
    /// earn-location -&gt; KSC, always, regardless of any command-centre
    /// vantage (the currency-delay design's deliberate simplification,
    /// distinct from CommandCentreDelayUplink's per-vantage authority
    /// matrix). Reuses FleetCommsReader for the routed vessel&lt;-&gt;KSC
    /// light-time when a vessel is live, and StockHomeNodeSource for the KSC
    /// position on the straight-line fallback - the same two building blocks
    /// CommandCentreDelayUplink.RouteDelay already composes for its own
    /// (ksc, subject) row.
    /// </summary>
    public static class KscLightTime
    {
        /// <summary>
        /// The routed one-way light-time from a live vessel to KSC, or
        /// <see cref="KscDelay.Unroutable"/> when no control path reaches
        /// home. <see cref="KscDelay.Instant"/> when the delay feature is off.
        ///
        /// <para>There is no proto-vessel counterpart any more. A ProtoVessel
        /// has no live CommNet connection, so the only thing that function
        /// could ever do was measure a straight line — the exact fallback this
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
                Debug.LogWarning("[Gonogo] KscLightTime.ForVessel failed (treating as unroutable): " + ex.Message);
                return KscDelay.Unroutable;
            }
        }

    }
}
