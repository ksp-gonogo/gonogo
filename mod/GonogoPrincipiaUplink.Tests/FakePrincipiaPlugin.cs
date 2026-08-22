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

        /// <summary>Derived from the burn list rather than tracked beside it: two
        /// sources for "how many burns" is how a write that changed one and not the
        /// other passes.</summary>
        public int Manoeuvres => Burns.Count;

        public int Segments { get; set; }

        /// <summary>
        /// How many plans the vessel holds. Not capped here, deliberately: nothing
        /// native caps it either, and a double that enforced the cap would make our
        /// own cap untestable while looking like it had been tested.
        /// </summary>
        public int Plans { get; set; }

        public int SelectedPlan { get; set; } = -1;

        /// <summary>
        /// The plan's burns, as objects rather than a count, so a round trip is a
        /// real one. Kept in step with <see cref="Manoeuvres"/> by the write half.
        /// </summary>
        public List<FakeManoeuvre> Burns { get; } = new List<FakeManoeuvre>();

        public FakeStepParameters StepParameters { get; set; } = FakeStepParameters.Shipped();

        /// <summary>Which burn the optimiser is working on, or -1. The producer's own
        /// interface answers exactly this.</summary>
        public int OptimisingBurn { get; set; } = -1;
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
                // The shape Principia's plans have: a coast, then burn-and-coast
                // per manoeuvre.
                Segments = (2 * manoeuvres) + 1,
                Plans = hasFlightPlan ? 1 : 0,
                SelectedPlan = hasFlightPlan ? 0 : -1,
            };
            for (var i = 0; i < manoeuvres; i++)
            {
                // Ignition well after the fake's CurrentTime, so a burn is in the
                // future unless a test deliberately moves it.
                vessel.Burns.Add(
                    new FakeManoeuvre { final_time = 3000.0 + (i * 1000.0) }
                    .WithIgnition(2000.0 + (i * 1000.0)));
            }
            _vessels[guid] = vessel;
            return vessel;
        }

        /// <summary>
        /// A vessel already added, for a test that wants to inspect or arrange its
        /// state.
        ///
        /// <para>Separate from <see cref="Add"/> because <c>Add</c> REPLACES: a test
        /// reaching for it as a getter silently resets the plan it was about to
        /// assert on, which reads as a bug in the code under test.</para>
        /// </summary>
        public FakePluginVessel Known(string guid) => _vessels[guid];

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
            return CurrentTimeValue;
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

        /// <summary>
        /// What the interchange reads hand back, settable so a mapping test can
        /// supply a struct-shaped stand-in.
        ///
        /// <para>Defaulted to opaque strings on purpose. A test about call ORDER
        /// should not have to describe a payload, and a string is the shape that
        /// makes it obvious the value was never meant to be read: a mapping bug
        /// that reached for a member here would find nothing rather than find a
        /// plausible default.</para>
        /// </summary>
        public object? PredictionStepParameters { get; set; } = "prediction-step-parameters";

        /// <summary>
        /// An override for the flight plan's own integrator bound.
        ///
        /// <para>Null by default, so the plan answers with the VESSEL's own struct
        /// and a write to it is observable in a later read. Set it to an opaque value
        /// when the test is about call order and the payload should be visibly
        /// unread.</para>
        /// </summary>
        public object? PlanStepParameters { get; set; }

        /// <summary>As above, per burn index. A missing index answers the opaque
        /// default, so an over-read is visible rather than absorbed.</summary>
        public Dictionary<int, object?> Manoeuvres { get; } = new Dictionary<int, object?>();

        public object? VesselGetPredictionAdaptiveStepParameters(IntPtr plugin, string vesselGuid)
        {
            Vessel("VesselGetPredictionAdaptiveStepParameters", plugin, vesselGuid);
            return PredictionStepParameters;
        }

        public object? VesselGetAnalysis(IntPtr plugin, string vesselGuid, int groundTrackRevolution)
        {
            Vessel("VesselGetAnalysis", plugin, vesselGuid, groundTrackRevolution);
            return "orbit-analysis";
        }

        public bool FlightPlanExists(IntPtr plugin, string vesselGuid) =>
            Vessel("FlightPlanExists", plugin, vesselGuid).HasFlightPlan;

        public int FlightPlanCount(IntPtr plugin, string vesselGuid) =>
            Vessel("FlightPlanCount", plugin, vesselGuid).Plans;

        public int FlightPlanSelected(IntPtr plugin, string vesselGuid) =>
            Vessel("FlightPlanSelected", plugin, vesselGuid).SelectedPlan;

        public double FlightPlanGetInitialTime(IntPtr plugin, string vesselGuid)
        {
            Plan("FlightPlanGetInitialTime", plugin, vesselGuid);
            return 2000.0;
        }

        public double FlightPlanGetDesiredFinalTime(IntPtr plugin, string vesselGuid)
        {
            Plan("FlightPlanGetDesiredFinalTime", plugin, vesselGuid);
            return DesiredFinalTime;
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
            var vessel = Plan("FlightPlanGetAdaptiveStepParameters", plugin, vesselGuid);
            // Boxing a struct copies it, so the caller gets its own box and cannot
            // reach the fake's state without going back through the write, which is
            // how the producer's marshaller behaves too.
            return PlanStepParameters ?? (object)vessel.StepParameters;
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

        /// <summary>
        /// A FRESH object every call, as the producer's marshaller hands back.
        ///
        /// <para>The copy is what makes the round-trip probe meaningful: a double
        /// returning the same instance would let the probe pass by identity without
        /// the write path ever having been exercised, which is the one thing the
        /// probe exists to rule out.</para>
        /// </summary>
        public object? FlightPlanGetManoeuvre(IntPtr plugin, string vesselGuid, int index)
        {
            var vessel = Plan("FlightPlanGetManoeuvre", plugin, vesselGuid, index);
            if (Manoeuvres.TryGetValue(index, out var manoeuvre))
            {
                return manoeuvre;
            }
            if (index < 0 || index >= vessel.Burns.Count)
            {
                throw new PrincipiaWouldHaveAbortedException(
                    "FlightPlanGetManoeuvre at index " + index + ", outside 0.."
                    + (vessel.Burns.Count - 1));
            }
            var copy = vessel.Burns[index].Copy();
            if (MisreadsThrustAfterAWrite && Writes.Count > 0)
            {
                copy.burn.thrust_in_kilonewtons *= 2.0;
            }
            return copy;
        }

        /// <summary>
        /// When true, a burn READ BACK after a write comes back with one field
        /// changed, which is what a struct-layout mismatch on one platform looks like
        /// from the managed side: nothing throws, nothing fails to resolve, and the
        /// value is plausible.
        ///
        /// <para>The corruption starts at the first write rather than at the first
        /// read, because that is where a layout mismatch bites: the read that
        /// composed the burn was fine, the marshalling out was not, and the
        /// difference is only visible by comparing the two readings.</para>
        /// </summary>
        public bool MisreadsThrustAfterAWrite { get; set; }

        /// <summary>Every write the fake was asked to make, in order, so a test can
        /// assert that a refusal reached the plugin zero times.</summary>
        public List<string> Writes { get; } = new List<string>();

        /// <summary>What <see cref="WritesBound"/> answers, so the fail-closed path
        /// is reachable without a Principia install.</summary>
        public bool WriteEntryPointsBound { get; set; } = true;

        public string WriteBindFailure { get; set; } =
            "Principia's flight-plan write entry points are not the shape this Uplink was audited "
            + "against.";

        public bool WritesBound(out string reason)
        {
            reason = WriteEntryPointsBound ? string.Empty : WriteBindFailure;
            return WriteEntryPointsBound;
        }

        public int FlightPlanOptimizationDriverInProgress(IntPtr plugin, string vesselGuid) =>
            Plan("FlightPlanOptimizationDriverInProgress", plugin, vesselGuid).OptimisingBurn;

        /// <summary>Insert accepts an index EQUAL to the count, which appends.</summary>
        public object? FlightPlanInsert(IntPtr plugin, string vesselGuid, object burn, int index)
        {
            var vessel = Plan("FlightPlanInsert", plugin, vesselGuid, index);
            if (index < 0 || index > vessel.Burns.Count)
            {
                throw new PrincipiaWouldHaveAbortedException(
                    "FlightPlanInsert at index " + index + ", outside 0.." + vessel.Burns.Count);
            }
            Writes.Add("Insert@" + index);
            vessel.Burns.Insert(index, Adopt(burn));
            vessel.Segments = (2 * vessel.Burns.Count) + 1;
            return Status;
        }

        /// <summary>Replace aborts on an index equal to the count, unlike insert.</summary>
        public object? FlightPlanReplace(IntPtr plugin, string vesselGuid, object burn, int index)
        {
            var vessel = Plan("FlightPlanReplace", plugin, vesselGuid, index);
            if (index < 0 || index >= vessel.Burns.Count)
            {
                throw new PrincipiaWouldHaveAbortedException(
                    "FlightPlanReplace at index " + index + ", outside 0.."
                    + (vessel.Burns.Count - 1));
            }
            Writes.Add("Replace@" + index);
            var existing = vessel.Burns[index];
            vessel.Burns[index] = new FakeManoeuvre
            {
                burn = Adopt(burn).burn,
                initial_mass_in_tonnes = existing.initial_mass_in_tonnes,
                final_mass_in_tonnes = existing.final_mass_in_tonnes,
                mass_flow = existing.mass_flow,
                duration = existing.duration,
                final_time = existing.final_time,
                time_to_half_delta_v = existing.time_to_half_delta_v,
            };
            return Status;
        }

        public object? FlightPlanRemove(IntPtr plugin, string vesselGuid, int index)
        {
            var vessel = Plan("FlightPlanRemove", plugin, vesselGuid, index);
            if (index < 0 || index >= vessel.Burns.Count)
            {
                throw new PrincipiaWouldHaveAbortedException(
                    "FlightPlanRemove at index " + index + ", outside 0.."
                    + (vessel.Burns.Count - 1));
            }
            Writes.Add("Remove@" + index);
            vessel.Burns.RemoveAt(index);
            vessel.Segments = (2 * vessel.Burns.Count) + 1;
            return Status;
        }

        public object? FlightPlanSetDesiredFinalTime(
            IntPtr plugin, string vesselGuid, double finalTime)
        {
            Plan("FlightPlanSetDesiredFinalTime", plugin, vesselGuid, finalTime);
            Writes.Add("SetDesiredFinalTime@" + finalTime);
            DesiredFinalTime = finalTime;
            return Status;
        }

        /// <summary>The plan's end instant, moved by a write so a receipt's re-read
        /// can show it moving.</summary>
        public double DesiredFinalTime { get; set; } = 9000.0;

        public object? FlightPlanSetAdaptiveStepParameters(
            IntPtr plugin, string vesselGuid, object parameters)
        {
            var vessel = Plan("FlightPlanSetAdaptiveStepParameters", plugin, vesselGuid);
            Writes.Add("SetAdaptiveStepParameters");
            if (parameters is FakeStepParameters typed)
            {
                if (typed.integrator_kind != 1
                    || (typed.generalized_integrator_kind != 2
                        && typed.generalized_integrator_kind != 4))
                {
                    throw new PrincipiaWouldHaveAbortedException(
                        "integrator kinds " + typed.integrator_kind + " and "
                        + typed.generalized_integrator_kind + " are not a pair this build's "
                        + "equations accept, and the real one aborts with no message");
                }
                vessel.StepParameters = typed;
            }
            return Status;
        }

        /// <summary>
        /// No cap, and no abort on an existing plan: the real one appends and
        /// selects, which is why refusing that is OUR job. It DOES abort on an end
        /// instant before now, as the real one asserts.
        /// </summary>
        public void FlightPlanCreate(
            IntPtr plugin, string vesselGuid, double finalTime, double massInTonnes)
        {
            var vessel = Vessel("FlightPlanCreate", plugin, vesselGuid, finalTime, massInTonnes);
            if (finalTime < CurrentTimeValue)
            {
                throw new PrincipiaWouldHaveAbortedException(
                    "FlightPlanCreate with a final time of " + finalTime + " before the vessel's "
                    + "present of " + CurrentTimeValue);
            }
            Writes.Add("Create@" + finalTime);
            vessel.HasFlightPlan = true;
            vessel.Plans++;
            vessel.SelectedPlan = vessel.Plans - 1;
        }

        /// <summary>
        /// Models the UNDEFINED BEHAVIOUR, not the header comment.
        ///
        /// <para>Principia's own declaration promises this performs no action unless
        /// a plan exists. Its body contains no such test and erases an iterator one
        /// before the start of its vector. There is no abort to model and no log line
        /// to find, so the double raises the loudest thing available: a test that
        /// reaches this line has found the hole the header comment hides.</para>
        /// </summary>
        public void FlightPlanDelete(IntPtr plugin, string vesselGuid)
        {
            var vessel = Vessel("FlightPlanDelete", plugin, vesselGuid);
            if (!vessel.HasFlightPlan)
            {
                throw new PrincipiaWouldHaveAbortedException(
                    "FlightPlanDelete on a vessel with no plan is undefined behaviour: it erases "
                    + "flight_plans_.begin() + -1. The header comment says it is safe and the body "
                    + "does not test");
            }
            Writes.Add("Delete");
            vessel.Plans--;
            vessel.HasFlightPlan = vessel.Plans > 0;
            vessel.SelectedPlan = vessel.Plans - 1;
            vessel.Burns.Clear();
        }

        /// <summary>No cap here either, for the same reason as create.</summary>
        public void FlightPlanDuplicate(IntPtr plugin, string vesselGuid)
        {
            var vessel = Plan("FlightPlanDuplicate", plugin, vesselGuid);
            Writes.Add("Duplicate");
            vessel.Plans++;
        }

        /// <summary>The status object the write entry points hand back. Settable so a
        /// test can make the producer DECLINE a write, which is a different fact from
        /// our refusing it.</summary>
        public object? Status { get; set; } = FakeStatus.Ok();

        /// <summary>The clock, so a test can place a burn in the past, in progress,
        /// or in the future without arithmetic at the call site.</summary>
        public double CurrentTimeValue { get; set; } = 1000.0;

        /// <summary>Takes ownership of a burn handed in, copying it as the
        /// producer's marshaller does on the way across.</summary>
        private static FakeManoeuvre Adopt(object burn) =>
            burn is FakeBurn typed
                ? new FakeManoeuvre { burn = typed.Copy() }
                : new FakeManoeuvre();

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
