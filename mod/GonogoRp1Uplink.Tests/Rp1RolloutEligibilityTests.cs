using System.Collections.Generic;
using System.Linq;
using RP0;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// Rollout ELIGIBILITY as it reaches the client: the two halves of "may this
    /// vehicle go to that pad", published so an operator can be offered a real
    /// choice instead of a control that can only be refused.
    ///
    /// <para>The two halves live at different levels on purpose and the tests
    /// follow that split. The PAD half is per-pad
    /// (<c>rp1.pads[].state</c> plus <c>hasVesselWaiting</c>); the VEHICLE half is
    /// per-complex and identical for every pad the complex owns
    /// (<c>rp1.warehouse[].rolloutRefusals</c>).</para>
    ///
    /// <para><b>The case that earns this file its place is
    /// <see cref="The_capture_and_the_launch_gate_agree_about_the_envelope"/>.</b>
    /// The envelope rule is now reproduced from fields TWICE in this assembly,
    /// once in the launch gate and once in the capture, because
    /// <c>MeetsFacilityRequirements</c> memoises onto <c>[Persistent]</c> fields
    /// and so cannot be invoked from a sampled read. Two copies of a rule drift.
    /// That test is the instrument that makes the drift visible instead of
    /// letting a widget and a gate quietly disagree about the same vehicle.</para>
    /// </summary>
    public class Rp1RolloutEligibilityTests : System.IDisposable
    {
        private readonly Rp1ScReflection _reflection = new Rp1ScReflection();
        private readonly Rp1LaunchGate _gate = new Rp1LaunchGate();

        public Rp1RolloutEligibilityTests() => Reset();

        public void Dispose() => Reset();

        private static void Reset()
        {
            SpaceCenterManagement.Instance = null;
            Funding.Instance = new Funding { Funds = 1_000_000.0 };
            KCTUtilities.Reset();
            CurrencyModifierQueryRP0.Reset();
        }

        /// <summary>One centre, one operational pad complex, one free pad.</summary>
        private static LaunchComplex Centre()
        {
            var lc = new LaunchComplex { Name = "LC-1", IsOperational = true, LcTypeValue = LaunchComplexType.Pad };
            lc.LaunchPads.Add(new LCLaunchPad { name = "LaunchPad" });
            var ksc = new LCSpaceCenter { KSCName = "Cape" };
            ksc.LaunchComplexes.Add(lc);
            SpaceCenterManagement.Instance = new SpaceCenterManagement { ActiveSC = ksc };
            SpaceCenterManagement.Instance.KSCs.Add(ksc);
            return lc;
        }

        private static VesselProject Built(LaunchComplex lc, string name = "Atlas")
        {
            var vp = new VesselProject
            {
                shipName = name,
                cost = 40_000f,
                mass = 50f,
                buildPoints = 1000.0,
                progress = 1000.0,
                ShipSize = new UnityEngine.Vector3(10f, 20f, 10f),
            };
            vp.SetComplex(lc);
            lc.Warehouse.Add(vp);
            return vp;
        }

        /// <summary>The warehouse row the capture publishes for a vehicle.</summary>
        private Dictionary<string, object?> WarehouseRow()
        {
            var raw = _reflection.Read(ut: 100.0);
            var rows = Rp1ScCapture.BuildWarehouse(raw);
            return Assert.IsType<Dictionary<string, object?>>(Assert.Single(rows));
        }

        /// <summary>The pad row the capture publishes.</summary>
        private Dictionary<string, object?> PadRow()
        {
            var raw = _reflection.Read(ut: 100.0);
            var rows = Rp1ScCapture.BuildPads(raw);
            return Assert.IsType<Dictionary<string, object?>>(Assert.Single(rows));
        }

        private static string[]? Refusals(Dictionary<string, object?> row) =>
            row["rolloutRefusals"] as string[];

        // ── The pad half ────────────────────────────────────────────────────────

        [Fact]
        public void A_free_and_empty_pad_publishes_as_takeable()
        {
            var lc = Centre();
            Built(lc);

            var pad = PadRow();

            Assert.Equal("Free", pad["state"]);
            Assert.Equal(false, pad["hasVesselWaiting"]);
            Assert.Null(pad["waitingVesselName"]);
        }

        [Fact]
        public void A_pad_that_reads_free_with_a_craft_on_it_says_so_and_names_it()
        {
            var lc = Centre();
            Built(lc);
            lc.LaunchPads[0].Waiting = new Vessel { vesselName = "Vanguard" };

            var pad = PadRow();

            // THE WHOLE REASON THIS FIELD EXISTS. State derives its answer from
            // the pad's OPERATIONS, and a craft already sent to the launch site
            // has none left, so the pad still reports Free. A client choosing from
            // state alone would offer this pad and be refused.
            Assert.Equal("Free", pad["state"]);
            Assert.Equal(true, pad["hasVesselWaiting"]);
            Assert.Equal("Vanguard", pad["waitingVesselName"]);
        }

        [Fact]
        public void An_occupied_pad_and_a_free_one_are_distinguishable_on_the_wire()
        {
            var lc = Centre();
            lc.LaunchPads.Add(new LCLaunchPad { name = "LaunchPad 2" });
            Built(lc);
            lc.LaunchPads[0].Waiting = new Vessel { vesselName = "Vanguard" };

            var raw = _reflection.Read(ut: 100.0);
            var pads = Rp1ScCapture.BuildPads(raw)
                .Cast<Dictionary<string, object?>>()
                .ToDictionary(p => (string)p["name"]!, p => p);

            Assert.Equal(true, pads["LaunchPad"]["hasVesselWaiting"]);
            Assert.Equal(false, pads["LaunchPad 2"]["hasVesselWaiting"]);
        }

        // ── The vehicle half ────────────────────────────────────────────────────

        [Fact]
        public void A_vehicle_the_complex_will_take_publishes_no_refusals_at_all()
        {
            var lc = Centre();
            Built(lc);

            // Absent rather than an empty array: no key means RP-1 has no
            // objection, and an empty array would cost a wire allocation per
            // vehicle per tick to say the same thing.
            Assert.Null(Refusals(WarehouseRow()));
        }

        [Fact]
        public void A_vehicle_too_heavy_for_its_complex_says_so_with_both_numbers()
        {
            var lc = Centre();
            lc.MassMaxValue = 40f;
            var vessel = Built(lc);
            vessel.mass = 120f;

            var refusals = Refusals(WarehouseRow());

            var reason = Assert.Single(refusals!);
            // Both figures, because "too heavy" does not tell an operator whether
            // to shed 200 kg or start again.
            Assert.Contains("120.0", reason);
            Assert.Contains("40.0", reason);
        }

        [Fact]
        public void A_vehicle_too_light_for_its_complex_is_refused_too()
        {
            var lc = Centre();
            lc.MassMinValue = 60f;
            var vessel = Built(lc);
            vessel.mass = 10f;

            // RP-1's floor, which stock has no concept of: a complex rated for a
            // Saturn V cannot usefully integrate a sounding rocket.
            Assert.Contains("too light", Assert.Single(Refusals(WarehouseRow())!));
        }

        [Fact]
        public void An_oversize_vehicle_names_the_axis()
        {
            var lc = Centre();
            lc.SizeMaxValue = new UnityEngine.Vector3(100f, 15f, 100f);
            var vessel = Built(lc);
            vessel.ShipSize = new UnityEngine.Vector3(10f, 40f, 10f);

            // Named, because "too large" does not say whether the problem is
            // height or width, and those are different craft changes.
            Assert.Contains("y axis", Assert.Single(Refusals(WarehouseRow())!));
        }

        [Fact]
        public void A_recorded_size_of_zero_refuses_nothing()
        {
            var lc = Centre();
            lc.SizeMaxValue = new UnityEngine.Vector3(1f, 1f, 1f);
            var vessel = Built(lc);
            vessel.ShipSize = new UnityEngine.Vector3(0f, 0f, 0f);

            // Zero is a size nobody wrote down, not a vehicle of no extent, and
            // the getter that would compute one MEMOISES onto a [Persistent]
            // field. Inventing a comparison here would refuse a real vehicle.
            Assert.Null(Refusals(WarehouseRow()));
        }

        [Fact]
        public void A_human_rated_vehicle_at_an_unrated_complex_is_refused()
        {
            var lc = Centre();
            lc.HumanRatedValue = false;
            var vessel = Built(lc);
            vessel.humanRated = true;

            Assert.Contains("human-rated", Assert.Single(Refusals(WarehouseRow())!));
        }

        [Fact]
        public void A_vehicle_with_parts_this_install_lacks_is_refused()
        {
            var lc = Centre();
            var vessel = Built(lc);
            vessel.AllPartsValid = false;

            // RP-1 omits the whole row for such a vehicle, so its own window
            // explains nothing. This is the only place an operator can learn it.
            Assert.Contains("parts", Assert.Single(Refusals(WarehouseRow())!));
        }

        [Fact]
        public void Every_reason_is_published_rather_than_only_the_first()
        {
            var lc = Centre();
            lc.MassMaxValue = 40f;
            lc.HumanRatedValue = false;
            var vessel = Built(lc);
            vessel.mass = 120f;
            vessel.humanRated = true;

            // An operator who fixes one refusal and is handed the next has been
            // made to iterate; RP-1's own popup lists them all at once.
            Assert.Equal(2, Refusals(WarehouseRow())!.Length);
        }

        [Fact]
        public void A_vehicle_still_integrating_carries_no_rollout_refusals()
        {
            var lc = Centre();
            var vessel = new VesselProject { shipName = "Atlas", cost = 40_000f, mass = 500f, buildPoints = 1000.0 };
            vessel.SetComplex(lc);
            lc.BuildList.Add(vessel);
            lc.MassMaxValue = 40f;

            var raw = _reflection.Read(ut: 100.0);
            var row = Assert.IsType<Dictionary<string, object?>>(
                Assert.Single(Rp1ScCapture.BuildQueue(raw)));

            // Deliberately absent even though the vehicle IS over the limit: it
            // cannot roll out for a reason that has nothing to do with its
            // envelope, and publishing one here would read as the reason.
            Assert.False(row.ContainsKey("rolloutRefusals"));
        }

        // ── The drift guard ─────────────────────────────────────────────────────

        [Theory]
        [InlineData(120f, 40f, 0f, false, false)]
        [InlineData(10f, 100f, 60f, false, false)]
        [InlineData(50f, 100f, 0f, true, false)]
        [InlineData(50f, 100f, 0f, false, true)]
        [InlineData(50f, 100f, 0f, false, false)]
        public void The_capture_and_the_launch_gate_agree_about_the_envelope(
            float mass,
            float massMax,
            float massMin,
            bool vehicleHumanRated,
            bool oversize)
        {
            var lc = Centre();
            lc.MassMaxValue = massMax;
            lc.MassMinValue = massMin;
            lc.HumanRatedValue = false;
            if (oversize)
            {
                lc.SizeMaxValue = new UnityEngine.Vector3(100f, 15f, 100f);
            }
            var vessel = Built(lc);
            vessel.mass = mass;
            vessel.humanRated = vehicleHumanRated;
            if (oversize)
            {
                vessel.ShipSize = new UnityEngine.Vector3(10f, 40f, 10f);
            }

            var captureRefuses = Refusals(WarehouseRow()) != null;
            var gateRefuses = !GatePasses(vessel);

            // The two reproductions of RP-1's envelope must reach the same
            // verdict on the same world. They cannot share one implementation
            // yet, so this is the instrument that stops them drifting: a widget
            // that offers a rollout the launch gate will refuse, or a widget that
            // hides one the gate would allow, both show up here.
            Assert.Equal(gateRefuses, captureRefuses);
        }

        /// <summary>
        /// Whether the launch gate's own envelope requirement passes for this
        /// vehicle. Asked through the gate's public surface rather than its
        /// internals, so the comparison is against what the gate actually
        /// decides.
        /// </summary>
        private bool GatePasses(VesselProject vessel)
        {
            var requirement = Rp1LaunchGate.Requirements()
                .First(r => r.Quantity == Rp1LaunchGate.WithinComplexLimits);
            var verdict = _gate.Evaluate(requirement, new ShipArguments(vessel.shipName));
            return verdict.Outcome == GateOutcome.Pass;
        }

        /// <summary>The gate's argument bag, carrying the one thing it asks for: the craft name.</summary>
        private sealed class ShipArguments : IGateArguments
        {
            private readonly string _shipName;

            public ShipArguments(string shipName) => _shipName = shipName;

            public bool TryGet(string path, out object value)
            {
                // "shipName" only. The gate also looks for an optional
                // "facility", and answering false to that is the same thing a
                // real launch dispatch that did not name one does.
                if (path == "shipName")
                {
                    value = _shipName;
                    return true;
                }
                value = null!;
                return false;
            }
        }
    }
}
