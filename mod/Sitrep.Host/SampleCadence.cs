namespace Sitrep.Host
{
    /// <summary>
    /// Pure UT-cadence gate for <c>GonogoAddon.FixedUpdate</c> (Track C):
    /// decides whether enough game time has passed to justify the next
    /// (comparatively expensive) <c>IKspHost.Sample()</c> call. Lives here,
    /// not in <c>Gonogo.KSP</c>, per that assembly's own doc comment - it's
    /// the KSP-free logic that gets headless-tested in
    /// <c>Sitrep.Host.Tests</c>.
    ///
    /// Forward cadence: skip until <paramref name="intervalUt"/> UT has
    /// elapsed since the last sample - warp-safe, driven by game time, not
    /// wall-clock/tick count.
    ///
    /// Backward jump (F9 quickload): KSP's UT can rewind. A forward-only
    /// <c>ut - lastSampledUt &lt; interval</c> gate goes strongly negative
    /// and is ALWAYS true, so it stalls forever after a quickload - both the
    /// recorder (which must sample unconditionally) and the live stream
    /// (whose <c>GonogoBodiesServer</c> rewind-detection can't even fire,
    /// because <c>Tick</c> is never reached) go dark exactly across the
    /// event most worth capturing. So any <c>ut &lt; lastSampledUt</c> is
    /// treated as an immediate forced resample rather than a gated skip, and
    /// the new (lower) UT becomes the cadence anchor going forward.
    /// </summary>
    public static class SampleCadence
    {
        /// <summary>
        /// True when the caller should call <c>Sample()</c> now: first-ever
        /// sample (<paramref name="lastSampledUt"/> is null), a backward UT
        /// jump, or enough forward UT has elapsed.
        /// </summary>
        public static bool ShouldSample(double ut, double? lastSampledUt, double intervalUt)
        {
            if (!lastSampledUt.HasValue)
            {
                return true;
            }

            if (ut < lastSampledUt.Value)
            {
                return true;
            }

            return ut - lastSampledUt.Value >= intervalUt;
        }
    }
}
