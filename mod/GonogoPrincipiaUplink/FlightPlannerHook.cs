using System;
using System.Reflection;
using HarmonyLib;
using UnityEngine;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Observes the integrator's flight planner from inside its own render, because
    /// there is no other instant at which its state is true.
    ///
    /// <para><b>Why a hook and not a poll.</b> Every field a flight-plan mirror
    /// wants is refreshed only while the planner window is rendering: the planner's
    /// update and render helpers are called exclusively from its window-render
    /// callback. Polling those fields therefore reads whatever the operator's last
    /// glance left behind. That is bad for a countdown and catastrophic for a list:
    /// a vessel whose planner has never been opened has an EMPTY burn list, so a
    /// poll would report "no flight plan" for a vessel that has one, and the
    /// operator would stop looking. Absence must never be rendered from a source
    /// that cannot tell "none" from "not yet observed".</para>
    ///
    /// <para>So the plan is captured when the integrator itself computes it, stamped
    /// with the UT of that instant, and published as a sample AT that instant. The
    /// client's own reckoning then ages it for free: a plan observed six hours ago
    /// reads as a six-hour-old sample, which is the truth, and needs no special case
    /// anywhere downstream.</para>
    ///
    /// <para><b>Two postfixes, because "no plan" is a real observation.</b> The
    /// planner calls its plan-render helper only when a plan exists, so being called
    /// is the evidence that one does. A postfix on the window's own render therefore
    /// sees the complement: if the frame finished without the plan helper running,
    /// this vessel positively has no plan, and that is worth publishing. One postfix
    /// alone could only ever say "a plan exists" and stay silent otherwise, which is
    /// the silence that reads as absence.</para>
    ///
    /// <para>Observe-only, both of them: they read managed fields after the fact and
    /// call nothing. Absent Principia, <see cref="TryAttach"/> never finds the type,
    /// stays unattached, and nothing else behaves differently.</para>
    /// </summary>
    public sealed class FlightPlannerHook : IFlightPlanObserver
    {
        private const string HarmonyId = "gonogo.principia.flightplan";
        private const string FlightPlannerTypeName = "principia.ksp_plugin_adapter.FlightPlanner";
        private const string RenderFlightPlanMethod = "RenderFlightPlan";
        private const string RenderWindowContentsMethod = "RenderWindowContents";

        private static readonly FlightPlanReflection Reflection = new FlightPlanReflection();

        /// <summary>The most recent observation, or null before the operator has
        /// opened the planner once. Written from the render postfixes and read from
        /// the uplink's main-thread capture, both on Unity's main thread.</summary>
        private static volatile FlightPlanObservation? _latest;

        /// <summary>Set by the plan postfix and cleared by the window postfix that
        /// follows it, so the window postfix can tell a frame that drew a plan from
        /// one that did not.</summary>
        private static bool _planRenderedThisFrame;

        public bool Attached { get; private set; }

        /// <summary>The latest observation, or null if the planner has never been
        /// rendered. Null is "not observed", never "no plan".
        ///
        /// <para>An instance property over a static latch, because the latch has to
        /// be static (a Harmony postfix is a static method and has no instance to
        /// write to) while the reader is an <see cref="IFlightPlanObserver"/> the
        /// uplink holds. The asymmetry lives here rather than leaking into the
        /// seam.</para></summary>
        public FlightPlanObservation? Latest => _latest;

        /// <summary>Drops the observation, so a session change cannot leave one
        /// save's plan attributed into another.</summary>
        public static void Reset()
        {
            _latest = null;
            _planRenderedThisFrame = false;
        }

        /// <summary>
        /// Attempts to attach both postfixes; idempotent once attached. Returns false
        /// rather than throwing when the type or either method cannot be resolved,
        /// and can be retried.
        /// </summary>
        public bool TryAttach()
        {
            if (Attached)
            {
                return true;
            }

            try
            {
                var plannerType = AccessTools.TypeByName(FlightPlannerTypeName);
                if (plannerType == null)
                {
                    return false;
                }

                var planTarget = AccessTools.Method(plannerType, RenderFlightPlanMethod);
                var windowTarget = AccessTools.Method(plannerType, RenderWindowContentsMethod);
                if (planTarget == null || windowTarget == null)
                {
                    Debug.LogWarning(
                        "[Gonogo] FlightPlannerHook: Principia present but its planner render methods were not found - check signatures");
                    return false;
                }

                var harmony = new Harmony(HarmonyId);
                harmony.Patch(planTarget, postfix: Postfix(nameof(RenderFlightPlanPostfix)));
                harmony.Patch(windowTarget, postfix: Postfix(nameof(RenderWindowContentsPostfix)));

                Attached = true;
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] FlightPlannerHook.TryAttach failed: " + ex.Message);
                return false;
            }
        }

        private static HarmonyMethod Postfix(string name) =>
            new HarmonyMethod(typeof(FlightPlannerHook)
                .GetMethod(name, BindingFlags.Static | BindingFlags.NonPublic));

        /// <summary>
        /// A plan was computed for <paramref name="vessel_guid"/>. Harmony matches
        /// the parameter by name, so this compiles with no Principia reference at
        /// all, and the guid arrives from the integrator rather than being inferred
        /// from whichever vessel happens to be active.
        /// </summary>
        private static void RenderFlightPlanPostfix(object __instance, string vessel_guid)
        {
            _planRenderedThisFrame = true;
            Observe(__instance, vessel_guid, planExists: true);
        }

        /// <summary>
        /// The planner finished a frame. If no plan was rendered in it, this vessel
        /// has no plan, and that is an observation rather than a silence.
        ///
        /// <para>The vessel comes off the planner's own predicted-vessel property by
        /// reflection, so no KSP vessel type is needed at compile time here either.
        /// With no predicted vessel there is nothing to attribute an absence to, so
        /// nothing is recorded: a plan-less observation with no vessel would be a
        /// claim about every vessel at once.</para>
        /// </summary>
        private static void RenderWindowContentsPostfix(object __instance)
        {
            var planRendered = _planRenderedThisFrame;
            _planRenderedThisFrame = false;
            if (planRendered)
            {
                return;
            }
            var vesselId = Reflection.PredictedVesselId(__instance);
            if (vesselId == null)
            {
                return;
            }
            Observe(__instance, vesselId, planExists: false);
        }

        /// <summary>
        /// Takes the reading and latches it. Wrapped because this runs inside
        /// someone else's render: an exception escaping a Harmony postfix would break
        /// the integrator's own window, and losing one observation is the correct
        /// price for not doing that.
        /// </summary>
        private static void Observe(object planner, string? vesselId, bool planExists)
        {
            try
            {
                _latest = Reflection.Read(
                    planner, vesselId, Planetarium.GetUniversalTime(), planExists);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] FlightPlannerHook could not read the flight plan: " + ex.Message);
            }
        }
    }
}
