// RP-1's price for building and renovating a launch complex, reimplemented,
// because there is nowhere to call it.
//
// WHY THIS FILE EXISTS AT ALL, and it is the single largest risk in the
// launch-complex write surface. Every other command in this Uplink invokes an
// RP-1 method that already does the thing: ScrapVessel scraps, ChangeEngineers
// assigns, HireStaff hires. The complex price has no such method. RP-1 computes
// it inline in KCT_GUI.DrawNewLCWindow, interleaved with the GUILayout calls that
// draw it, and hands three doubles to ProcessNewLC as arguments. There is no
// reusable entry point, not even a private one.
//
// So this is arithmetic we own, and a mistake in it does not throw and does not
// refuse: it writes a wrong price onto a construction project, and RP-1 then
// draws that wrong figure out of the career's funds over the following weeks of
// game time. That is why the formula is transcribed one clause at a time with
// RP-1's own structure kept visible rather than simplified into something
// tidier, and why every intermediate is named after what it is rather than after
// RP-1's num/num2/num3.
//
// WHAT IS INVOKED RATHER THAN REIMPLEMENTED, which is as much as could be:
//
//   LCData.GetCostStats(out padCost, out integrationCost, out resourceCost)
//                              the three-way split of a specification's price,
//                              and the whole of the curve over tonnage and size.
//                              Its RETURN is their sum, which is separately what
//                              a modify's oldCost is
//   LCData.ResModifyCost(LCData old)
//                              the price of the resource DIFFERENCE, which is not
//                              symmetric: a reduction is charged at a tenth and
//                              the whole difference then at 0.6 of a fresh tank
//   LCData.GetPadFracLevel()   the tonnage band a pad is built at
//   LCData.MaxPossibleMass / MinPossibleMass / IsMassWithinUpAndDowngradeMargins
//                              the renovation envelope, all three derived from
//                              massOrig alone
//   Database.SettingsSC.AdditionalPadCostMult
//                              what a second and subsequent pad costs, relative
//                              to the first. Ships at 0.5
//
// WHAT HAD TO BE REIMPLEMENTED, and why each is safe to:
//
//   Mathf.Approximately        Unity's, and this assembly references neither
//                              Unity nor KSP on purpose (see the csproj header).
//                              Transcribed exactly, epsilon and all
//   UtilMath.LerpUnclamped / InverseLerp / Clamp
//                              KSP's, three lines between them. The one call site
//                              feeds InverseLerp a value already clamped INSIDE
//                              its own range, so whether KSP's version clamps
//                              cannot change the answer and the reimplementation
//                              cannot diverge on the only input it ever sees
//
// TWO QUIRKS OF RP-1's OWN, both reproduced deliberately, both stated:
//
//   THE 1,000 FLOOR. Any change at all to a complex's tonnage limit forces the
//   pad half of a renovation to at least 1,000 funds, even a change of one tonne
//   and even a reduction. Reproduced.
//
//   THE PAD-COST MULTIPLY THAT LIVES IN A DISPLAY BRANCH. RP-1 applies
//   AdditionalPadCostMult to the pad price it passes to ProcessNewLC from INSIDE
//   an `if (totalCost > 0.0)` block whose purpose is drawing labels, so a
//   renovation that prices at zero or below passes the unmultiplied figure and one
//   that prices at anything passes the multiplied figure. That price reprices the
//   complex's in-flight pad constructions. This file multiplies ALWAYS, which is a
//   deliberate divergence, and the evidence that it is the intended value is
//   RP-1's own LCConstructionProject.ProcessCancel: cancelling the same renovation
//   reprices the same pad constructions and multiplies unconditionally. Matching
//   the cancel path is the only choice that makes queue and cancel agree.
//
// PROVENANCE. Every member and every constant was read out of an ilspycmd
// disassembly of the INSTALLED RP-1 v4.6.0.0 RP0.dll. Shape is verified and value
// is not: nothing here has been compared against a running RP-1's own displayed
// figure, and doing that once is the live check this file most wants.
using System;
using System.Collections.Generic;
using System.Reflection;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The price and the build-point inputs for a new or renovated launch
    /// complex, and the renovation envelope a modify is held to.
    /// </summary>
    /// <remarks>
    /// Static and stateless. It reads RP-1's objects and returns numbers; it
    /// writes nothing and queues nothing, which is what lets the whole formula be
    /// exercised headless against a stand-in graph.
    /// </remarks>
    public static class Rp1LcCostModel
    {
        /// <summary>RP-1's floor on the pad half of any renovation that moves the tonnage limit.</summary>
        public const double MassChangeCostFloor = 1000.0;

        /// <summary>
        /// The three figures <c>ProcessNewLC</c> takes, plus the two a caller
        /// needs to report what it did.
        /// </summary>
        public sealed class Quote
        {
            /// <summary>What the project costs, and the figure funds are drawn against as it builds.</summary>
            public double TotalCost;

            /// <summary>
            /// The pad price the complex's in-flight pad constructions get
            /// repriced to, already multiplied by RP-1's additional-pad
            /// multiplier. See this file's header for why "already".
            /// </summary>
            public double PadCost;

            /// <summary>
            /// The complex's CURRENT total price, which RP-1 uses as the prior
            /// cost when it turns the new price into a duration. Zero for a new
            /// complex, which has no prior.
            /// </summary>
            public double OldTotalCost;

            /// <summary>
            /// The renovation reduces the complex's integration half. True is
            /// the case an operator most needs told about, because it is the one
            /// where a bill arrives for making something smaller.
            /// </summary>
            public bool IsDowngrade;

            /// <summary>The engineers the finished complex can hold, so a caller can say what it will support.</summary>
            public int MaxEngineers;
        }

        /// <summary>
        /// The price of building a complex RP-1 does not have.
        ///
        /// <para>The whole of it is the new specification's own three-way cost:
        /// there is nothing to compare against, so the pad, integration and
        /// resource halves simply add up. The one subtlety is that the pad price
        /// is counted ONCE here and the extra pads a client might want are a
        /// separate act with a separate price.</para>
        /// </summary>
        /// <returns>Null when RP-1 would not answer, which every caller must refuse on rather than substitute a price for.</returns>
        public static Quote? QuoteNew(object newData, Type launchComplexType, double additionalPadCostMult)
        {
            if (!TryCostStats(newData, out var newCost))
            {
                return null;
            }

            var maxEngineers = MaxEngineers(newData, launchComplexType);
            if (maxEngineers == null)
            {
                return null;
            }

            return new Quote
            {
                TotalCost = newCost.Pad + newCost.Integration + newCost.Resources,
                PadCost = newCost.Pad * additionalPadCostMult,
                OldTotalCost = 0.0,
                IsDowngrade = false,
                MaxEngineers = maxEngineers.Value,
            };
        }

        /// <summary>
        /// The price of renovating a complex the career has, into a new
        /// specification.
        ///
        /// <para>RP-1 prices the two halves of a complex quite differently, and
        /// the difference is the reason a downgrade is not free. The PAD half is
        /// the difference in pad price, at full rate going up and HALF rate coming
        /// down, then scaled by how many pads share the complex. The INTEGRATION
        /// half is the difference in integration price PLUS a charge per metre of
        /// envelope moved on each axis, again halved coming down, and capped at
        /// the new integration price when going up. Resources are the third and
        /// have their own asymmetry inside <c>ResModifyCost</c>.</para>
        ///
        /// <para>The hangar is a different shape and not a special case bolted
        /// on: it has no pad at all, so its pad half is zero and its per-metre
        /// rate is a flat 500 rather than a curve over the tonnage it does not
        /// have.</para>
        /// </summary>
        /// <param name="isHangar">The complex is the career's hangar, which prices without a pad.</param>
        public static Quote? QuoteModify(
            object newData,
            object complex,
            object currentData,
            bool isHangar,
            int launchPadCount,
            Type launchComplexType,
            double additionalPadCostMult)
        {
            if (!TryCostStats(newData, out var newCost) || !TryCostStats(currentData, out var currentCost))
            {
                return null;
            }

            var currentMassMax = Rp1Types.ReadDouble(complex, "MassMax");
            var newMassMax = Rp1Types.ReadDouble(newData, "massMax");
            var newMassOrig = Rp1Types.ReadDouble(newData, "massOrig");
            if (currentMassMax == null || newMassMax == null || newMassOrig == null)
            {
                return null;
            }

            var currentSize = Size(Rp1Types.Member(complex, "SizeMax"));
            var newSize = Size(Rp1Types.Member(newData, "sizeMax"));
            if (currentSize == null || newSize == null)
            {
                return null;
            }

            var maxEngineers = MaxEngineers(newData, launchComplexType);
            if (maxEngineers == null)
            {
                return null;
            }

            // The pad half. Zero for the hangar, which has no pad; otherwise the
            // difference, at half rate coming down, then scaled once for every pad
            // beyond the first because they all get rebuilt.
            var padHalf = 0.0;
            if (!isHangar)
            {
                padHalf = newCost.Pad > currentCost.Pad
                    ? newCost.Pad - currentCost.Pad
                    : (currentCost.Pad - newCost.Pad) * 0.5;

                var pads = (double)launchPadCount;
                if (pads > 1.0)
                {
                    padHalf *= 1.0 + (pads - 1.0) * additionalPadCostMult;
                }

                // RP-1's floor, and it is on the PAD half only rather than on the
                // total: any movement of the tonnage limit at all, in either
                // direction, costs at least this much.
                if (!Approximately(currentMassMax.Value, newMassMax.Value) && padHalf < MassChangeCostFloor)
                {
                    padHalf = MassChangeCostFloor;
                }
            }

            // The integration half. Its per-metre rate is a curve over the
            // complex's ORIGINAL tonnage rather than its new limit, so a big
            // complex pays more per metre of envelope than a small one whatever it
            // is being renovated into.
            var metreRate = isHangar
                ? 500.0
                : LerpUnclamped(100.0, 1000.0, InverseLerp(10.0, 55.0, Clamp(newMassOrig.Value, 10.0, 50.0)));

            var integrationHalf =
                Math.Abs(newCost.Integration - currentCost.Integration)
                + Math.Abs(newSize.Value.Y - currentSize.Value.Y) * metreRate
                + Math.Abs(newSize.Value.X - currentSize.Value.X) * metreRate * 0.5
                + Math.Abs(newSize.Value.Z - currentSize.Value.Z) * metreRate * 0.5;

            var isDowngrade = newCost.Integration < currentCost.Integration;
            if (isDowngrade)
            {
                integrationHalf *= 0.5;
            }
            else if (newCost.Integration > currentCost.Integration && integrationHalf > newCost.Integration)
            {
                // Rebuilding cannot cost more than building: a renovation that
                // grows the complex is capped at what the finished specification
                // would have cost outright.
                integrationHalf = newCost.Integration;
            }

            var resourceHalf = ResModifyCost(newData, currentData);
            if (resourceHalf == null)
            {
                return null;
            }

            return new Quote
            {
                TotalCost = padHalf + integrationHalf + resourceHalf.Value,
                PadCost = newCost.Pad * additionalPadCostMult,
                OldTotalCost = currentCost.Pad + currentCost.Integration + currentCost.Resources,
                IsDowngrade = isDowngrade,
                MaxEngineers = maxEngineers.Value,
            };
        }

        /// <summary>
        /// The tonnage band a pad is built at, which the pad a complex owns takes
        /// its level from.
        /// </summary>
        /// <returns>
        /// Null when RP-1 would not answer. Distinguished from a legitimate zero,
        /// which is the lowest band and what a small complex genuinely gets: RP-1
        /// treats -1 as "no band" and a caller has to be able to tell the two
        /// apart.
        /// </returns>
        public static double? PadFracLevel(object data)
        {
            var method = Rp1Types.InstanceMethod(data, "GetPadFracLevel", 0);
            if (method == null)
            {
                return null;
            }
            return Rp1Types.ToDouble(method.Invoke(data, Array.Empty<object>()));
        }

        /// <summary>
        /// The tonnage limits a renovation of this complex is held between,
        /// derived from what it was BUILT at rather than what it is now.
        ///
        /// <para>Asked of RP-1 rather than computed from <c>massOrig</c>, even
        /// though the arithmetic is two lines and is published on the wire: the
        /// two limits and the test between them are three separate members, and a
        /// build that changed the envelope would change all three together. A
        /// reimplementation would keep agreeing with the old rule.</para>
        /// </summary>
        public static bool? IsMassWithinMargins(object data) => Rp1Types.ReadBool(data, "IsMassWithinUpAndDowngradeMargins");

        /// <summary>The upper renovation limit, for the refusal sentence.</summary>
        public static double? MaxPossibleMass(object data) => Rp1Types.ReadDouble(data, "MaxPossibleMass");

        /// <summary>The lower renovation limit, for the refusal sentence.</summary>
        public static double? MinPossibleMass(object data) => Rp1Types.ReadDouble(data, "MinPossibleMass");

        /// <summary>
        /// RP-1's additional-pad multiplier, or its shipped default when the
        /// settings object cannot be read.
        ///
        /// <para>A default rather than a refusal, and the only place in this file
        /// that substitutes anything. The multiplier scales a price rather than
        /// deciding whether an act is legal, RP-1 ships 0.5 and has since this
        /// setting existed, and refusing every complex command because a settings
        /// field moved would cost far more than a stale multiplier.</para>
        /// </summary>
        public static double AdditionalPadCostMult(Type? databaseType)
        {
            if (databaseType == null)
            {
                return 0.5;
            }
            var settings = Rp1Types.StaticValue(databaseType, "SettingsSC");
            return Rp1Types.ReadDouble(settings, "AdditionalPadCostMult") ?? 0.5;
        }

        /// <summary>
        /// The engineers a specification can hold, by RP-1's own static
        /// calculation rather than a reimplementation of its curve.
        ///
        /// <para>Resolved by first-parameter type as well as arity, because the
        /// signature takes a float, a Vector3 and a bool and an assembly with a
        /// second three-argument overload would otherwise be a coin toss.</para>
        /// </summary>
        private static int? MaxEngineers(object data, Type launchComplexType)
        {
            var method = Rp1Types.StaticMethodOn(launchComplexType, "MaxEngineersCalc", "System.Single", 3);
            if (method == null)
            {
                return null;
            }

            var massMax = Rp1Types.Member(data, "massMax");
            var sizeMax = Rp1Types.Member(data, "sizeMax");
            var humanRated = Rp1Types.Member(data, "isHumanRated");
            if (massMax == null || sizeMax == null || humanRated == null)
            {
                return null;
            }

            switch (method.Invoke(null, new[] { massMax, sizeMax, humanRated }))
            {
                case int i: return i;
                case long l: return (int)l;
                default: return null;
            }
        }

        /// <summary>The price of the resource difference, which RP-1 charges asymmetrically.</summary>
        private static double? ResModifyCost(object newData, object currentData)
        {
            var method = Rp1Types.InstanceMethodOn(newData, "ResModifyCost", RequireLcDataTypeName(newData), 1);
            if (method == null)
            {
                return null;
            }
            return Rp1Types.ToDouble(method.Invoke(newData, new[] { currentData }));
        }

        /// <summary>
        /// The full name of the type <c>ResModifyCost</c> takes, which is the type
        /// of the object it is called on.
        ///
        /// <para>Taken from the instance rather than written down, because
        /// <c>LCData</c> declares FOUR constructors of which three take a single
        /// argument, and a file that hard-codes one of its own type names is a
        /// file that can disagree with the one the rest of the walk resolved.</para>
        /// </summary>
        private static string RequireLcDataTypeName(object data) => data.GetType().FullName ?? "RP0.LCData";

        private struct CostStats
        {
            public double Pad;
            public double Integration;
            public double Resources;
        }

        /// <summary>
        /// A specification's three-way price, in one call.
        ///
        /// <para>Three OUT parameters, so the invoke goes through a boxed argument
        /// array that has to be read back rather than trusted: a build whose
        /// GetCostStats took a different arity resolves to nothing and this refuses,
        /// which is the only safe answer when the price cannot be had.</para>
        /// </summary>
        private static bool TryCostStats(object data, out CostStats stats)
        {
            stats = default;

            var method = Rp1Types.InstanceMethod(data, "GetCostStats", 3);
            if (method == null)
            {
                return false;
            }

            var args = new object?[] { 0.0, 0.0, 0.0 };
            method.Invoke(data, args);

            var pad = Rp1Types.ToDouble(args[0]);
            var integration = Rp1Types.ToDouble(args[1]);
            var resources = Rp1Types.ToDouble(args[2]);
            if (pad == null || integration == null || resources == null)
            {
                return false;
            }

            stats = new CostStats
            {
                Pad = pad.Value,
                Integration = integration.Value,
                Resources = resources.Value,
            };
            return true;
        }

        private struct Axes
        {
            public double X;
            public double Y;
            public double Z;
        }

        /// <summary>A Unity Vector3 read as three doubles, or absent when any axis would not read.</summary>
        private static Axes? Size(object? vector)
        {
            var x = Rp1Types.ReadDouble(vector, "x");
            var y = Rp1Types.ReadDouble(vector, "y");
            var z = Rp1Types.ReadDouble(vector, "z");
            if (x == null || y == null || z == null)
            {
                return null;
            }
            return new Axes { X = x.Value, Y = y.Value, Z = z.Value };
        }

        /// <summary>
        /// Unity's <c>Mathf.Approximately</c>, transcribed, because this assembly
        /// does not reference Unity.
        ///
        /// <para>Its epsilon is deliberately not a round number: it is a relative
        /// tolerance with an absolute floor, and RP-1 uses it to decide whether the
        /// tonnage limit moved at all, which is the test that costs 1,000 funds
        /// when it says yes. A simpler comparison here would charge that floor for
        /// a difference in the last bit of a float.</para>
        /// </summary>
        internal static bool Approximately(double a, double b) =>
            Math.Abs(b - a) < Math.Max(1E-06 * Math.Max(Math.Abs(a), Math.Abs(b)), float.Epsilon * 8f);

        /// <summary>KSP's <c>UtilMath.LerpUnclamped</c>: the reason it is unclamped never comes up at this call site, but it is what RP-1 calls.</summary>
        internal static double LerpUnclamped(double a, double b, double t) => a + (b - a) * t;

        /// <summary>
        /// KSP's <c>UtilMath.InverseLerp</c>. Its one call site feeds it a value
        /// already clamped inside its own range, so whether KSP's version clamps
        /// its result cannot change any answer this file computes.
        /// </summary>
        internal static double InverseLerp(double a, double b, double value) =>
            a == b ? 0.0 : (value - a) / (b - a);

        /// <summary>KSP's <c>UtilMath.Clamp</c>.</summary>
        internal static double Clamp(double value, double min, double max) =>
            value < min ? min : (value > max ? max : value);

        /// <summary>
        /// Whether a resource is one RP-1's own launch-complex list would offer
        /// for a complex of this kind.
        ///
        /// <para>RP-1's list is <c>Database.ResourceInfo.LCResourceTypes</c>
        /// filtered to entries carrying the Fuel flag and minus the ones this kind
        /// of complex ignores: a pad ignores the hangar-only fluids and a hangar
        /// ignores the pad-only ones. A resource outside that set costs nothing
        /// (<c>Formula.ResourceTankCost</c> returns zero for it) and is silently
        /// stored, which is the shape a command must refuse rather than accept: a
        /// complex that stored a resource it will never handle looks equipped and
        /// is not.</para>
        ///
        /// <para>The flag VALUES are RP-1's own and are read as integers rather
        /// than named, because the enum is not a type this assembly has:
        /// Fuel is 1, PadIgnore is 4 and HangarIgnore is 8, which is the same
        /// arithmetic RP-1's own resource list does inline.</para>
        /// </summary>
        /// <returns>Null when RP-1's catalogue could not be read at all, which is a refusal rather than an empty answer.</returns>
        public static IReadOnlyCollection<string>? HandledResourceNames(Type? databaseType, bool isHangar)
        {
            if (databaseType == null)
            {
                return null;
            }

            var resourceInfo = Rp1Types.StaticValue(databaseType, "ResourceInfo");
            var types = Rp1Types.Member(resourceInfo, "LCResourceTypes");
            if (types == null)
            {
                return null;
            }

            const int fuel = 1;
            var ignored = isHangar ? 8 : 4;

            var names = new List<string>();
            foreach (var entry in Rp1Types.Enumerate(types))
            {
                var key = Rp1Types.ReadString(entry, "Key");
                var value = Rp1Types.Member(entry, "Value");
                if (key == null || value == null)
                {
                    continue;
                }

                var flags = Convert.ToInt32(value);
                if ((flags & fuel) != 0 && (flags & ignored) == 0)
                {
                    names.Add(key);
                }
            }

            return names;
        }
    }
}
