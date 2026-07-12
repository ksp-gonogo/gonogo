using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free command-handling logic for the science-experiment commands —
    /// the command-side twin of <see cref="ScienceViewProvider"/> and the
    /// science-domain analogue of <see cref="VesselCommandProvider"/>. Each
    /// <c>Handle*</c> method is the exact delegate
    /// <c>Gonogo.KSP.ScienceUplink.Register</c> hands to
    /// <see cref="IUplinkHost.AddCommandHandler{TArgs,TResult}"/>: parse the
    /// already-typed args, do the one check that needs no live game state (an
    /// empty <c>partId</c> resolves to nothing), then call the matching
    /// <see cref="IScienceActuator"/> method and hand back its already-typed
    /// result. No KSP/Unity type appears anywhere in this file — every check
    /// that needs live state (whether the part resolves, whether the experiment
    /// is in a deployable/transmittable state, whether a transmitter exists) is
    /// the actuator's job and comes back as a typed
    /// <see cref="CommandResult.ErrorCode"/>.
    ///
    /// <para><b>Delayed (uplink to the craft):</b> both commands actuate an
    /// experiment ON the vessel, so they ride the same light-time delay every
    /// other actuation does — declared <c>delayed: true</c> in
    /// <c>ScienceUplink</c>'s command table.</para>
    /// </summary>
    public static class ScienceCommandProvider
    {
        // ---- science.experiment.* -- delayed:true (actuation rides light-time) ----
        public const string DeployCommand = "science.experiment.deploy";
        public const string TransmitCommand = "science.experiment.transmit";

        /// <summary>
        /// An empty <c>partId</c> can never resolve to a live part, so it
        /// fail-fasts as <see cref="CommandErrorCode.NotFound"/> HERE without
        /// ever reaching the actuator — the same fail-fast
        /// <see cref="VesselCommandProvider.HandleTargetSet"/> applies to a
        /// structurally-unresolvable target. A well-formed but unknown
        /// <c>partId</c> is the actuator's own <see cref="CommandErrorCode.NotFound"/>
        /// to return (it's the one with FlightGlobals in hand).
        /// </summary>
        public static CommandResult HandleDeploy(IScienceActuator actuator, ExperimentActionArgs args)
        {
            if (string.IsNullOrEmpty(args.PartId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.DeployExperiment(args.PartId);
        }

        /// <summary>Mirrors <see cref="HandleDeploy"/>'s empty-<c>partId</c> fail-fast before the actuator is ever called.</summary>
        public static CommandResult HandleTransmit(IScienceActuator actuator, ExperimentActionArgs args)
        {
            if (string.IsNullOrEmpty(args.PartId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.TransmitExperiment(args.PartId);
        }
    }
}
