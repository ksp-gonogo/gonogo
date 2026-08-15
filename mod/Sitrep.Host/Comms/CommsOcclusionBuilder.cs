using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Applies the elected backend's declared occlusion model
    /// (<see cref="ICommsOcclusionModel"/>) to every celestial body the game
    /// knows about, producing the <c>comms.occlusion</c> payload.
    ///
    /// <para>The body list is read from the SAME <see cref="KspSnapshot"/> that
    /// already feeds <c>system.bodies</c> (<c>KspHost.Sample</c> captures name /
    /// index / radius / hasAtmosphere per body on the Unity main thread), so
    /// this adds no KSP read of its own and is pure, KSP-free arithmetic over
    /// data someone else already captured. It also means the payload survives a
    /// recorded-session replay unchanged, since the snapshot does.</para>
    ///
    /// <para>Which body facts the model is allowed to see is the whole reason
    /// the two backends can be told apart here: stock discriminates on
    /// <c>hasAtmosphere</c>, RealAntennas ignores it. Neither is asked to
    /// enumerate bodies itself, because the body set is a fact about the
    /// universe, not about the comms mod, and duplicating the walk per backend
    /// would be the branching this whole seam exists to remove.</para>
    /// </summary>
    public static class CommsOcclusionBuilder
    {
        /// <summary>The channel this payload feeds; mirrors <c>CommsCoreUplink.OcclusionTopic</c>.</summary>
        public const string Topic = "comms.occlusion";

        /// <summary>
        /// Builds the payload for <paramref name="model"/> over the bodies in
        /// <paramref name="snapshot"/>. Fail-soft throughout: a null model
        /// becomes <see cref="CommsOcclusionModels.Unknown"/>, and a snapshot
        /// with no body list yet (main menu, cold start) yields a NAMED model
        /// with an empty body list rather than null, so a consumer can always
        /// read which geometry is in play even before there is anything to apply
        /// it to.
        /// </summary>
        public static CommsOcclusion Build(ICommsOcclusionModel? model, KspSnapshot? snapshot)
        {
            var resolved = model ?? CommsOcclusionModels.Unknown;
            var bodies = new List<CommsOcclusionBody>();

            if (snapshot?.Values != null
                && snapshot.Values.TryGetValue("bodies", out var rawBodies)
                && rawBodies is IEnumerable<object?> rawList)
            {
                var fallbackIndex = 0;
                foreach (var rawEntry in rawList)
                {
                    if (rawEntry is IDictionary<string, object?> raw)
                    {
                        bodies.Add(BuildBody(resolved, raw, fallbackIndex));
                    }
                    fallbackIndex++;
                }
            }

            return new CommsOcclusion
            {
                ModelId = resolved.ModelId,
                ModelName = resolved.ModelName,
                Bodies = bodies,
                // Not vessel-scoped: this describes the universe and the rule
                // applied to it, so it carries the same "game" provenance the
                // comms backends stamp when there is no active vessel.
                Meta = new PayloadMeta { Source = "game", Quality = Quality.OnRails },
            };
        }

        /// <summary>
        /// Whether two payloads state the same thing: same model, same resolved
        /// geometry for the same bodies. <c>Meta</c> is excluded, it is
        /// provenance rather than part of the declaration.
        ///
        /// <para>Exists because the producer republishes the SAME instance while
        /// the declaration holds, so that the emitter's change-gate (which has
        /// only reference equality to work with on a wire POCO) suppresses it
        /// instead of pushing a full body list at sample cadence.</para>
        /// </summary>
        public static bool SameDeclaration(CommsOcclusion? a, CommsOcclusion? b)
        {
            if (ReferenceEquals(a, b))
            {
                return true;
            }
            if (a == null || b == null)
            {
                return false;
            }
            if (a.ModelId != b.ModelId || a.ModelName != b.ModelName)
            {
                return false;
            }

            var left = a.Bodies ?? new List<CommsOcclusionBody>();
            var right = b.Bodies ?? new List<CommsOcclusionBody>();
            if (left.Count != right.Count)
            {
                return false;
            }
            for (var i = 0; i < left.Count; i++)
            {
                if (!SameBody(left[i], right[i]))
                {
                    return false;
                }
            }
            return true;
        }

        private static bool SameBody(CommsOcclusionBody? a, CommsOcclusionBody? b)
        {
            if (a == null || b == null)
            {
                return ReferenceEquals(a, b);
            }
            return a.Index == b.Index
                   && a.Name == b.Name
                   && a.HasAtmosphere == b.HasAtmosphere
                   // Exact comparison is right here: both sides come from the
                   // same arithmetic over the same captured radius, so a
                   // tolerance would only hide a genuine change.
                   && a.RadiusMeters.Equals(b.RadiusMeters)
                   && a.OccludingRadiusMeters.Equals(b.OccludingRadiusMeters);
        }

        private static CommsOcclusionBody BuildBody(
            ICommsOcclusionModel model,
            IDictionary<string, object?> raw,
            int fallbackIndex)
        {
            // A body with no radius in the snapshot yet is carried at 0 rather
            // than dropped: the entry still names the body and the model, and a
            // zero occluding radius reads as "blocks nothing", which is the
            // honest answer when the geometry is unknown.
            var radius = SnapshotDict.GetDouble(raw, "radius") ?? 0.0;
            var hasAtmosphere = SnapshotDict.GetBool(raw, "hasAtmosphere") == true;

            return new CommsOcclusionBody
            {
                Index = SnapshotDict.GetInt(raw, "index") ?? fallbackIndex,
                Name = SnapshotDict.GetString(raw, "name"),
                RadiusMeters = radius,
                HasAtmosphere = hasAtmosphere,
                OccludingRadiusMeters = model.OccludingRadiusMeters(radius, hasAtmosphere),
            };
        }
    }
}
