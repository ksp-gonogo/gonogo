// mod/GonogoTestFlightUplink/EngineReliabilityRaw.cs
// Plain per-engine reliability snapshot the reflection layer produces and the
// pure mapper consumes. KSP-FREE by design so the headless Tests project can
// compile it alongside TestFlightReliabilityMap without a KSP reference.
namespace GonogoTestFlightUplink
{
    public sealed class EngineReliabilityRaw
    {
        public string PartId = "";
        public string Title = "";
        public double CurrentReliability = 1.0; // 0..1
        public double FlightData; // "du"
        public double MomentaryFailureRate;
        // Seconds of rated burn time left before failure risk ramps steeply, or
        // null when TestFlight does not expose it. [verify] the exact runtime
        // read on the RO fixture-capture pass.
        public double? RemainingRatedBurnSeconds;
    }
}
