using System;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// Owns the one <see cref="SilenceTracker"/> for the current save,
    /// persists it through <c>OnSave</c>/<c>OnLoad</c>, and binds it onto
    /// <see cref="SilenceTrackerSink"/> so <see cref="FleetDelayUplink"/>'s
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
        private SilenceTracker _tracker = new SilenceTracker(new OrbitalPeriodSilenceDeadlinePolicy().Evaluate);

        public override void OnAwake()
        {
            base.OnAwake();

            _tracker = new SilenceTracker(new OrbitalPeriodSilenceDeadlinePolicy().Evaluate);
            SilenceTrackerSink.Bind(_tracker);
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
