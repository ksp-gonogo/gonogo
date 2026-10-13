using System;
using System.Collections.Generic;
using Gonogo.KSP.CommandCentres;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;

namespace Gonogo.KSP
{
    /// <summary>
    /// The straight-line signal delay from every object the game knows the
    /// orbit of to every command centre that can see it, keyed
    /// <c>vessel:&lt;id&gt;</c> then by centre id. A centre cannot see an object
    /// when a body lies between them, a body being a sphere of its occluding
    /// radius; nothing else blocks the line, terrain and distance included. In
    /// a save with no comms model nothing blocks it at all: such a save models
    /// no occlusion and no blackout, so every centre sees every object. A
    /// centre with no line to an object has no entry in its row. The home
    /// centre sees through every ground station, so its delay is the shortest
    /// of theirs that can see the object.
    /// </summary>
    internal static class SightLines
    {
        /// <param name="vessels">Every object in the game.</param>
        /// <param name="positionOf">An object's world position at the capture instant.</param>
        /// <param name="centres">The centres that look; only placed centres have eyes.</param>
        /// <param name="roster">The roster, which says which centre is home.</param>
        /// <param name="config">The signal delay switch and light-speed scale; every delay is zero with it off. Whether the save models comms at all comes from <see cref="SignalDelayConfig.CutForNoCommsModel"/>.</param>
        /// <param name="bodies">Every body that can come between, where it is at the capture instant and its occluding radius.</param>
        internal static Dictionary<string, IReadOnlyDictionary<string, double>> Table(
            IEnumerable<Vessel> vessels,
            Func<Vessel, Vector3d> positionOf,
            IReadOnlyList<ICommandCentre> centres,
            IReadOnlyList<CommandCentreEntry> roster,
            SignalDelayConfig config,
            IReadOnlyList<SightBody> bodies) =>
            Rows(Placed(vessels, positionOf), centres, roster, config, bodies);

        /// <summary>
        /// The same table for objects already placed, keyed by the key each
        /// carries: every one gets a row, empty where no centre can see it.
        /// </summary>
        internal static Dictionary<string, IReadOnlyDictionary<string, double>> Rows(
            IEnumerable<(string Key, Vector3d At)> objects,
            IReadOnlyList<ICommandCentre> centres,
            IReadOnlyList<CommandCentreEntry> roster,
            SignalDelayConfig config,
            IReadOnlyList<SightBody> bodies)
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
            var homeLooks = home != null && eyes.Exists(eye => eye.Id == home);
            var occluders = config.CutForNoCommsModel ? Array.Empty<SightBody>() : bodies;

            var sight = new Dictionary<string, IReadOnlyDictionary<string, double>>(StringComparer.Ordinal);
            foreach (var (key, at) in objects)
            {
                var row = new Dictionary<string, double>(StringComparer.Ordinal);
                var nearestGround = double.PositiveInfinity;
                foreach (var eye in eyes)
                {
                    if (!Clear(eye.Position, at, occluders))
                    {
                        continue;
                    }
                    var seconds = (eye.Position - at).magnitude / PairPlan.SpeedOfLight * factor;
                    row[eye.Id] = seconds;
                    if (eye.Ground)
                    {
                        nearestGround = Math.Min(nearestGround, seconds);
                    }
                }
                if (homeLooks && !double.IsPositiveInfinity(nearestGround))
                {
                    row[home!] = nearestGround;
                }
                sight[key] = row;
            }
            return sight;
        }

        /// <summary>Each object whose orbit the game knows, keyed <c>vessel:&lt;id&gt;</c>, at its position.</summary>
        internal static IEnumerable<(string Key, Vector3d At)> Placed(IEnumerable<Vessel> vessels, Func<Vessel, Vector3d> positionOf)
        {
            foreach (var vessel in vessels)
            {
                if (vessel != null && OrbitKnown(vessel))
                {
                    yield return ("vessel:" + vessel.id, positionOf(vessel));
                }
            }
        }

        /// <summary>Whether no body lies on the straight line between two points.</summary>
        internal static bool Clear(Vector3d from, Vector3d to, IReadOnlyList<SightBody> bodies)
        {
            foreach (var body in bodies)
            {
                if (body.OccludingRadiusMeters > 0.0
                    && ChordOcclusion.HorizonMargin(Frame(from), Frame(to), Frame(body.Centre), body.OccludingRadiusMeters) < 0.0)
                {
                    return false;
                }
            }
            return true;
        }

        private static Sitrep.Contract.Vector3d Frame(Vector3d v) => new Sitrep.Contract.Vector3d(v.x, v.y, v.z);

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

    /// <summary>A body as sight sees it: where it is and the radius inside which it blocks a line.</summary>
    internal readonly struct SightBody
    {
        internal SightBody(Vector3d centre, double occludingRadiusMeters)
        {
            Centre = centre;
            OccludingRadiusMeters = occludingRadiusMeters;
        }

        internal Vector3d Centre { get; }

        internal double OccludingRadiusMeters { get; }
    }
}
