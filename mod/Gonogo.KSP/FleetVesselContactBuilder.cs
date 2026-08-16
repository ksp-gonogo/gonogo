using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// Builds the <c>fleet.&lt;guid&gt;.contact</c> wire dict: the CORE
    /// connected/lastContactUt facts, published by
    /// <see cref="FleetChannels"/>. Same self-flattening producer pattern as
    /// <see cref="FleetVesselLinkBuilder"/>: camelCase keys match
    /// <see cref="Sitrep.Contract.FleetVesselContact"/>, the TS codegen
    /// mirror. The comms-derived reckoning (state/deadlines) is a separate
    /// wire type built by <c>FleetVesselSilenceBuilder</c>; see
    /// <see cref="Sitrep.Contract.FleetVesselContact"/>'s doc comment for why
    /// the two are split.
    /// </summary>
    public static class FleetVesselContactBuilder
    {
        public static Dictionary<string, object?> Build(bool connected, double? lastContactUt) =>
            new Dictionary<string, object?>
            {
                ["connected"] = connected,
                ["lastContactUt"] = lastContactUt,
            };
    }
}
