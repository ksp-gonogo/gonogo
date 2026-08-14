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
        /// One-way seconds from a live vessel to KSC. Prefers the routed
        /// (CommNet ControlPath) light-time; falls back to straight-line
        /// from the vessel's world position when no routed path exists.
        /// Zero when the delay feature is disabled or the vessel is at/near
        /// KSC; null when neither a routed nor straight-line delay is
        /// computable (no KSC home node yet, or LightSpeedScale &lt;= 0).
        /// </summary>
        public static double? ForVessel(Vessel vessel, SignalDelayConfig? config)
        {
            if (vessel == null)
            {
                return null;
            }

            try
            {
                var (routedOneWay, _) = FleetCommsReader.ReadVessel(vessel, config);
                var subject = ToDelayPosition(vessel.GetWorldPos3D());
                var ksc = ReadKscPosition();
                return KscLightTimeMath.Resolve(routedOneWay, subject, ksc, config);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] KscLightTime.ForVessel failed (treating as no delay): " + ex.Message);
                return null;
            }
        }

        /// <summary>
        /// One-way seconds from a ProtoVessel's saved body/orbit (or landed
        /// lat/lon/alt) to KSC. Used when the vessel is not live (unloaded /
        /// off-rails, e.g. an aggregator flush or a reveal replay running
        /// against saved state). Straight-line only - a proto has no live
        /// CommNet connection to route through. Zero when the delay feature
        /// is disabled or the proto is at/near KSC; null when the position
        /// or KSC itself can't be resolved, or LightSpeedScale &lt;= 0.
        /// </summary>
        public static double? ForProtoVessel(ProtoVessel protoVessel, SignalDelayConfig? config)
        {
            if (protoVessel == null)
            {
                return null;
            }

            try
            {
                var subject = ResolveProtoPosition(protoVessel);
                var ksc = ReadKscPosition();
                return KscLightTimeMath.Resolve(null, subject, ksc, config);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] KscLightTime.ForProtoVessel failed (treating as no delay): " + ex.Message);
                return null;
            }
        }

        private static DelayPosition? ResolveProtoPosition(ProtoVessel protoVessel)
        {
            var bodyIndex = protoVessel.orbitSnapShot?.ReferenceBodyIndex;
            if (!bodyIndex.HasValue || FlightGlobals.Bodies == null
                || bodyIndex.Value < 0 || bodyIndex.Value >= FlightGlobals.Bodies.Count)
            {
                return null;
            }

            var body = FlightGlobals.Bodies[bodyIndex.Value];
            if (body == null)
            {
                return null;
            }

            if (protoVessel.landed || protoVessel.splashed)
            {
                return ToDelayPosition(body.GetWorldSurfacePosition(
                    protoVessel.latitude, protoVessel.longitude, protoVessel.altitude));
            }

            // getPositionAtUT already returns an absolute world position (not
            // body-relative) - see KspHost.PredictImpact's identical usage,
            // which feeds it straight into CelestialBody.GetAltitude/
            // GetLatitude/GetLongitude, all of which expect world space.
            var orbit = protoVessel.orbitSnapShot?.Load();
            if (orbit == null)
            {
                return null;
            }
            return ToDelayPosition(orbit.getPositionAtUT(Planetarium.GetUniversalTime()));
        }

        /// <summary>
        /// The KSC ground-station position, reusing StockHomeNodeSource (the
        /// same enumerator CommandCentreDelayUplink's roster uses) rather
        /// than re-deriving CommNetHome access. Null very early in a scene
        /// load, before any home node exists.
        /// </summary>
        private static DelayPosition? ReadKscPosition()
        {
            foreach (var centre in new StockHomeNodeSource().Enumerate())
            {
                if (centre.Id == "ksc" && centre is KspCommandCentre ksp)
                {
                    return ToDelayPosition(ksp.Position);
                }
            }
            return null;
        }

        private static DelayPosition ToDelayPosition(Vector3d v) => new DelayPosition(v.x, v.y, v.z);
    }
}
