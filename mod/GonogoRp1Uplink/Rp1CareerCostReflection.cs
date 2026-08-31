// What a build will cost in FUNDS, and what RP-1 has recorded as having happened.
// Same arm's-length reflection pattern as the rest of this Uplink.
//
// PROVENANCE. Every member below was read out of an ilspycmd disassembly of the
// SHIPPED RP-1 v4.6.0.0 RP0.dll, and the two KSP members out of the shipped
// Assembly-CSharp.dll.
//
// WHY THIS IS NOT RP-1's OWN "COST BREAKDOWN". Its CostBreakdownGUI shows
// `effectiveCost` and `ModifiedEC`, and effectiveCost is the argument to
// Formula.GetVesselBuildPoints: it decides how LONG integration takes. The
// producer's own tooltip calls it a metric for comparing rockets against each
// other. It is not funds, it buys nothing, and it is called cost. Publishing it as
// one would be the substituted-quantity failure in its purest form, so the funds
// figures are read from where they actually live instead -- four separate fields
// on SpaceCenterManagement and one on the vessel.
//
// THE SURCHARGE IS ALREADY INSIDE THE VEHICLE COST, and this is the trap on this
// path. ModuleTooling is an IPartCostModifier, the game persists its contribution
// onto each part node as `modCost`, and ShipConstruction.GetPartCostsAndMass adds
// that straight into the part's dry cost. So VesselProject.cost CONTAINS the
// untooled penalty before anything here sees it, and a breakdown listing the two
// as separate lines would charge the operator twice for one thing. The surcharge
// travels as an OF WHICH.
//
// MEMBERS DELIBERATELY NOT CALLED, and why:
//
//   VesselProject.GetTotalCost()
//       lazily FILLS `cost` and `emptyCost` from the compressed craft node and
//       then calls CompressAndRelease on it. A read that populates a cache and
//       releases a buffer is a write, and the plain `cost` field beside it is the
//       same number without the side effect. A zero there reads as absent, which
//       is the honest answer for a vessel nobody has priced yet.
//   ToolingGUI.GetUntooledPartsAndCost
//       prices by performing every purchase for real and reloading the database.
//       See Rp1ToolingReflection's header; the cached total is used instead.
//   CareerLog.CurrentPeriod and the period dictionary
//       the monthly financial ledger. Read by nothing here on purpose: it is a
//       balance sheet rather than a timeline, and it belongs on a budget surface
//       rather than on an event feed.
using System;
using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Reads the editor vehicle's funds breakdown and RP-1's career event log.
    /// KSP-free at compile time, so both run headless against a stand-in graph.
    /// </summary>
    public sealed class Rp1CareerCostReflection
    {
        private const string ScmTypeName = "RP0.SpaceCenterManagement";

        private const string CareerLogTypeName = "RP0.CareerLog";

        private readonly Type? _scm;

        private readonly Type? _careerLog;

        public Rp1CareerCostReflection()
        {
            _scm = Rp1Types.Find(ScmTypeName);
            _careerLog = Rp1Types.Find(CareerLogTypeName);
        }

        public bool IsCostAvailable => _scm != null;

        public bool IsLogAvailable => _careerLog != null;

        /// <summary>
        /// The funds a launch of the editor vehicle would cost, or null when there
        /// is no vehicle being designed.
        ///
        /// <para>Absent rather than zeroed, because a breakdown of nothing is not a
        /// free vehicle: RP-1 keeps its editor figures only while the editor holds
        /// a ship, and a payload of zeros would read as a vehicle that costs
        /// nothing to fly.</para>
        /// </summary>
        public Rp1BuildCostRaw? ReadCost(double ut)
        {
            var instance = _scm == null ? null : Rp1Types.StaticValue(_scm, "Instance");
            var vessel = Rp1Types.Member(instance, "EditorVessel");
            if (vessel == null)
            {
                return null;
            }

            return new Rp1BuildCostRaw
            {
                Ut = ut,

                // The FIELD, not GetTotalCost(): see this file's header. Zero is
                // "not priced yet" rather than free, so it reads as absent.
                VehicleCost = NonZero(Rp1Types.ReadDouble(vessel, "cost")),

                ToolingCost = Rp1Types.ToDouble(Rp1Types.StaticValue(_scm!, "EditorToolingCosts")),
                UnlockCost = Rp1Types.ToDouble(Rp1Types.StaticValue(_scm!, "EditorUnlockCosts")),

                // Absent for a spaceplane rather than zero: RP-1 computes a rollout
                // only in the VAB, and a hangar vehicle does not roll out at all.
                RolloutCost = NonZero(
                    Rp1Types.ToDouble(Rp1Types.StaticValue(_scm!, "EditorRolloutCost"))),

                RequiredTechs = Strings(Rp1Types.StaticValue(_scm!, "EditorRequiredTechs")),
            };
        }

        /// <summary>
        /// RP-1's career event log, or null when its handler is not live.
        ///
        /// <para>Null is "could not be read", which is a THIRD state beside logging
        /// switched off and logging on with nothing recorded. All three would look
        /// like an empty list to a client that only got the rows.</para>
        /// </summary>
        public Rp1CareerEventsRaw? ReadEvents(double ut)
        {
            var instance = _careerLog == null ? null : Rp1Types.StaticValue(_careerLog, "Instance");
            if (instance == null)
            {
                return null;
            }

            var raw = new Rp1CareerEventsRaw
            {
                Ut = ut,
                Enabled = Rp1Types.ReadBool(instance, "IsEnabled"),
            };

            // Six private lists, one per kind, flattened onto one timeline. RP-1
            // exposes none of them publicly; its own window reaches them from
            // inside the class.
            Collect(instance, "_contractDict", "contract", raw);
            Collect(instance, "_launchedVessels", "launch", raw);
            Collect(instance, "_failures", "failure", raw);
            Collect(instance, "_facilityConstructionEvents", "facilityConstruction", raw);
            Collect(instance, "_techEvents", "techResearch", raw);
            Collect(instance, "_leaderEvents", "leader", raw);

            raw.Events.Sort(static (a, b) => (a.Ut ?? 0.0).CompareTo(b.Ut ?? 0.0));
            return raw;
        }

        /// <summary>
        /// One of RP-1's event lists, flattened onto the shared row.
        /// </summary>
        /// <remarks>
        /// Every kind is read by the SAME member names it happens to carry, and a
        /// member a kind does not have simply reads absent. That is why a launch
        /// row has no reputation change and a contract row has no part: the absence
        /// is the producer's shape rather than a decision taken here.
        /// </remarks>
        private static void Collect(object log, string field, string kind, Rp1CareerEventsRaw raw)
        {
            foreach (var e in Rp1Types.Enumerate(Rp1Types.Member(log, field)))
            {
                raw.Events.Add(new Rp1CareerEventRaw
                {
                    Ut = Rp1Types.ReadDouble(e, "UT"),
                    Kind = kind,
                    Name = Name(e),
                    Detail = Detail(e),

                    // The join a career log exists for: a failure and the launch it
                    // happened on carry the same LaunchID.
                    LaunchId = EmptyAsAbsent(Rp1Types.ReadString(e, "LaunchID")),
                    Part = EmptyAsAbsent(Rp1Types.ReadString(e, "Part")),
                    RepChange = Rp1Types.ReadDouble(e, "RepChange"),
                    Cost = Rp1Types.ReadDouble(e, "Cost"),
                });
            }
        }

        /// <summary>
        /// What to call the row, taking whichever name field the kind carries.
        /// Ordered most specific first: a contract has both an internal and a
        /// display name and the display one is the one written for a human.
        /// </summary>
        private static string? Name(object e) =>
            EmptyAsAbsent(Rp1Types.ReadString(e, "DisplayName"))
            ?? EmptyAsAbsent(Rp1Types.ReadString(e, "VesselName"))
            ?? EmptyAsAbsent(Rp1Types.ReadString(e, "NodeName"))
            ?? EmptyAsAbsent(Rp1Types.ReadString(e, "LeaderName"))
            ?? EmptyAsAbsent(Rp1Types.ReadString(e, "InternalName"));

        /// <summary>
        /// The kind's own sub-type, as the producer's own enum NAME rather than its
        /// ordinal. A failure's is a plain string already.
        /// </summary>
        private static string? Detail(object e) =>
            Rp1Types.ReadEnumName(e, "Type")
            ?? Rp1Types.ReadEnumName(e, "State")
            ?? Rp1Types.ReadEnumName(e, "Facility");

        /// <summary>A collection of strings, or null when the member is absent.</summary>
        private static List<string>? Strings(object? collection)
        {
            if (collection == null)
            {
                return null;
            }
            var names = new List<string>();
            foreach (var item in Rp1Types.Enumerate(collection))
            {
                if (item is string s && s.Length > 0)
                {
                    names.Add(s);
                }
            }
            return names;
        }

        /// <summary>
        /// A figure RP-1 leaves at zero when it does not apply, as an absence.
        /// Zero and "does not apply" are different answers and only one of them
        /// means free.
        /// </summary>
        private static double? NonZero(double? value) =>
            value == null || value.Value == 0.0 ? null : value;

        private static string? EmptyAsAbsent(string? value) =>
            string.IsNullOrEmpty(value) ? null : value;
    }
}
