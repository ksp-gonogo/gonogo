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
                observationQuantumSeconds: ObservationQuantumSeconds).Evaluate;

        /// <summary>
        /// The UT gap between consecutive looks at a vessel's contact state.
        ///
        /// <para>Two gates stack. The capture tick lives in
        /// <c>GonogoAddon.FixedUpdate</c> and admits one sample per UT second
        /// (<c>SampleIntervalUt</c>), and a FixedUpdate itself covers
        /// <c>TimeWarp.fixedDeltaTime</c> of UT, which already multiplies by the
        /// warp rate on the high-warp path (0.02 s per tick becomes 20 s at
        /// 1000x and 2000 s at 100000x). The coarser of the two is the interval
        /// at which anyone is actually looking, so it both floors the sweep step
        /// and sets the largest term in the declare-lost grace.</para>
        ///
        /// <para>Read off <c>fixedDeltaTime</c> rather than the frame rate: the
        /// gate is a physics-tick gate, and wall-clock frames are neither what
        /// advances UT nor steady under load.</para>
        /// </summary>
        private static double ObservationQuantumSeconds() =>
            Math.Max(1.0, TimeWarp.fixedDeltaTime);

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
