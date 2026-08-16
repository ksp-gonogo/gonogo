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
        private static bool _warnedFrameCheck;

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
            if (_warnedFrameCheck) return;
            _warnedFrameCheck = true;
            Debug.Log(Prefix + "frame self-check failed: live=" + liveMeters.ToString("F0")
                + "m predicted=" + predictedMeters.ToString("F0")
                + "m residual=" + residualMeters.ToString("F0") + "m");
        }

        private static bool _describedHomeSearch;

        /// <summary>
        /// What the home-node search actually saw, once. The search failing is
        /// reported by <see cref="NoGeometry"/>, but that says only THAT it
        /// failed; distinguishing "no active vessel" from "a control path with
        /// no home flagged on it" needs the counts, and inferring them from
        /// outside has already cost several rebuild cycles.
        /// </summary>
        public static void HomeSearch(
            bool activeVessel, bool connection, int pathLinks, int nodesSeen, int homesSeen, string firstNodeName)
        {
            if (_describedHomeSearch) return;
            _describedHomeSearch = true;
            Debug.Log(Prefix + "home search: activeVessel=" + activeVessel
                + " connection=" + connection
                + " pathLinks=" + pathLinks
                + " nodes=" + nodesSeen
                + " isHome=" + homesSeen
                + " firstNode=" + (firstNodeName ?? "<none>"));
        }

        private static bool _calibrated;

        /// <summary>
        /// One-shot calibration of the station's inertial-longitude convention.
        ///
        /// <para>Reasoning about KSP's <c>rotationAngle</c> convention has now
        /// produced two wrong answers, so this measures it instead. The frame
        /// self-check already computes the quantity that ought to be zero; this
        /// reports that residual across candidate longitude offsets, so the
        /// convention is identified by which one zeroes it rather than by
        /// another argument about what the field means.</para>
        /// </summary>
        public static void Calibration(string report)
        {
            if (_calibrated) return;
            _calibrated = true;
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
