using System;
using System.Collections.Generic;
using GonogoPrincipiaUplink;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// Stands in for the abort. Thrown by <see cref="FakePrincipiaPlugin"/> where
    /// the real plugin would call <c>abort()</c> and the player's KSP would vanish.
    ///
    /// <para>A double that quietly returned a value for an unlicensed read would be
    /// useless here: the entire failure this layer exists to prevent is invisible
    /// at the call site and produces a plausible number right up to the moment it
    /// produces no process. If the double cannot express it, no test can find
    /// it.</para>
    /// </summary>
    public sealed class PrincipiaWouldHaveAbortedException : Exception
    {
        public PrincipiaWouldHaveAbortedException(string message)
            : base("Principia would have aborted the process: " + message)
        {
        }
    }

    /// <summary>What the fake plugin knows about one vessel.</summary>
    public sealed class FakePluginVessel
    {
        public bool HasFlightPlan { get; set; }
        public int Manoeuvres { get; set; }
        public int Segments { get; set; }
    }

    /// <summary>
    /// A plugin that records every call in order and faults exactly where the real
    /// one aborts.
    ///
    /// <para><b>It models the plugin's rules, not the protocol's.</b> It does not
    /// ask whether the caller remembered a precondition; it asks whether the guid
    /// is one it knows, whether the vessel has a plan, whether the index is in
    /// range, whether the handle is the current one. Those are the four things the
    /// native side actually checks, and phrasing the double that way means a test
    /// cannot pass by remembering to tell the double what the code under test was
    /// about to do.</para>
    ///
    /// <para>The recorded call list is what lets a test assert the ORDER rather
    /// than merely the result. "The read returned a number" is satisfied by a read
    /// that never checked anything; "HasVessel preceded it, and nothing was called
    /// at all after the vessel went away" is not.</para>
    /// </summary>
    internal sealed class FakePrincipiaPlugin : IPrincipiaPlugin
    {
        private readonly Dictionary<string, FakePluginVessel> _vessels =
            new Dictionary<string, FakePluginVessel>(StringComparer.Ordinal);

        /// <summary>Every call made, in order, with the arguments that decide
        /// whether it aborts.</summary>
        public List<string> Calls { get; } = new List<string>();

        /// <summary>The handle the plugin currently answers to. Anything else is a
        /// pointer into freed memory as far as the real one is concerned.</summary>
        public IntPtr Handle { get; set; } = new IntPtr(0x9001);

        public string? Version { get; set; } = PrincipiaSession.AnalysedPluginVersion;

        public string? BuildDate { get; set; } = "2026-08-12T17:36:45Z";

        public string? Platform { get; set; } = "Linux x86-64";

        public bool VersionReadable { get; set; } = true;

        /// <summary>Adds a vessel the plugin knows about.</summary>
        public FakePluginVessel Add(string guid, bool hasFlightPlan = false, int manoeuvres = 0)
        {
            var vessel = new FakePluginVessel
            {
                HasFlightPlan = hasFlightPlan,
                Manoeuvres = manoeuvres,
                // The shape Principia's plans have: a coast, then burn-and-coast
                // per manoeuvre.
                Segments = (2 * manoeuvres) + 1,
            };
            _vessels[guid] = vessel;
            return vessel;
        }

        /// <summary>Removes a vessel, as recovery or destruction does. Every guid
        /// call for it is an abort from here on.</summary>
        public void Destroy(string guid) => _vessels.Remove(guid);

        /// <summary>Replaces the handle, as a deserialise or a plugin reset does.</summary>
        public void ReplaceHandle() => Handle = new IntPtr(Handle.ToInt64() + 1);

        public bool GetVersion(out string? buildDate, out string? version, out string? platform)
        {
            Calls.Add("GetVersion");
            buildDate = BuildDate;
            version = Version;
            platform = Platform;
            return VersionReadable;
        }

        public double CurrentTime(IntPtr plugin)
        {
            Record("CurrentTime", plugin);
            return 1000.0;
        }

        /// <summary>
        /// The one call that tolerates an unknown guid, so it never faults on one.
        /// </summary>
        public bool HasVessel(IntPtr plugin, string vesselGuid)
        {
            Record("HasVessel", plugin, vesselGuid);
            return _vessels.ContainsKey(vesselGuid);
        }

        public PrincipiaVector VesselVelocity(IntPtr plugin, string vesselGuid)
        {
            Vessel("VesselVelocity", plugin, vesselGuid);
            return new PrincipiaVector(1.0, 2.0, 3.0);
        }

        public PrincipiaVector VesselTangent(IntPtr plugin, string vesselGuid)
        {
            Vessel("VesselTangent", plugin, vesselGuid);
            return new PrincipiaVector(1.0, 0.0, 0.0);
        }

        public PrincipiaVector VesselNormal(IntPtr plugin, string vesselGuid)
        {
            Vessel("VesselNormal", plugin, vesselGuid);
            return new PrincipiaVector(0.0, 1.0, 0.0);
        }

        public PrincipiaVector VesselBinormal(IntPtr plugin, string vesselGuid)
        {
            Vessel("VesselBinormal", plugin, vesselGuid);
            return new PrincipiaVector(0.0, 0.0, 1.0);
        }

        public object? VesselGetPredictionAdaptiveStepParameters(IntPtr plugin, string vesselGuid)
        {
            Vessel("VesselGetPredictionAdaptiveStepParameters", plugin, vesselGuid);
            return "prediction-step-parameters";
        }

        public object? VesselGetAnalysis(IntPtr plugin, string vesselGuid, int groundTrackRevolution)
        {
            Vessel("VesselGetAnalysis", plugin, vesselGuid, groundTrackRevolution);
            return "orbit-analysis";
        }

        public bool FlightPlanExists(IntPtr plugin, string vesselGuid) =>
            Vessel("FlightPlanExists", plugin, vesselGuid).HasFlightPlan;

        public int FlightPlanCount(IntPtr plugin, string vesselGuid) =>
            Vessel("FlightPlanCount", plugin, vesselGuid).HasFlightPlan ? 1 : 0;

        public int FlightPlanSelected(IntPtr plugin, string vesselGuid) =>
            Vessel("FlightPlanSelected", plugin, vesselGuid).HasFlightPlan ? 0 : -1;

        public double FlightPlanGetInitialTime(IntPtr plugin, string vesselGuid)
        {
            Plan("FlightPlanGetInitialTime", plugin, vesselGuid);
            return 2000.0;
        }

        public double FlightPlanGetDesiredFinalTime(IntPtr plugin, string vesselGuid)
        {
            Plan("FlightPlanGetDesiredFinalTime", plugin, vesselGuid);
            return 9000.0;
        }

        public double FlightPlanGetActualFinalTime(IntPtr plugin, string vesselGuid)
        {
            Plan("FlightPlanGetActualFinalTime", plugin, vesselGuid);
            return 8000.0;
        }

        public object? FlightPlanGetAnomalousStatus(IntPtr plugin, string vesselGuid)
        {
            Plan("FlightPlanGetAnomalousStatus", plugin, vesselGuid);
            return "status";
        }

        public object? FlightPlanGetAdaptiveStepParameters(IntPtr plugin, string vesselGuid)
        {
            Plan("FlightPlanGetAdaptiveStepParameters", plugin, vesselGuid);
            return "plan-step-parameters";
        }

        public int FlightPlanNumberOfManoeuvres(IntPtr plugin, string vesselGuid) =>
            Plan("FlightPlanNumberOfManoeuvres", plugin, vesselGuid).Manoeuvres;

        public int FlightPlanNumberOfSegments(IntPtr plugin, string vesselGuid) =>
            Plan("FlightPlanNumberOfSegments", plugin, vesselGuid).Segments;

        public int FlightPlanNumberOfAnomalousManoeuvres(IntPtr plugin, string vesselGuid)
        {
            Plan("FlightPlanNumberOfAnomalousManoeuvres", plugin, vesselGuid);
            return 0;
        }

        /// <summary>Out of range answers null here, as the real one does: the coast
        /// index is the single place on this surface that does not abort.</summary>
        public object? FlightPlanGetCoastAnalysis(
            IntPtr plugin, string vesselGuid, int groundTrackRevolution, int coastIndex)
        {
            var vessel = Plan("FlightPlanGetCoastAnalysis", plugin, vesselGuid, coastIndex);
            return coastIndex >= 0 && coastIndex <= vessel.Manoeuvres ? "coast-analysis" : null;
        }

        public object? FlightPlanGetManoeuvre(IntPtr plugin, string vesselGuid, int index)
        {
            BurnIndex("FlightPlanGetManoeuvre", plugin, vesselGuid, index);
            return "manoeuvre-" + index;
        }

        public object? FlightPlanGetManoeuvreFrenetTrihedron(
            IntPtr plugin, string vesselGuid, int index)
        {
            BurnIndex("FlightPlanGetManoeuvreFrenetTrihedron", plugin, vesselGuid, index);
            return "trihedron-" + index;
        }

        public PrincipiaVector FlightPlanGetGuidance(IntPtr plugin, string vesselGuid, int index)
        {
            BurnIndex("FlightPlanGetGuidance", plugin, vesselGuid, index);
            return new PrincipiaVector(index, 0.0, 0.0);
        }

        /// <summary>
        /// Bounded by the SEGMENT count against a doubled index, exactly as the
        /// native one is, and not by the manoeuvre count that bounds its
        /// neighbours.
        /// </summary>
        public PrincipiaVector FlightPlanGetManoeuvreInitialPlottedVelocity(
            IntPtr plugin, string vesselGuid, int index)
        {
            var vessel = Plan(
                "FlightPlanGetManoeuvreInitialPlottedVelocity", plugin, vesselGuid, index);
            if (index < 0 || 2 * index >= vessel.Segments)
            {
                throw new PrincipiaWouldHaveAbortedException(
                    "segment index " + (2 * index) + " is outside 0.." + (vessel.Segments - 1));
            }
            return new PrincipiaVector(0.0, index, 0.0);
        }

        private void Record(string name, IntPtr plugin, params object?[] args)
        {
            var rendered = name;
            if (args.Length > 0)
            {
                rendered += "(" + string.Join(",", Array.ConvertAll(args, a => a?.ToString() ?? "null")) + ")";
            }
            Calls.Add(rendered);

            if (plugin == IntPtr.Zero)
            {
                throw new PrincipiaWouldHaveAbortedException(name + " called with a null handle");
            }
            if (plugin != Handle)
            {
                throw new PrincipiaWouldHaveAbortedException(
                    name + " called through handle " + plugin + ", which was replaced; the live "
                    + "handle is " + Handle);
            }
        }

        private FakePluginVessel Vessel(string name, IntPtr plugin, string guid, params object?[] rest)
        {
            var args = new object?[rest.Length + 1];
            args[0] = guid;
            Array.Copy(rest, 0, args, 1, rest.Length);
            Record(name, plugin, args);

            if (!_vessels.TryGetValue(guid, out var vessel))
            {
                throw new PrincipiaWouldHaveAbortedException(
                    name + " on guid '" + guid + "', which the plugin does not know");
            }
            return vessel;
        }

        private FakePluginVessel Plan(string name, IntPtr plugin, string guid, params object?[] rest)
        {
            var vessel = Vessel(name, plugin, guid, rest);
            if (!vessel.HasFlightPlan)
            {
                throw new PrincipiaWouldHaveAbortedException(
                    name + " on guid '" + guid + "', which has no flight plan");
            }
            return vessel;
        }

        private void BurnIndex(string name, IntPtr plugin, string guid, int index)
        {
            var vessel = Plan(name, plugin, guid, index);
            if (index < 0 || index >= vessel.Manoeuvres)
            {
                throw new PrincipiaWouldHaveAbortedException(
                    name + " at index " + index + ", outside 0.." + (vessel.Manoeuvres - 1));
            }
        }
    }

    /// <summary>The handle source, wired to the fake plugin so that replacing the
    /// handle mid-frame is expressible.</summary>
    internal sealed class FakePluginHandle : IPrincipiaPluginHandle
    {
        private readonly FakePrincipiaPlugin _plugin;

        public FakePluginHandle(FakePrincipiaPlugin plugin)
        {
            _plugin = plugin;
        }

        /// <summary>When true, the addon is gone and there is no plugin at all.</summary>
        public bool Absent { get; set; }

        public IntPtr Current() => Absent ? IntPtr.Zero : _plugin.Handle;
    }
}
