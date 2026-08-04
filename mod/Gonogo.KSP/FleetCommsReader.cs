using System;
using System.Collections.Generic;
using CommNet;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Per-vessel routed comms read (Plan 2): generalizes
    /// <see cref="CommNetBackend.Path"/> from the active vessel to ANY vessel, so
    /// the fleet capture computes each vessel's OWN routed light-time +
    /// connectivity. Stock CommNet maintains a control graph for every vessel
    /// (loaded or not), so <c>vessel.connection.ControlPath</c> / <c>IsConnected</c>
    /// are readable fleet-wide (see the roster comms read in <c>KspHost</c>). The
    /// hop loop is copied verbatim from <see cref="CommNetBackend.Path"/>, only
    /// the vessel source changes from <c>FlightGlobals.ActiveVessel</c> to the
    /// parameter.
    ///
    /// <para>THREADING: reads live KSP state, MAIN-THREAD only (the capture half
    /// of the fleet <c>AddSampledSource</c>).</para>
    /// </summary>
    internal static class FleetCommsReader
    {
        /// <summary>
        /// Routed one-way light-time (null = no measurable path) + connectivity
        /// for a single vessel. Fail-soft: any torn-down-state throw yields
        /// (null, false), the correct "no live link" meaning.
        /// </summary>
        internal static (double? OneWaySeconds, bool Connected) ReadVessel(Vessel vessel, SignalDelayConfig config)
        {
            try
            {
                var conn = vessel != null ? vessel.connection : null;
                if (conn == null)
                {
                    return (null, false);
                }

                var hops = new List<CommsHop>();
                var path = conn.ControlPath;
                if (path != null)
                {
                    foreach (var link in path)
                    {
                        if (link?.a == null || link.b == null)
                        {
                            continue;
                        }
                        hops.Add(new CommsHop
                        {
                            From = string.Empty,
                            To = string.Empty,
                            Kind = link.b.isHome || link.a.isHome ? CommsHopKind.Home : CommsHopKind.Relay,
                            DistanceMeters = (link.a.precisePosition - link.b.precisePosition).magnitude,
                            BandRateBitsPerSec = null,
                        });
                    }
                }

                var commsPath = new CommsPath { Hops = hops };
                var quality = vessel.loaded ? Quality.Loaded : Quality.OnRails;
                var delay = SignalDelay.Compute(config, commsPath, string.Empty, quality);
                return (delay.OneWaySeconds, conn.IsConnected);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] FleetCommsReader.ReadVessel failed (treating as no path): " + ex.Message);
                return (null, false);
            }
        }
    }
}
