using System;
using System.Reflection;
using Gonogo.KSP.CurrencyDelay;
using HarmonyLib;
using UnityEngine;

namespace Gonogo.KerbalismUplink
{
    // Reaches the third-party Kerbalism assembly by reflection only (never a compile-time
    // reference - Kerbalism may not even be installed), and reads ProtoVessel/Planetarium, so it
    // builds against the KSP reference DLLs (KspManaged) plus 0Harmony (KspGameData). It is the ONE
    // place in the codebase that knows Kerbalism's science-crediting shape: everything downstream is
    // reached through the source-agnostic Gonogo.KSP.CurrencyDelay.DelayedScienceSink.

    /// <summary>
    /// Presence-gated Harmony postfix on KERBALISM.SubjectData.RetrieveScience - the single choke
    /// point Kerbalism routes ALL of its own science crediting through (incremental transmission,
    /// vessel recovery, and lab-produced files alike). Kerbalism's own crediting bypasses the stock
    /// TransactionReasons path entirely (a pooled, vessel-less AddScience(None) buffer flush), so
    /// the stock currency interceptor cannot see it - this hook is the only way Kerbalism science
    /// gets delayed at all. Each retrieved increment is handed to
    /// <see cref="DelayedScienceSink.RecordDelayedScienceIncrement"/> as plain (vesselId, vessel,
    /// amount, ut) values; the currency-delay core owns the aggregator, ledger, and light-time.
    ///
    /// Absent Kerbalism, <see cref="TryAttach"/> never finds the type, stays permanently
    /// unattached, and nothing else behaves differently.
    /// </summary>
    public sealed class KerbalismScienceHook
    {
        private const string HarmonyId = "gonogo.currencydelay.kerbalism";
        private const string SubjectDataTypeName = "KERBALISM.SubjectData";
        private const string RetrieveScienceMethodName = "RetrieveScience";
        private const string ApiTypeName = "KERBALISM.API";
        private const string PreventScienceCreditingFieldName = "preventScienceCrediting";
        private const string OriginDescription = "Kerbalism";

        // A retrieved increment with no attributable vessel: no case observed live, but not ruled
        // out for a third-party Kerbalism-integrated mod. Fed through with zero light-time rather
        // than dropped, since preventScienceCrediting means WE are now the only thing that can ever
        // credit it.
        private const string UnattributedVesselId = "kerbalism-unattributed";

        public bool Attached { get; private set; }

        /// <summary>
        /// Attempts to attach the postfix; idempotent once attached. The Uplink's own presence gate
        /// (<c>KerbalismReflection.IsAvailable</c>) already confirms Kerbalism is loaded before this
        /// runs, so the type lookup normally succeeds on the first call; it still returns false (no
        /// patch) rather than throwing if the target can't be resolved, and can be retried.
        /// </summary>
        public bool TryAttach()
        {
            if (Attached)
            {
                return true;
            }

            try
            {
                var subjectDataType = AccessTools.TypeByName(SubjectDataTypeName);
                if (subjectDataType == null)
                {
                    return false;
                }

                var target = AccessTools.Method(subjectDataType, RetrieveScienceMethodName);
                if (target == null)
                {
                    Debug.LogWarning("[Gonogo] KerbalismScienceHook: Kerbalism present but RetrieveScience not found - check signature");
                    return false;
                }

                var postfix = new HarmonyMethod(typeof(KerbalismScienceHook)
                    .GetMethod(nameof(RetrieveSciencePostfix), BindingFlags.Static | BindingFlags.NonPublic));
                new Harmony(HarmonyId).Patch(target, postfix: postfix);

                SetPreventScienceCrediting(true);

                Attached = true;
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] KerbalismScienceHook.TryAttach failed: " + ex.Message);
                return false;
            }
        }

        // Harmony injects __result (the method's RETURNED retrieved amount - the input scienceValue
        // argument is a tiny per-tick fraction, not the true credited figure) and matches fromVessel
        // by parameter name, so this compiles with no compile-time Kerbalism reference at all.
        private static void RetrieveSciencePostfix(double __result, ProtoVessel fromVessel)
        {
            if (__result <= 0.0)
            {
                return;
            }

            var vesselId = fromVessel != null ? fromVessel.vesselID.ToString() : UnattributedVesselId;
            DelayedScienceSink.RecordDelayedScienceIncrement(
                vesselId, fromVessel, __result, Planetarium.GetUniversalTime(), OriginDescription);
        }

        private static void SetPreventScienceCrediting(bool value)
        {
            var apiType = AccessTools.TypeByName(ApiTypeName);
            var field = apiType != null ? AccessTools.Field(apiType, PreventScienceCreditingFieldName) : null;
            if (field == null)
            {
                Debug.LogWarning("[Gonogo] KerbalismScienceHook: KERBALISM.API.preventScienceCrediting not found - Kerbalism may double-credit science");
                return;
            }
            field.SetValue(null, value);
        }
    }
}
