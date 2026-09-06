using System;
using System.Collections.Generic;
using System.Reflection;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The real plugin surface, bound to Principia's managed forwards by
    /// reflection so that this assembly still references no Principia assembly.
    ///
    /// <para><b>Why the managed forwards rather than the native exports.</b> Going
    /// through Principia's own <c>Interface</c> class means going through its
    /// marshallers, and several of these calls return native memory that has to be
    /// freed: the anomalous status and both orbit analyses each hand back a
    /// pointer whose ownership transfers to the caller. Principia's return
    /// marshallers free it. Binding the native exports directly by symbol would
    /// have meant reimplementing that, and a leak per read on a per-frame channel
    /// is a slow crash rather than no crash.</para>
    ///
    /// <para>Every name is checked against <see cref="PrincipiaCalls"/> before it
    /// is bound, and all of them are bound up front. Failing at construction rather
    /// than at the first call matters: the alternative is discovering halfway
    /// through a frame that a member moved, having already made calls whose
    /// preconditions were established against a shape that is no longer
    /// there.</para>
    /// </summary>
    internal sealed class ReflectedPrincipiaPlugin : IPrincipiaPlugin
    {
        /// <summary>Principia's static forwarder onto its native plugin.</summary>
        internal const string InterfaceTypeName = "principia.ksp_plugin_adapter.Interface";

        private static readonly ReflectedMembers Members = new ReflectedMembers();

        private readonly Dictionary<string, MethodInfo> _methods;
        private readonly string _writeBindFailure;

        private ReflectedPrincipiaPlugin(
            Dictionary<string, MethodInfo> methods, string writeBindFailure)
        {
            _methods = methods;
            _writeBindFailure = writeBindFailure;
        }

        /// <summary>
        /// Finds Principia's forwarder and binds every audited call, or fails with
        /// a reason naming what was missing.
        ///
        /// <para>Absent is the ordinary case, not an error: Principia is optional
        /// and everything above degrades to publishing nothing without it.</para>
        /// </summary>
        internal static bool TryBind(out ReflectedPrincipiaPlugin? plugin, out string reason)
        {
            plugin = null;

            Type? forwarder;
            try
            {
                forwarder = FindInterfaceType();
            }
            catch (Exception ex)
            {
                reason = "could not enumerate assemblies for Principia: " + ex.Message;
                return false;
            }

            if (forwarder == null)
            {
                reason = "Principia not loaded";
                return false;
            }

            var methods = new Dictionary<string, MethodInfo>();
            var missing = new List<string>();
            foreach (var name in PrincipiaCalls.Allowed)
            {
                var method = BindMethod(forwarder, name);
                if (method == null)
                {
                    missing.Add(name);
                    continue;
                }
                methods[name] = method;
            }

            if (missing.Count > 0)
            {
                reason =
                    "Principia's plugin interface is not the shape this Uplink was audited "
                    + "against; could not bind: " + string.Join(", ", missing.ToArray());
                return false;
            }

            // The write half binds SEPARATELY and its failure is not this method's
            // failure. A producer build whose write entry points moved must still
            // be readable, so a missing write leaves the read surface intact and
            // fails the write surface closed with a reason an operator can read.
            var writeFailure = BindWrites(forwarder, methods);

            plugin = new ReflectedPrincipiaPlugin(methods, writeFailure);
            reason = string.Empty;
            return true;
        }

        /// <summary>
        /// Binds every audited write and the one read that exists to guard them,
        /// returning the empty string on success or the reason on failure.
        /// </summary>
        private static string BindWrites(Type forwarder, Dictionary<string, MethodInfo> methods)
        {
            var missing = new List<string>();
            foreach (var name in PrincipiaWriteCalls.Allowed)
            {
                var method = BindWriteMethod(forwarder, name);
                if (method == null)
                {
                    missing.Add(name);
                    continue;
                }
                methods[name] = method;
            }
            foreach (var name in PrincipiaWriteCalls.AllowedReads)
            {
                var method = BindWriteMethod(forwarder, name);
                if (method == null)
                {
                    missing.Add(name);
                    continue;
                }
                methods[name] = method;
            }

            return missing.Count == 0
                ? string.Empty
                : "Principia's flight-plan write entry points are not the shape this Uplink was "
                    + "audited against; could not bind: " + string.Join(", ", missing.ToArray())
                    + ". The plan stays readable and no edit will be attempted.";
        }

        /// <summary>
        /// Resolves one audited WRITE, through the write register rather than the
        /// read one.
        ///
        /// <para>The read register screens every name carrying a write verb and
        /// refuses it with "this Uplink only reads", which is exactly the guard that
        /// should stay in place: a write must be asked for through this door, so
        /// nobody acquires one by adding a name to the read allowlist.</para>
        /// </summary>
        internal static MethodInfo? BindWriteMethod(Type forwarder, string name)
        {
            PrincipiaWriteCalls.RequireAllowed(name);

            MethodInfo? found = null;
            foreach (var candidate in forwarder.GetMethods(
                BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic))
            {
                if (!string.Equals(candidate.Name, name, StringComparison.Ordinal))
                {
                    continue;
                }
                if (found != null)
                {
                    return null;
                }
                found = candidate;
            }
            return found;
        }

        /// <summary>
        /// Resolves one audited call, refusing before it looks at all if the name
        /// is not one this assembly may bind.
        ///
        /// <para>The refusal comes first so that it holds even when the type is
        /// absent. A guard that only fires once the mod is installed is a guard
        /// that never fires in a test.</para>
        ///
        /// <para>Ambiguity is a bind failure rather than a pick. Every one of these
        /// names is unique on the forwarder today, and a release that overloads one
        /// has changed the shape we audited.</para>
        /// </summary>
        internal static MethodInfo? BindMethod(Type forwarder, string name)
        {
            PrincipiaCalls.RequireAllowed(name);

            MethodInfo? found = null;
            foreach (var candidate in forwarder.GetMethods(
                BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic))
            {
                if (!string.Equals(candidate.Name, name, StringComparison.Ordinal))
                {
                    continue;
                }
                if (found != null)
                {
                    return null;
                }
                found = candidate;
            }
            return found;
        }

        private static Type? FindInterfaceType()
        {
            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                if (assembly == null)
                {
                    continue;
                }
                string? assemblyName;
                try
                {
                    assemblyName = assembly.GetName().Name;
                }
                catch (Exception)
                {
                    continue;
                }
                if (!string.Equals(
                        assemblyName,
                        PrincipiaVersionGuard.AssemblyName,
                        StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                return assembly.GetType(InterfaceTypeName, throwOnError: false);
            }
            return null;
        }

        public bool GetVersion(out string? buildDate, out string? version, out string? platform)
        {
            var args = new object?[3];
            _methods["GetVersion"].Invoke(null, args);
            buildDate = args[0] as string;
            version = args[1] as string;
            platform = args[2] as string;
            return true;
        }

        public double CurrentTime(IntPtr plugin) => Double("CurrentTime", plugin);

        public bool HasVessel(IntPtr plugin, string vesselGuid) =>
            Bool("HasVessel", plugin, vesselGuid);

        public PrincipiaVector VesselVelocity(IntPtr plugin, string vesselGuid) =>
            Vector(Call("VesselVelocity", plugin, vesselGuid));

        public PrincipiaVector VesselTangent(IntPtr plugin, string vesselGuid) =>
            Vector(Call("VesselTangent", plugin, vesselGuid));

        public PrincipiaVector VesselNormal(IntPtr plugin, string vesselGuid) =>
            Vector(Call("VesselNormal", plugin, vesselGuid));

        public PrincipiaVector VesselBinormal(IntPtr plugin, string vesselGuid) =>
            Vector(Call("VesselBinormal", plugin, vesselGuid));

        public object? VesselGetPredictionAdaptiveStepParameters(IntPtr plugin, string vesselGuid) =>
            Call("VesselGetPredictionAdaptiveStepParameters", plugin, vesselGuid);

        /// <summary>
        /// The two nulls are the recurrence pointers, and they are written here
        /// rather than taken as parameters.
        ///
        /// <para>Principia requires them to agree, and a non-null pair is an
        /// operator's nominal orbit to compare the fit against rather than a way of
        /// asking for the fit. Nothing here wants to compare against a nominal, so
        /// the pair is written once as null and the caller cannot get it wrong.
        /// Null does NOT forfeit the recurrence: Principia falls back to the one it
        /// fitted during the analysis.</para>
        /// </summary>
        public object? VesselGetAnalysis(IntPtr plugin, string vesselGuid, int groundTrackRevolution) =>
            Call("VesselGetAnalysis", plugin, vesselGuid, null, null, groundTrackRevolution);

        public bool FlightPlanExists(IntPtr plugin, string vesselGuid) =>
            Bool("FlightPlanExists", plugin, vesselGuid);

        public int FlightPlanCount(IntPtr plugin, string vesselGuid) =>
            Int("FlightPlanCount", plugin, vesselGuid);

        public int FlightPlanSelected(IntPtr plugin, string vesselGuid) =>
            Int("FlightPlanSelected", plugin, vesselGuid);

        public double FlightPlanGetInitialTime(IntPtr plugin, string vesselGuid) =>
            Double("FlightPlanGetInitialTime", plugin, vesselGuid);

        public double FlightPlanGetDesiredFinalTime(IntPtr plugin, string vesselGuid) =>
            Double("FlightPlanGetDesiredFinalTime", plugin, vesselGuid);

        public double FlightPlanGetActualFinalTime(IntPtr plugin, string vesselGuid) =>
            Double("FlightPlanGetActualFinalTime", plugin, vesselGuid);

        public object? FlightPlanGetAnomalousStatus(IntPtr plugin, string vesselGuid) =>
            Call("FlightPlanGetAnomalousStatus", plugin, vesselGuid);

        public object? FlightPlanGetAdaptiveStepParameters(IntPtr plugin, string vesselGuid) =>
            Call("FlightPlanGetAdaptiveStepParameters", plugin, vesselGuid);

        public int FlightPlanNumberOfManoeuvres(IntPtr plugin, string vesselGuid) =>
            Int("FlightPlanNumberOfManoeuvres", plugin, vesselGuid);

        public int FlightPlanNumberOfSegments(IntPtr plugin, string vesselGuid) =>
            Int("FlightPlanNumberOfSegments", plugin, vesselGuid);

        public int FlightPlanNumberOfAnomalousManoeuvres(IntPtr plugin, string vesselGuid) =>
            Int("FlightPlanNumberOfAnomalousManoeuvres", plugin, vesselGuid);

        public object? FlightPlanGetCoastAnalysis(
            IntPtr plugin, string vesselGuid, int groundTrackRevolution, int coastIndex) =>
            Call(
                "FlightPlanGetCoastAnalysis",
                plugin, vesselGuid, null, null, groundTrackRevolution, coastIndex);

        public object? FlightPlanGetManoeuvre(IntPtr plugin, string vesselGuid, int index) =>
            Call("FlightPlanGetManoeuvre", plugin, vesselGuid, index);

        public object? FlightPlanGetManoeuvreFrenetTrihedron(
            IntPtr plugin, string vesselGuid, int index) =>
            Call("FlightPlanGetManoeuvreFrenetTrihedron", plugin, vesselGuid, index);

        public PrincipiaVector FlightPlanGetGuidance(IntPtr plugin, string vesselGuid, int index) =>
            Vector(Call("FlightPlanGetGuidance", plugin, vesselGuid, index));

        public PrincipiaVector FlightPlanGetManoeuvreInitialPlottedVelocity(
            IntPtr plugin, string vesselGuid, int index) =>
            Vector(Call("FlightPlanGetManoeuvreInitialPlottedVelocity", plugin, vesselGuid, index));

        /// <summary>
        /// Both iterator reads go through the producer's own extension methods on
        /// the same forwarder as everything else, so its custom marshaller is what
        /// turns the managed handle back into the native pointer. Binding the
        /// export by symbol would have meant reimplementing that marshaller for one
        /// argument type.
        /// </summary>
        public bool IteratorAtEnd(object iterator) => Bool("IteratorAtEnd", iterator);

        public object? IteratorGetPlottableElements(object iterator) =>
            Call("IteratorGetPlottableElements", iterator);

        public bool WritesBound(out string reason)
        {
            reason = _writeBindFailure;
            return _writeBindFailure.Length == 0;
        }

        public int FlightPlanOptimizationDriverInProgress(IntPtr plugin, string vesselGuid) =>
            Int("FlightPlanOptimizationDriverInProgress", plugin, vesselGuid);

        /// <summary>
        /// Read off the bound method rather than looked up by name, so it is the
        /// type this build's own <c>FlightPlanInsert</c> accepts and cannot drift
        /// from it.
        /// </summary>
        public Type? BurnType()
        {
            if (!_methods.TryGetValue("FlightPlanInsert", out var method))
            {
                return null;
            }
            var parameters = method.GetParameters();
            // (plugin, vesselGuid, burn, index): the burn is the third.
            return parameters.Length >= 3 ? parameters[2].ParameterType : null;
        }

        public object? FlightPlanInsert(IntPtr plugin, string vesselGuid, object burn, int index) =>
            Call("FlightPlanInsert", plugin, vesselGuid, burn, index);

        public object? FlightPlanReplace(IntPtr plugin, string vesselGuid, object burn, int index) =>
            Call("FlightPlanReplace", plugin, vesselGuid, burn, index);

        public object? FlightPlanRemove(IntPtr plugin, string vesselGuid, int index) =>
            Call("FlightPlanRemove", plugin, vesselGuid, index);

        public object? FlightPlanSetDesiredFinalTime(
            IntPtr plugin, string vesselGuid, double finalTime) =>
            Call("FlightPlanSetDesiredFinalTime", plugin, vesselGuid, finalTime);

        public object? FlightPlanSetAdaptiveStepParameters(
            IntPtr plugin, string vesselGuid, object parameters) =>
            Call("FlightPlanSetAdaptiveStepParameters", plugin, vesselGuid, parameters);

        public void FlightPlanCreate(
            IntPtr plugin, string vesselGuid, double finalTime, double massInTonnes) =>
            Call("FlightPlanCreate", plugin, vesselGuid, finalTime, massInTonnes);

        public void FlightPlanDelete(IntPtr plugin, string vesselGuid) =>
            Call("FlightPlanDelete", plugin, vesselGuid);

        public void FlightPlanDuplicate(IntPtr plugin, string vesselGuid) =>
            Call("FlightPlanDuplicate", plugin, vesselGuid);

        private object? Call(string name, params object?[] args) =>
            _methods[name].Invoke(null, args);

        private double Double(string name, params object?[] args) =>
            Call(name, args) is double value ? value : 0.0;

        private int Int(string name, params object?[] args) =>
            Call(name, args) is int value ? value : 0;

        private bool Bool(string name, params object?[] args) =>
            Call(name, args) is bool value && value;

        /// <summary>
        /// Decodes Principia's three-double vector by reading its fields.
        ///
        /// <para>Fields, not properties: a field read runs none of the producer's
        /// code, which is the distinction <see cref="ReflectedMembers"/> exists to
        /// enforce.</para>
        /// </summary>
        private static PrincipiaVector Vector(object? xyz) =>
            xyz == null
                ? default
                : new PrincipiaVector(
                    Members.ReadDouble(xyz, "x") ?? 0.0,
                    Members.ReadDouble(xyz, "y") ?? 0.0,
                    Members.ReadDouble(xyz, "z") ?? 0.0);
    }
}
