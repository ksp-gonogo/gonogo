using Sitrep.Host.Comms;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// ConfigNode round-trip for a <see cref="SilenceTracker"/>'s whole
    /// per-vessel record set, nested as one child node per vessel inside the
    /// scenario's own node. Same discipline as
    /// <c>CurrencyDelay.CurrencyDelayLedgerPersistence</c>: <see cref="Load"/>
    /// restores INTO the caller's existing tracker (via
    /// <see cref="SilenceTracker.RestoreState"/>), never a fresh replacement,
    /// so <see cref="SilenceTrackerScenario"/> can bind the tracker onto
    /// <see cref="SilenceTrackerSink"/> in OnAwake and have OnLoad fill in
    /// that SAME instance.
    ///
    /// <para>Persists the FULL record, not just <c>silenceSinceUt</c>/
    /// <c>deadlineUt</c>/<c>lostSeq</c>: <c>state</c>, <c>connected</c> and
    /// <c>declaredLostUt</c> ride along too, because a reload has to be able
    /// to tell "already Lost" from "still Silent" WITHOUT re-running the
    /// warp-hysteresis two-sample requirement against a vessel that was
    /// legitimately declared before the save - otherwise a reload could
    /// either resurrect an already-lost vessel for one tick, or silently
    /// re-increment <c>lostSeq</c> a second time for the same occurrence,
    /// breaking the idempotency a future currency consumer relies on.</para>
    /// </summary>
    public static class SilenceTrackerPersistence
    {
        private const string RootNodeName = "SILENCE_TRACKER";
        private const string VesselNodeName = "VESSEL";

        public static void Save(SilenceTracker tracker, ConfigNode node)
        {
            var root = node.AddNode(RootNodeName);
            foreach (var state in tracker.States.Values)
            {
                var vesselNode = root.AddNode(VesselNodeName);
                vesselNode.AddValue("vesselId", state.VesselId);
                vesselNode.AddValue("state", state.State.ToString());
                vesselNode.AddValue("connected", state.Connected);
                vesselNode.AddValue("lostSeq", state.LostSeq);

                if (state.LastContactUt.HasValue) vesselNode.AddValue("lastContactUt", state.LastContactUt.Value);
                if (state.SilenceSinceUt.HasValue) vesselNode.AddValue("silenceSinceUt", state.SilenceSinceUt.Value);
                if (state.DeadlineUt.HasValue) vesselNode.AddValue("deadlineUt", state.DeadlineUt.Value);
                if (state.DeadlineBasis != null) vesselNode.AddValue("deadlineBasis", state.DeadlineBasis);
                if (state.PredictedReacquisitionUt.HasValue) vesselNode.AddValue("predictedReacquisitionUt", state.PredictedReacquisitionUt.Value);
                if (state.PredictionGraceSec.HasValue) vesselNode.AddValue("predictionGraceSec", state.PredictionGraceSec.Value);
                if (state.DeclaredLostUt.HasValue) vesselNode.AddValue("declaredLostUt", state.DeclaredLostUt.Value);
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

                var lostSeq = 0;
                vesselNode.TryGetValue("lostSeq", ref lostSeq);

                var restored = new VesselContactState
                {
                    VesselId = vesselId,
                    State = state,
                    Connected = connected,
                    LostSeq = lostSeq,
                    LastContactUt = ReadNullableDouble(vesselNode, "lastContactUt"),
                    SilenceSinceUt = ReadNullableDouble(vesselNode, "silenceSinceUt"),
                    DeadlineUt = ReadNullableDouble(vesselNode, "deadlineUt"),
                    DeadlineBasis = vesselNode.HasValue("deadlineBasis") ? vesselNode.GetValue("deadlineBasis") : null,
                    PredictedReacquisitionUt = ReadNullableDouble(vesselNode, "predictedReacquisitionUt"),
                    PredictionGraceSec = ReadNullableDouble(vesselNode, "predictionGraceSec"),
                    DeclaredLostUt = ReadNullableDouble(vesselNode, "declaredLostUt"),
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
