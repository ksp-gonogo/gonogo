// A fixture, excluded from compilation. It carries the manifest wiring an armed
// Uplink needs and nothing else, so no other scan in this repo has anything to read in it.
namespace Gonogo.PlantedUplink
{
    internal static class PlantedManifest
    {
        internal static object Build() => new
        {
            ExpectedClientHash = string.IsNullOrEmpty(ExpectedClientHash.Value) ? null : ExpectedClientHash.Value,
        };
    }
}
