using System;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What the signal-delay config becomes while the flight on screen is a
    /// SIMULATION.
    ///
    /// <para><b>One derivation, one place, and that is the point.</b> Delay
    /// reaches an operator through five separate readers of
    /// <c>CommsCoreUplink.SignalDelayConfig</c>: the reveal gate, the
    /// <c>comms.delay</c> channel, every fleet vessel's own light-time, the
    /// per-command-centre delay pass, and the currency reveal deadline. A cut
    /// applied at one of them and not the others is a board where the
    /// telemetry is live and the money still arrives four minutes late.
    /// Deriving the CONFIG rather than patching each reader means every one of
    /// them cuts together, without knowing this exists.</para>
    ///
    /// <para><b>Why a simulation cuts the delay at all.</b> A simulation is a
    /// ground-side rehearsal: there is no spacecraft, so there is no
    /// light-time, and applying one models a distance to a craft that does not
    /// exist. That is a fiction rather than a measurement, and a mission
    /// control board should not make it. A controller may still want the delay
    /// on, to rehearse under the conditions the real flight will have, so it is
    /// <see cref="SignalDelayConfig.DelayInSimulation"/> rather than a rule.
    /// </para>
    ///
    /// <para><b>Kept free of KSP</b> so the rule is testable against a
    /// stand-in backend rather than a live career: the only game-facing part
    /// is the elected backend's own read, which happens behind the
    /// interface.</para>
    /// </summary>
    public static class SimulationDelayPolicy
    {
        /// <summary>
        /// The config every delay reader should use this tick, given the
        /// authored one and whichever backend knows what a simulation is.
        ///
        /// <para>Returns the authored config unchanged in every case but one:
        /// delay is on, the operator has not asked for it during a simulation,
        /// and the backend says this flight IS one. Only then does a derived
        /// config come back, disabled and carrying
        /// <see cref="SignalDelayConfig.CutForSimulation"/> so the reason
        /// reaches <c>comms.delay</c>.</para>
        ///
        /// <para>A backend that throws is read as no opinion. This runs on the
        /// path of every delay read in the mod, including the Courier's, and a
        /// reflection walk into a mod nobody here has a copy of is not
        /// something to let escape onto it.</para>
        /// </summary>
        public static SignalDelayConfig Effective(
            SignalDelayConfig? authored,
            ISimulationBackend? backend)
        {
            var config = authored ?? SignalDelayConfig.Off();

            if (!config.Enabled || config.DelayInSimulation || backend == null)
            {
                return config;
            }

            bool? simulated;
            try
            {
                simulated = backend.IsSimulatedFlight();
            }
            catch (Exception)
            {
                return config;
            }

            // True only. Null is "this game has no such concept" and false is
            // "this is a mission"; neither cuts anything.
            if (simulated != true)
            {
                return config;
            }

            return new SignalDelayConfig
            {
                Enabled = false,
                LightSpeedScale = config.LightSpeedScale,
                SilenceDeclarationSeconds = config.SilenceDeclarationSeconds,
                DelayInSimulation = false,
                CutForSimulation = true,
            };
        }
    }
}
