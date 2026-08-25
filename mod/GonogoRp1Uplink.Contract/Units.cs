namespace GonogoRp1Uplink.Contract
{
    /// <summary>
    /// The units this Uplink models, declared the same way core declares its own
    /// and judged by the same codegen check.
    /// </summary>
    /// <remarks>
    /// Both tokens name a CATEGORY rather than a scale, so neither claims a
    /// physical dimension and neither invents a private axis. RP-1 build points
    /// are an internal work quantity with no conversion to anything core knows,
    /// and Confidence is RP-1's own currency, a sibling of funds and science
    /// rather than a multiple of either. The client registers the display half
    /// only (kind "count", no ladder), which is the documented shape for a token
    /// that names a category.
    /// </remarks>
    public static class Units
    {
        /// <summary>RP-1 build points: the work a project takes, not a time.</summary>
        public const string BuildPoints = "bp";

        /// <summary>Build points per second, the rate progress actually advances at.</summary>
        public const string BuildPointsPerSecond = "bp/s";

        /// <summary>RP-1's own currency, earned from science and spent on programmes and leaders.</summary>
        public const string Confidence = "confidence";
    }
}
