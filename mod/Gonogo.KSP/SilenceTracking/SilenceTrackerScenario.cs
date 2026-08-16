using System;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// Owns the one <see cref="SilenceTracker"/> for the current save,
    /// persists it through <c>OnSave</c>/<c>OnLoad</c>, and binds it onto
    /// <see cref="SilenceTrackerSink"/> so <see cref="FleetChannels"/>'s
    /// process-lifetime capture can reach the CURRENT save's instance
    /// without itself surviving a reload. Same shape as
    /// <c>CurrencyDelay.CurrencyDelayScenario</c>: a fresh tracker is built
    /// in <c>OnAwake</c> (never a static that survives scene reloads), and
    /// <c>OnLoad</c> restores INTO that same instance via
    /// <see cref="SilenceTrackerPersistence.Load"/>.
    ///
    /// Registered for FLIGHT/SPACECENTER/TRACKSTATION - every scene a fleet
    /// capture tick can run in.
    /// </summary>
    [KSPScenario(ScenarioCreationOptions.AddToAllGames, GameScenes.FLIGHT, GameScenes.SPACECENTER, GameScenes.TRACKSTATION)]
    public sealed class SilenceTrackerScenario : ScenarioModule
    {
        private SilenceTracker _tracker = new SilenceTracker(BuildPolicy());

        public override void OnAwake()
        {
            base.OnAwake();

            _tracker = new SilenceTracker(BuildPolicy());
            SilenceTrackerSink.Bind(_tracker);
        }

        /// <summary>
        /// The geometry predictor, falling back to the orbital-period deadline
        /// on every path it cannot resolve. Built per save rather than held
        /// static because the elected comms backend (and so the occluding
        /// radius it declares) is a property of the running game, not of the
        /// process.
        /// </summary>
        private static SilenceDeadlinePolicy BuildPolicy() =>
            new PredictedReacquisitionSilenceDeadlinePolicy(
                new KspVisibilityGeometryFactory(() => SilenceGeometrySink.Kernel).Build,
                warpStepFloorSeconds: WarpStepFloorSeconds).Evaluate;

        /// <summary>
        /// The finest UT step this warp can actually resolve: one physics frame
        /// of game time. Above it the sweep would be sampling a curve it cannot
        /// see, so the policy reports warp-limited instead of a number.
        /// </summary>
        private static double WarpStepFloorSeconds()
        {
            var rate = TimeWarp.CurrentRate;
            if (!(rate > 1.0f))
            {
                return 1.0;
            }
            var fps = Time.smoothDeltaTime > 0.0f ? 1.0 / Time.smoothDeltaTime : 60.0;
            return Math.Max(1.0, rate / fps);
        }

        public override void OnLoad(ConfigNode node)
        {
            base.OnLoad(node);
            try
            {
                SilenceTrackerPersistence.Load(_tracker, node);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] SilenceTrackerScenario.OnLoad failed: " + ex);
            }
        }

        public override void OnSave(ConfigNode node)
        {
            base.OnSave(node);
            try
            {
                SilenceTrackerPersistence.Save(_tracker, node);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] SilenceTrackerScenario.OnSave failed: " + ex);
            }
        }

        private void OnDestroy()
        {
            SilenceTrackerSink.Unbind();
        }
    }
}
