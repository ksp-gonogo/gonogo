using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// Builds the <c>fleet.silence</c> wire dict: every vessel the tracker holds
    /// a reckoning for, in one payload.
    ///
    /// <para>Deliberately reuses <see cref="FleetVesselSilenceBuilder"/> for each
    /// entry and adds only the vessel id, which the per-vessel topic gets from
    /// its own topic string and an aggregate has to carry. Two builders emitting
    /// the same reckoning in two shapes is how the aggregate and the per-vessel
    /// topic would quietly drift apart, and a client comparing them would have no
    /// way to tell which one was wrong.</para>
    ///
    /// <para>Same self-flattening producer pattern as its siblings: camelCase
    /// keys match <see cref="Sitrep.Contract.FleetSilence"/> and
    /// <see cref="Sitrep.Contract.FleetSilenceEntry"/>, the TS codegen
    /// mirror.</para>
    /// </summary>
    public static class FleetSilenceRosterBuilder
    {
        /// <summary>One roster entry: the per-vessel reckoning plus its vessel id.</summary>
        public static Dictionary<string, object?> BuildEntry(
            string vesselId,
            string state,
            double? silenceSinceUt,
            double? deadlineUt,
            string? deadlineBasis,
            double? predictedReacquisitionUt,
            double? predictionGraceSeconds)
        {
            var entry = FleetVesselSilenceBuilder.Build(
                state, silenceSinceUt, deadlineUt, deadlineBasis, predictedReacquisitionUt, predictionGraceSeconds);
            entry["vesselId"] = vesselId;
            return entry;
        }

        /// <summary>The whole roster, wrapped the way <c>system.vessels</c> wraps its own.</summary>
        public static Dictionary<string, object?> Build(IReadOnlyList<Dictionary<string, object?>> vessels) =>
            new Dictionary<string, object?>
            {
                ["vessels"] = vessels,
            };
    }
}
