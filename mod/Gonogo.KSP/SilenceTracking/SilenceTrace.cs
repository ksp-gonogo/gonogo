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

        private static string? _lastNoGeometryReason;
        private static string? _lastFrameCheck;

        /// <summary>
        /// Which branch of the geometry factory declined to build. Every one of
        /// them returns null and the policy then falls back, so from outside
        /// they are indistinguishable - and the fallback basis is the same
        /// orbital-period answer a working predictor gives when it finds
        /// nothing.
        /// </summary>
        public static void NoGeometry(string reason)
        {
            if (reason == _lastNoGeometryReason) return;
            _lastNoGeometryReason = reason;
            Debug.Log(Prefix + "no geometry built: " + reason);
        }

        /// <summary>
        /// The frame self-check refusing to reconcile is the interesting
        /// failure: it means the elements, the patched-conic chain or the
        /// station's rotation phase disagree with the live scene, and the
        /// residual says by how much.
        /// </summary>
        public static void FrameCheckFailed(double liveMeters, double predictedMeters, double residualMeters)
        {
            // Bucketed to the nearest km so an ordinary drifting residual does
            // not spam, while a genuinely different failure still prints.
            var line = "frame self-check failed: live=" + liveMeters.ToString("F0")
                + "m predicted=" + predictedMeters.ToString("F0")
                + "m residual=" + residualMeters.ToString("F0") + "m";
            var key = ((long)(residualMeters / 1000.0)).ToString();
            if (key == _lastFrameCheck) return;
            _lastFrameCheck = key;
            Debug.Log(Prefix + line);
        }

        private static string? _lastHomeSearch;

        /// <summary>
        /// What the home-node search actually saw, once. The search failing is
        /// reported by <see cref="NoGeometry"/>, but that says only THAT it
        /// failed; distinguishing "no active vessel" from "a control path with
        /// no home flagged on it" needs the counts, and inferring them from
        /// outside has already cost several rebuild cycles.
        /// </summary>
        public static void HomeSearch(int pathHomes, int sceneHomes, int total)
        {
            // On CHANGE, not once: a one-shot showed only the first tick, which
            // is the one tick where CommNet is guaranteed not to be built yet,
            // and made a transient state look permanent.
            var line = "home search: fromPaths=" + pathHomes + " fromScene=" + sceneHomes + " total=" + total;
            if (line == _lastHomeSearch) return;
            _lastHomeSearch = line;
            Debug.Log(Prefix + line);
        }

        private static string? _lastCalibration;

        /// <summary>
        /// The outcome of solving this body's station-longitude offset.
        ///
        /// <para>On CHANGE, not once. A one-shot here was the third instance of
        /// the same mistake in this subsystem: the FIRST call wins, and the
        /// first call is invariably the uninteresting one from a tick before
        /// the scene is ready, after which every later outcome - including the
        /// success - is suppressed for the rest of the session. De-duplication
        /// is right for a message that repeats every tick and wrong for one
        /// whose whole value is that it changed.</para>
        /// </summary>
        public static void Calibration(string report)
        {
            if (report == _lastCalibration) return;
            _lastCalibration = report;
            Debug.Log(Prefix + "longitude calibration: " + report);
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
