using UnityEngine;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// One-shot-per-transition tracing for the silence capture/publish path.
    ///
    /// <para>This path is entirely fail-soft: no tracker bound, no vessels, a
    /// null capture — every one of them produces nothing and says nothing, so
    /// a channel that never reaches the wire looks exactly like a channel with
    /// nothing to say. That is fine in normal running and useless the moment
    /// you need to know which of the two you have.</para>
    ///
    /// <para>Logs on CHANGE only, never per tick: this runs at capture cadence
    /// and a per-tick line would bury KSP.log. Uses
    /// <see cref="Debug"/> rather than Console.Error, which is invisible in a
    /// KSP process.</para>
    /// </summary>
    internal static class SilenceTrace
    {
        private const string Prefix = "[Gonogo] silence: ";

        private static bool _warnedNoTracker;
        private static int _lastCaptureCount = -1;
        private static int _lastPublishCount = -1;
        private static bool _warnedNotPublished;

        public static void NoTracker()
        {
            if (_warnedNoTracker) return;
            _warnedNoTracker = true;
            Debug.Log(Prefix + "no tracker bound; contact channels will not publish until a scenario binds one");
        }

        public static void Captured(int vesselCount, double ut)
        {
            _warnedNoTracker = false;
            if (vesselCount == _lastCaptureCount) return;
            _lastCaptureCount = vesselCount;
            Debug.Log(Prefix + "captured " + vesselCount + " vessel(s) at UT " + ut.ToString("F1"));
        }

        public static void Publishing(int vesselCount)
        {
            _warnedNotPublished = false;
            if (vesselCount == _lastPublishCount) return;
            _lastPublishCount = vesselCount;
            Debug.Log(Prefix + "publishing contact for " + vesselCount + " vessel(s)");
        }

        public static void NotPublished(object? captured, bool noSource)
        {
            if (_warnedNotPublished) return;
            _warnedNotPublished = true;
            Debug.Log(Prefix + "nothing published (captured=" + (captured == null ? "null" : captured.GetType().Name)
                + ", noDynamicSource=" + noSource + ")");
        }
    }
}
