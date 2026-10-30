using System;
using CommNet;
using Sitrep.Contract;
using Expansions.Serenity.DeployedScience.Runtime;

namespace Gonogo.KSP
{
    /// <summary>
    /// The live reads behind a deployed-science station's link: which vessel is
    /// its controller, and whether the controller's path home would carry science.
    ///
    /// <para>Threading: reads live KSP state, MAIN-THREAD only.</para>
    /// </summary>
    internal static class DeployedStationLink
    {
        /// <summary>
        /// The vessel that holds the cluster's control unit, loaded or not, or null
        /// when the cluster has none that can be placed. Resolved the way the game
        /// resolves it for a sending experiment.
        /// </summary>
        internal static Vessel? ControllerVessel(DeployedScienceCluster? cluster)
        {
            if (cluster == null)
            {
                return null;
            }

            try
            {
                FlightGlobals.FindLoadedPart(cluster.ControlModulePartId, out var loaded);
                if (loaded != null)
                {
                    return loaded.vessel;
                }

                FlightGlobals.FindUnloadedPart(cluster.ControlModulePartId, out var unloaded);
                return unloaded?.pVesselRef?.vesselRef;
            }
            catch (Exception ex)
            {
                GonogoLog.WarnLimited("DeployedStationLink.ControllerVessel failed (station unplaced)", ex);
                return null;
            }
        }

        /// <summary>
        /// Whether the controller's path home would carry science, by the rule
        /// <see cref="BreakingGroundReads.SendPathHome"/> decides. Null when the
        /// controller is unplaced or its link could not be read.
        /// </summary>
        internal static bool? SendPathHome(Vessel? controller, Sitrep.Host.Comms.SignalDelayConfig? config)
        {
            if (controller == null)
            {
                return null;
            }

            try
            {
                var noCommsModel = config != null && config.CutForNoCommsModel;
                var connection = controller.connection;
                if (noCommsModel || connection == null)
                {
                    return BreakingGroundReads.SendPathHome(noCommsModel, connection != null, null, null);
                }

                var path = connection.ControlPath;
                return BreakingGroundReads.SendPathHome(
                    noCommsModel,
                    connectionPresent: true,
                    signalStrength: connection.SignalStrength,
                    lastHopHome: path != null ? path.IsLastHopHome() : (bool?)null);
            }
            catch (Exception ex)
            {
                GonogoLog.WarnLimited("DeployedStationLink.SendPathHome failed (link unread)", ex);
                return null;
            }
        }

        /// <summary>
        /// The data one experiment is holding unsent, from the cluster's own record
        /// of it, or null when the cluster has no such part.
        /// </summary>
        internal static double? StoredData(DeployedScienceCluster? cluster, uint partPersistentId)
        {
            return ExperimentOf(cluster, partPersistentId)?.StoredScienceData;
        }

        /// <summary>
        /// Why the experiment is off, from the cluster's own record of it and the
        /// <paramref name="enabled"/> the caller read. Null when the experiment is
        /// on or <paramref name="enabled"/> is null. An experiment the cluster has
        /// no record of is off for no cause that can be found.
        /// </summary>
        internal static DeployedOffReason? OffReason(DeployedScienceCluster? cluster, uint partPersistentId, bool? enabled)
        {
            var experiment = ExperimentOf(cluster, partPersistentId);
            return BreakingGroundReads.OffReason(
                enabled,
                experiment?.ExperimentSituationValid,
                experiment?.TotalScienceGenerated,
                experiment?.ScienceLimit);
        }

        private static DeployedScienceExperiment? ExperimentOf(DeployedScienceCluster? cluster, uint partPersistentId)
        {
            var parts = cluster?.DeployedScienceParts;
            if (parts == null)
            {
                return null;
            }

            foreach (var part in parts)
            {
                if (part != null && part.PartId == partPersistentId && part.Experiment != null)
                {
                    return part.Experiment;
                }
            }

            return null;
        }
    }
}
