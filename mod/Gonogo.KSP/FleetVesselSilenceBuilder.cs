using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// Builds the <c>silence.&lt;guid&gt;.state</c> wire dict: the
    /// SilenceTracker's reckoning of one vessel, published by
    /// <see cref="Gonogo.KSP.SilenceTracking.FleetSilenceChannels"/>. Takes
    /// plain primitives rather than a <c>Sitrep.Host.Comms.VesselContactState</c>
    /// directly, the caller hands across a cross-thread snapshot, not the
    /// tracker's own mutable record. Same self-flattening producer pattern as
    /// <see cref="FleetVesselContactBuilder"/>: camelCase keys match
    /// <see cref="Sitrep.Contract.FleetVesselSilence"/>, the TS codegen
    /// mirror.
    /// </summary>
    public static class FleetVesselSilenceBuilder
    {
        public static Dictionary<string, object?> Build(
            string state,
            double? silenceSinceUt,
            double? deadlineUt,
            string? deadlineBasis,
            double? predictedReacquisitionUt) =>
            new Dictionary<string, object?>
            {
                ["state"] = state,
                ["silenceSinceUt"] = silenceSinceUt,
                ["deadlineUt"] = deadlineUt,
                ["deadlineBasis"] = deadlineBasis,
                ["predictedReacquisitionUt"] = predictedReacquisitionUt,
            };
    }
}
