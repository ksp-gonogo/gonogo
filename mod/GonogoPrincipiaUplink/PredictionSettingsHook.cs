using System;
using System.Reflection;
using HarmonyLib;
using UnityEngine;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Finds the producer's addon and observes the two prediction settings that
    /// decide whether any of its numbers can be trusted.
    ///
    /// <para><b>Why the settings need a hook when the rest of the provenance does
    /// not.</b> Most of the producer's main-window state is operator state and is
    /// correct whenever read. The prediction tolerance and step limit are not: its
    /// own settings UI recomputes both indices on every repaint, from a per-vessel
    /// source we may not query. Unobserved they sit at their constructor defaults,
    /// and those defaults resolve to a plausible tolerance and a plausible step
    /// count. A poll would therefore hand an operator a fabricated basis for judging
    /// every other number on screen, with nothing anywhere to indicate it. That is
    /// worse than a wrong value: it is a wrong yardstick.</para>
    ///
    /// <para>So a postfix on the settings render, stamped with
    /// <c>Planetarium.GetUniversalTime()</c> and carrying the vessel it was observed
    /// for. Absent an observation the uplink publishes the four prediction fields as
    /// null, and the widget says the tolerance is unobserved.</para>
    ///
    /// <para>The two objects the cold read needs come off the addon by reflection.
    /// The addon is a <c>MonoBehaviour</c>, so it is findable without a hook at all,
    /// which is why the cold half of this surface works from the first tick.</para>
    /// </summary>
    public sealed class PredictionSettingsHook : IProvenanceSource
    {
        private const string HarmonyId = "gonogo.principia.provenance";
        private const string AdapterTypeName = "principia.ksp_plugin_adapter.PrincipiaPluginAdapter";
        private const string MainWindowTypeName = "principia.ksp_plugin_adapter.MainWindow";
        private const string RenderPredictionSettingsMethod = "RenderPredictionSettings";

        private const string MainWindowField = "main_window_";
        private const string FrameSelectorField = "plotting_frame_selector_";
        private const string ToleranceIndexField = "prediction_length_tolerance_index_";
        private const string StepsIndexField = "prediction_steps_index_";
        private const string ToleranceTableField = "prediction_length_tolerances_";
        private const string StepsTableField = "prediction_steps_";

        private static readonly ReflectedMembers Members = new ReflectedMembers();
        private static readonly FlightPlanReflection VesselIds = new FlightPlanReflection();

        private static volatile PredictionSettingsObservation? _prediction;

        private object? _adapter;

        public bool Attached { get; private set; }

        public PredictionSettingsObservation? Prediction => _prediction;

        public object? MainWindow => Members.Value(Adapter(), MainWindowField);

        public object? FrameSelector => Members.Value(Adapter(), FrameSelectorField);

        /// <summary>Drops the observation, so a session change cannot carry one
        /// save's settings into another.</summary>
        public static void Reset() => _prediction = null;

        public bool TryAttach()
        {
            if (Attached)
            {
                return true;
            }
            try
            {
                var mainWindowType = AccessTools.TypeByName(MainWindowTypeName);
                if (mainWindowType == null)
                {
                    return false;
                }
                var target = AccessTools.Method(mainWindowType, RenderPredictionSettingsMethod);
                if (target == null)
                {
                    Debug.LogWarning(
                        "[Gonogo] PredictionSettingsHook: Principia present but its prediction-settings render was not found - check signature");
                    return false;
                }
                new Harmony(HarmonyId).Patch(
                    target,
                    postfix: new HarmonyMethod(typeof(PredictionSettingsHook)
                        .GetMethod(nameof(RenderPredictionSettingsPostfix), BindingFlags.Static | BindingFlags.NonPublic)));
                Attached = true;
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] PredictionSettingsHook.TryAttach failed: " + ex.Message);
                return false;
            }
        }

        /// <summary>
        /// The settings UI has just recomputed both indices, so this is the one
        /// instant they are true.
        ///
        /// <para>The indices are turned into real quantities here, through the
        /// producer's own static tables, rather than being carried as indices. An
        /// index means nothing without the table it indexes, and shipping one would
        /// put a copy of that table on our side to drift.</para>
        /// </summary>
        private static void RenderPredictionSettingsPostfix(object __instance)
        {
            try
            {
                _prediction = new PredictionSettingsObservation
                {
                    ObservedAtUt = Planetarium.GetUniversalTime(),
                    VesselId = VesselIds.PredictedVesselId(__instance),
                    ToleranceMetres = TableLookup(__instance, ToleranceTableField, ToleranceIndexField),
                    MaxSteps = TableLookup(__instance, StepsTableField, StepsIndexField),
                };
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] PredictionSettingsHook could not read the prediction settings: " + ex.Message);
            }
        }

        /// <summary>
        /// The value at the observed index in the producer's own table, or null when
        /// either cannot be read or the index is out of range.
        ///
        /// <para>Range-checked rather than trusted. The index is a reflected field
        /// and an out-of-range one is exactly the case where a fabricated number
        /// would look real, so it resolves to "unknown" instead of to whatever
        /// happens to sit at the clamped position.</para>
        /// </summary>
        private static double? TableLookup(object instance, string tableField, string indexField)
        {
            var index = Members.ReadInt(instance, indexField);
            if (index == null || index < 0)
            {
                return null;
            }
            if (Members.Value(instance, tableField) is not Array table || index >= table.Length)
            {
                return null;
            }
            return ReflectedMembers.AsDouble(table.GetValue(index.Value));
        }

        /// <summary>
        /// The producer's addon instance, cached once found.
        ///
        /// <para>It derives from <c>MonoBehaviour</c>, so Unity's own scene lookup
        /// finds it with no hook and no game-specific knowledge beyond the type name.
        /// That is what lets the cold half of this surface work before the operator
        /// has opened anything.</para>
        /// </summary>
        private object Adapter()
        {
            if (_adapter != null)
            {
                return _adapter;
            }
            var adapterType = AccessTools.TypeByName(AdapterTypeName);
            if (adapterType != null)
            {
                _adapter = UnityEngine.Object.FindObjectOfType(adapterType);
            }
            // A sentinel rather than null so the member reads above stay
            // unconditional: reading a name off a bare object simply misses.
            return _adapter ?? NotFound;
        }

        private static readonly object NotFound = new object();
    }
}
