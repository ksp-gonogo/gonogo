using Sitrep.Host.Comms;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// ConfigNode round-trip for a <see cref="SilenceTracker"/>'s whole
    /// per-vessel record set, nested as one child node per vessel inside the
    /// scenario's own node. Same discipline as
    /// <c>CurrencyDelay.CurrencyDelayLedgerPersistence</c>: <see cref="Load"/>
    /// restores into the caller's existing tracker (via
    /// <see cref="SilenceTracker.RestoreState"/>), never a fresh replacement,
    /// so <see cref="SilenceTrackerScenario"/> can bind the tracker onto
    /// <see cref="SilenceTrackerSink"/> in OnAwake and have OnLoad fill in
    /// that same instance.
    /// </summary>
    public static class SilenceTrackerPersistence
    {
        private const string RootNodeName = "SILENCE_TRACKER";
        private const string VesselNodeName = "VESSEL";

        public static void Save(SilenceTracker tracker, ConfigNode node)
        {
            var root = node.AddNode(RootNodeName);
            // A destroyed vessel never comes back under the same id, and its record
            // would otherwise ride in the save, and be restored on every load, for good.
            foreach (var state in tracker.LiveStates)
            {
                var vesselNode = root.AddNode(VesselNodeName);
                vesselNode.AddValue("vesselId", state.VesselId);
                vesselNode.AddValue("state", state.State.ToString());
                vesselNode.AddValue("connected", state.Connected);

                if (state.LastContactUt.HasValue) vesselNode.AddValue("lastContactUt", state.LastContactUt.Value);
                if (state.SilenceSinceUt.HasValue) vesselNode.AddValue("silenceSinceUt", state.SilenceSinceUt.Value);
                if (state.DeadlineUt.HasValue) vesselNode.AddValue("deadlineUt", state.DeadlineUt.Value);
                if (state.DeadlineBasis != null) vesselNode.AddValue("deadlineBasis", state.DeadlineBasis);
                if (state.PredictedReacquisitionUt.HasValue) vesselNode.AddValue("predictedReacquisitionUt", state.PredictedReacquisitionUt.Value);
                if (state.PredictionGraceSec.HasValue) vesselNode.AddValue("predictionGraceSec", state.PredictionGraceSec.Value);
            }
        }

        /// <summary>
        /// Reads the nested tracker node back, if present, and restores each
        /// row into <paramref name="target"/>. A save from before this
        /// subsystem existed (or a brand-new game) has no such node - target
        /// is left exactly as it was constructed (empty).
        /// </summary>
        public static void Load(SilenceTracker target, ConfigNode node)
        {
            var root = node?.GetNode(RootNodeName);
            if (root == null)
            {
                return;
            }

            foreach (var vesselNode in root.GetNodes(VesselNodeName))
            {
                var vesselId = vesselNode.GetValue("vesselId");
                if (string.IsNullOrEmpty(vesselId))
                {
                    continue;
                }

                var stateText = vesselNode.GetValue("state");
                if (stateText == null || !System.Enum.TryParse(stateText, out SilenceState state))
                {
                    state = SilenceState.Nominal;
                }

                var connected = false;
                vesselNode.TryGetValue("connected", ref connected);

                var restored = new VesselContactState
                {
                    VesselId = vesselId,
                    State = state,
                    Connected = connected,
                    LastContactUt = ReadNullableDouble(vesselNode, "lastContactUt"),
                    SilenceSinceUt = ReadNullableDouble(vesselNode, "silenceSinceUt"),
                    DeadlineUt = ReadNullableDouble(vesselNode, "deadlineUt"),
                    DeadlineBasis = vesselNode.HasValue("deadlineBasis") ? vesselNode.GetValue("deadlineBasis") : null,
                    PredictedReacquisitionUt = ReadNullableDouble(vesselNode, "predictedReacquisitionUt"),
                    PredictionGraceSec = ReadNullableDouble(vesselNode, "predictionGraceSec"),
                };

                target.RestoreState(restored);
            }
        }

        private static double? ReadNullableDouble(ConfigNode node, string key)
        {
            if (!node.HasValue(key))
            {
                return null;
            }
            double value = 0;
            node.TryGetValue(key, ref value);
            return value;
        }
    }
}
