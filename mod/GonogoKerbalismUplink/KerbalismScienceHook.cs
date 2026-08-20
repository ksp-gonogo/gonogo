using System;
using System.Reflection;
using HarmonyLib;
using Sitrep.Contract;
using UnityEngine;

namespace Gonogo.KerbalismUplink
{
    // Reaches the third-party Kerbalism assembly by reflection only (never a compile-time
    // reference - Kerbalism may not even be installed), and reads ProtoVessel/Planetarium, so it
    // builds against the KSP reference DLLs (KspManaged) plus 0Harmony (KspGameData). It is the ONE
    // place in the codebase that knows Kerbalism's science-crediting shape: everything downstream is
    // reached through the Kernel's source-agnostic IDelayedScienceSink.

    /// <summary>
    /// Presence-gated Harmony postfix on KERBALISM.SubjectData.RetrieveScience - the single choke
    /// point Kerbalism routes ALL of its own science crediting through (incremental transmission,
    /// vessel recovery, and lab-produced files alike). Kerbalism's own crediting bypasses the stock
    /// TransactionReasons path entirely (a pooled, vessel-less AddScience(None) buffer flush), so
    /// the stock currency interceptor cannot see it - this hook is the only way Kerbalism science
    /// gets delayed at all. Each retrieved increment is handed to
    /// <see cref="IDelayedScienceSink.RecordDelayedScienceIncrement"/> as plain (vesselId, amount,
    /// ut, origin) values; the currency-delay core owns the aggregator, ledger, and light-time.
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

        /// <summary>
        /// The Kernel the postfix resolves <see cref="IDelayedScienceSink"/> out of, captured from
        /// the host at <see cref="TryAttach"/>.
        ///
        /// <para><b>Why the Kernel and not the sink itself.</b> TryAttach runs inside this Uplink's
        /// <c>Register</c>, and <c>ChannelEngine.ResolveCapabilities()</c> runs only after EVERY
        /// uplink has registered: that ordering is what lets an Uplink register a provider for a
        /// capability core declared. So the capability descriptor exists at attach time but has no
        /// active instance yet, and resolving here would always return nothing. The rest of the
        /// codebase answers this the same way (see <c>VesselUplink.Register</c>'s action-groups and
        /// maneuver-plan resolvers, and <c>KspHost.SetActionGroupsBackendSource</c>): capture the
        /// Kernel, resolve per use. Per use rather than cached-on-first-hit for the reason those
        /// state too, a re-resolution is picked up without a restart.</para>
        ///
        /// <para>Static because a Harmony patch method must be static and so has no <c>this</c>.
        /// It is a pointer to the host's Kernel, installed by the one call site, not an ambient
        /// lookup: nothing here goes hunting for a global to find the engine.</para>
        /// </summary>
        private static Kernel? _kernel;

        public bool Attached { get; private set; }

        /// <summary>
        /// Attempts to attach the postfix; idempotent once attached. The Uplink's own presence gate
        /// (<c>KerbalismReflection.IsAvailable</c>) already confirms Kerbalism is loaded before this
        /// runs, so the type lookup normally succeeds on the first call; it still returns false (no
        /// patch) rather than throwing if the target can't be resolved, and can be retried.
        /// </summary>
        /// <param name="kernel">The host's capability Kernel: see <see cref="_kernel"/>.</param>
        public bool TryAttach(Kernel kernel)
        {
            _kernel = kernel ?? throw new ArgumentNullException(nameof(kernel));

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

            var sink = ElectedSink();
            if (sink == null)
            {
                return;
            }

            var vesselId = fromVessel != null ? fromVessel.vesselID.ToString() : UnattributedVesselId;
            sink.RecordDelayedScienceIncrement(
                vesselId, __result, Planetarium.GetUniversalTime(), OriginDescription);
        }

        /// <summary>
        /// The elected sink, or null when there is none to hand this increment to: before
        /// <c>ResolveCapabilities()</c> has run, or in an install where core did not declare the
        /// capability at all. Silently dropping is not a new hole, it is the behaviour the sink
        /// already had for an increment arriving with no live currency-delay scenario bound (at the
        /// main menu, say), and Kerbalism only credits science in flight, long after resolution.
        /// </summary>
        private static IDelayedScienceSink? ElectedSink()
        {
            var kernel = _kernel;
            if (kernel == null)
            {
                return null;
            }
            try
            {
                return kernel.Query<IDelayedScienceSink>(DelayedScienceCapability.CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
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
