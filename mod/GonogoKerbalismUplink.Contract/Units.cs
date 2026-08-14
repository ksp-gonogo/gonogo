namespace GonogoKerbalismUplink.Contract
{
    /// <summary>
    /// The units this Uplink models, declared the same way core declares its
    /// own and judged by the same codegen check.
    /// </summary>
    /// <remarks>
    /// Kerbalism stores science as BYTES on a drive, which core has no reason
    /// to know about: core owns the data dimension's base (<c>bit</c>) so an
    /// antenna's bit budget and a drive's byte count stay convertible, and the
    /// rungs belong to whoever models them. Decimal throughout, because
    /// Kerbalism's own source is: <c>BPerMB = 1000*1000</c>, so a megabyte here
    /// is 10^6 bytes rather than a mebibyte's 2^20. Getting that wrong drifts
    /// 2.4% per tier against the figures the game's own UI shows.
    /// </remarks>
    public static class Units
    {
        public const string Bytes = "B";
        public const string Kilobytes = "kB";
        public const string Megabytes = "MB";
        public const string Gigabytes = "GB";

        /// <summary>Transmission throughput, composed from a byte unit and a second.</summary>
        public const string MegabytesPerSecond = "MB/s";

        /// <summary>
        /// Science yield per unit of stored data, which is what makes one file
        /// worth transmitting before another.
        /// </summary>
        public const string SciencePerMegabyte = "science/MB";
    }
}
