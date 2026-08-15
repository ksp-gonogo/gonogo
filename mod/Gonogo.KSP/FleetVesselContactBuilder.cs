using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// Builds the <c>fleet.&lt;guid&gt;.contact</c> wire dict. Takes plain
    /// primitives rather than a <c>Sitrep.Host.Comms.VesselContactState</c>
    /// directly: the caller hands across a cross-thread snapshot, not the
    /// tracker's own mutable record (see <c>FleetDelayUplink.CaptureSilenceOnMain</c>'s
    /// doc comment). Same self-flattening producer pattern as
    /// <see cref="FleetVesselLinkBuilder"/>: camelCase keys match
    /// <see cref="Sitrep.Contract.FleetVesselContact"/>, the TS codegen
    /// mirror. Deliberately narrow: <c>declaredLostUt</c>/<c>lostSeq</c> stay
    /// off the wire for this pass, no currency consumer needs them yet, see
    /// <c>local_docs/design/2026-08-15-vessel-officially-lost.md</c>.
    /// </summary>
    public static class FleetVesselContactBuilder
    {
        public static Dictionary<string, object?> Build(
            bool connected,
            string state,
            double? lastContactUt,
            double? silenceSinceUt,
            double? deadlineUt,
            string? deadlineBasis) =>
            new Dictionary<string, object?>
            {
                ["connected"] = connected,
                ["state"] = state,
                ["lastContactUt"] = lastContactUt,
                ["silenceSinceUt"] = silenceSinceUt,
                ["deadlineUt"] = deadlineUt,
                ["deadlineBasis"] = deadlineBasis,
            };
    }
}
