using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// Builds the <c>fleet.&lt;guid&gt;.delay</c> wire dict (one
    /// <see cref="Sitrep.Contract.FleetVesselLink"/>-shaped dictionary per fleet
    /// vessel). Same self-flattening producer pattern the other wire builders in
    /// this codebase use: the contract POCO is the TYPING mirror TS codegen
    /// reflects over, and <c>JsonWriter</c> walks this dictionary to make the
    /// bytes. camelCase keys match the generated TS shape. Nullable
    /// <paramref name="oneWaySeconds"/> travels as JSON <c>null</c> when there is
    /// no path, never a sentinel zero.
    /// </summary>
    public static class FleetVesselLinkBuilder
    {
        public static Dictionary<string, object?> Build(double? oneWaySeconds, bool connected) =>
            new Dictionary<string, object?>
            {
                ["oneWaySeconds"] = oneWaySeconds,
                ["connected"] = connected,
            };
    }
}
