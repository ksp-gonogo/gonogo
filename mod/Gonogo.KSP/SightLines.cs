using System;
using System.Collections.Generic;
using Gonogo.KSP.CommandCentres;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Contacts;

namespace Gonogo.KSP
{
    /// <summary>
    /// The straight-line signal delay from every object the game knows the
    /// orbit of to every command centre, keyed <c>vessel:&lt;id&gt;</c> then by
    /// centre id. The line is the chord between the two positions: nothing
    /// between them, a body included, blocks it. The home centre sees through
    /// every ground station, so its delay is the shortest of theirs.
    /// </summary>
    internal static class SightLines
    {
        /// <param name="vessels">Every object in the game.</param>
        /// <param name="positionOf">An object's world position at the capture instant.</param>
        /// <param name="centres">The centres that look; only placed centres have eyes.</param>
        /// <param name="roster">The roster, which says which centre is home.</param>
        /// <param name="config">The signal delay switch and light-speed scale; every delay is zero with it off.</param>
        internal static Dictionary<string, IReadOnlyDictionary<string, double>> Table(
            IEnumerable<Vessel> vessels,
            Func<Vessel, Vector3d> positionOf,
            IReadOnlyList<ICommandCentre> centres,
            IReadOnlyList<CommandCentreEntry> roster,
            SignalDelayConfig config)
        {
            var factor = config.Enabled && config.LightSpeedScale > 0.0 ? 1.0 / config.LightSpeedScale : 0.0;
            string? home = null;
            foreach (var entry in roster)
            {
                if (entry.IsHome)
                {
                    home = entry.Id;
                }
            }
            var eyes = new List<(string Id, Vector3d Position, bool Ground)>();
            foreach (var centre in centres)
            {
                if (centre is KspCommandCentre placed)
                {
                    eyes.Add((placed.Id, placed.Position, placed.Kind == CommandCentreKind.GroundStation));
                }
            }

            var sight = new Dictionary<string, IReadOnlyDictionary<string, double>>(StringComparer.Ordinal);
            foreach (var vessel in vessels)
            {
                if (vessel == null || !OrbitKnown(vessel))
                {
                    continue;
                }
                var at = positionOf(vessel);
                var row = new Dictionary<string, double>(StringComparer.Ordinal);
                var nearestGround = double.PositiveInfinity;
                foreach (var eye in eyes)
                {
                    var seconds = (eye.Position - at).magnitude / PairPlan.SpeedOfLight * factor;
                    row[eye.Id] = seconds;
                    if (eye.Ground)
                    {
                        nearestGround = Math.Min(nearestGround, seconds);
                    }
                }
                if (home != null && row.ContainsKey(home) && !double.IsPositiveInfinity(nearestGround))
                {
                    row[home] = nearestGround;
                }
                sight["vessel:" + vessel.id] = row;
            }
            return sight;
        }

        /// <summary>Whether the game has state vectors for the vessel, which every craft it made for the player has.</summary>
        internal static bool OrbitKnown(Vessel vessel)
        {
            try
            {
                return vessel.DiscoveryInfo == null || OrbitKnowledge.Known(vessel.DiscoveryInfo.Level);
            }
            catch (Exception)
            {
                return true;
            }
        }
    }
}
