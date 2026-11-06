namespace Gonogo.KSP
{
    /// <summary>
    /// How much of its recipe a switched-on converter achieved, and the game's
    /// own words when it achieved none. Carved out of the live module so the
    /// rules can be entered by a test.
    /// </summary>
    internal readonly struct ConverterThroughput
    {
        private const double Nothing = 1e-9;

        public ConverterThroughput(double? throughput, string? shortfall)
        {
            Throughput = throughput;
            Shortfall = shortfall;
        }

        public double? Throughput { get; }

        public string? Shortfall { get; }

        /// <summary>
        /// A converter that is not running has no throughput to report. A running
        /// one reports the game's last-tick fraction, clamped to 0..1, and, when
        /// that is zero, the status text the game wrote for it.
        /// </summary>
        public static ConverterThroughput Of(bool running, double lastTimeFactor, string? status)
        {
            if (!running || double.IsNaN(lastTimeFactor) || double.IsInfinity(lastTimeFactor))
            {
                return new ConverterThroughput(null, null);
            }

            var share = lastTimeFactor < 0 ? 0 : lastTimeFactor > 1 ? 1 : lastTimeFactor;
            var starved = share <= Nothing;
            return new ConverterThroughput(
                share,
                starved && !string.IsNullOrWhiteSpace(status) ? status : null);
        }
    }
}
