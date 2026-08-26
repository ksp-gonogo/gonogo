// RP-1's Programs, read by reflection. No compile-time reference to RP0.dll,
// same arm's-length pattern as Rp1ScReflection, whose header carries the
// provenance rules this file follows.
//
// PROVENANCE. Every member below was read out of an ilspycmd disassembly of the
// SHIPPED RP-1 v4.6.0.0 RP0.dll at
// GameData/RP-1/Plugins/RP0.dll, cross-checked against a live RP-1 career's
// persistent.sfs for the node names Program.Save writes.
//
// EVERY MEMBER INVOKED HERE, rather than read as a field, HAS HAD ITS BODY READ:
//
//   Program.AllRequirementsMet / AllObjectivesMet
//       compiled predicates over RequirementBlock. Every leaf is a state read:
//       ContractRequirement counts ConfiguredContract.CompletedContractsByName,
//       TechRequirement asks ResearchAndDevelopment.GetTechnologyState,
//       FacilityRequirement asks KCTUtilities.GetFacilityLevel, and
//       ProgramRequirement scans ProgramHandler's own two lists. None mutates,
//       none broadcasts, and all four touch KSP statics, which is why this runs
//       in the capture half.
//   Program.CanAccept / CanComplete
//       thin compositions over those predicates and the persisted UT fields.
//   Program.TotalFunding
//       the persisted total when it has one, else baseFunding times
//       HighLogic.CurrentGame.Parameters.Career.FundsGainMultiplier. A read.
//   ProgramHandler.ActiveProgramSlots
//       sums each active Program's own slots field. Pure.
//   ProgramHandler.MaxProgramSlots
//       GameVariables.GetActiveStrategyLimit over the Administration building's
//       level. A read, and the one member here that is absent rather than wrong
//       outside a loaded career.
//   ProgramHandler.Settings.paymentCurves
//       a plain PersistentDictionaryValueTypeKey<string, HermiteCurve>, walked
//       as an IDictionary and never cast. Each curve is enumerated through its
//       own IEnumerable<Key>, whose MoveNext hands back the compiled key array;
//       no evaluation, no compilation, nothing that mutates the curve.
//
// THE FUNDING CURVE, and why it travels as keys. Program.GetFundsAtFrac is
// ProgramHandler.Settings.FundingCurve(fundingCurve).Evaluate(frac) *
// TotalFunding, so a Program's funding is entirely described by a curve NAME
// plus that shared table: twelve Hermite curves in ProgramHandlerSettings.cfg,
// each keyed on fraction-of-duration and valued in cumulative fraction of the
// total, running past 1 because RP-1 keeps paying past the deadline. The table
// is read once per tick onto its own Topic and the per-Program arithmetic is
// reproduced in Rp1ProgramsMath from HermiteCurve.EvaluateBetweenKeys, which is
// a pure basis-function evaluation with no game state in it at all.
//
//   Program.DurationYearsCalc
//       the one member here reproduced rather than called, because its LAST act
//       is CurrencyUtils.Time. Everything before that is arithmetic (1.5 for
//       Slow, 0.75 for Fast, rounded to a quarter year) and is reproduced
//       exactly; the modifier pass is instead recovered from the persisted
//       deadline, which RP-1 rewrites on every funding tick and which therefore
//       already carries it. See Rp1ProgramsMath.DerivedDurationSeconds.
//
// MEMBERS DELIBERATELY NOT CALLED, and why. RP-1 routes a family of display
// figures through CurrencyModifierQueryRP0.RunQuery, whose body FIRES
// GameEvents.Modifiers.OnCurrencyModifierQuery at every modifier in the save.
// That is a thing to run, not a thing to read, and the same fence already
// stands in Rp1EconomyBackend:
//
//   Program.DurationYears, EffectiveDurationYears, RemainingDurationYears
//       all reach CurrencyUtils.Time. The duration in force is instead taken
//       from the persisted deadlineUT, which RP-1 itself recomputes on every
//       funding tick, so a Program a leader has slowed reports its real
//       deadline and never our estimate of one.
//   Program.DisplayConfidenceCost, IsSpeedAllowed, MeetsConfidenceThreshold
//       all reach CurrencyUtils.Conf. The raw per-speed cost is a plain
//       dictionary read and goes on the wire instead; whether the career can
//       afford it is a comparison the client makes against rp1.confidence.
//
// PROGRAM MODIFIERS. RP-1 does not modify its catalogue in place: accepting a
// Program copies the template and runs ApplyProgramModifiers over the copy, and
// the Administration building shows a separate copy with the same overlay
// applied. So a row for a Program not yet accepted has to carry the overlay or
// it quotes funding the operator will not be offered. ProgramModifier.Apply is
// a plain field overlay with a -1 sentinel per field, reproduced by
// Rp1ProgramsMath.Overlay against values read here.
using System;
using System.Collections;
using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Resolves RP-1's Program model by reflection and reads one tick of it into
    /// <see cref="Rp1ProgramsRaw"/>. Nothing in this file touches KSP or Unity
    /// directly, so it compiles and runs headless against a stand-in object
    /// graph; the RP-1 members it invokes are the ones that do.
    /// </summary>
    public sealed class Rp1ProgramsReflection
    {
        private const string HandlerTypeName = "RP0.Programs.ProgramHandler";

        /// <summary>Seconds in the Julian year RP-1 measures a Program's duration in.</summary>
        internal const double JulianYearSeconds = 31557600.0;

        private readonly Type? _handler;

        /// <summary>RP-1's Program handler type resolved. Gated on the TYPE, never on an assembly name.</summary>
        public bool IsAvailable => _handler != null;

        public Rp1ProgramsReflection()
        {
            _handler = Rp1Types.Find(HandlerTypeName);
        }

        /// <summary>
        /// Reads one tick, or nothing. Null when RP-1's Program handler is not
        /// live, which is the main menu and any save RP-1 does not manage:
        /// publishing an empty catalogue there would say "this career has no
        /// Programs to accept" about a game that ships thirty-seven of them.
        /// </summary>
        public Rp1ProgramsRaw? Read(double ut)
        {
            if (_handler == null)
            {
                return null;
            }
            var instance = Rp1Types.StaticValue(_handler, "Instance");
            if (instance == null)
            {
                return null;
            }

            var raw = new Rp1ProgramsRaw { Ut = ut };

            var active = Materialise(Rp1Types.Member(instance, "ActivePrograms"));
            var completed = Materialise(Rp1Types.Member(instance, "CompletedPrograms"));
            var disabled = NameSet(Rp1Types.Member(instance, "DisabledPrograms"));

            var accepted = new HashSet<string>(StringComparer.Ordinal);
            foreach (var p in active)
            {
                var name = ReadString(p, "name");
                if (name != null)
                {
                    accepted.Add(name);
                }
                raw.Programs.Add(ReadProgram(p, Rp1ProgramStates.Active));
            }
            foreach (var p in completed)
            {
                var name = ReadString(p, "name");
                if (name != null)
                {
                    accepted.Add(name);
                }
                raw.Programs.Add(ReadProgram(p, Rp1ProgramStates.Completed));
            }

            var modifiers = ReadModifiers(accepted);
            foreach (var template in Materialise(Rp1Types.StaticValue(_handler, "Programs")))
            {
                var name = ReadString(template, "name");
                if (name != null && accepted.Contains(name))
                {
                    continue;
                }
                var isDisabled = ReadBool(template, "isDisabled") == true
                    || (name != null && disabled.Contains(name));
                var row = ReadProgram(template, null);
                Rp1ProgramsMath.Overlay(row, modifiers);
                row.State = isDisabled
                    ? Rp1ProgramStates.Disabled
                    : row.RequirementsMet ? Rp1ProgramStates.Offerable : Rp1ProgramStates.Locked;
                // RP-1's own CanAccept is answered by a template object that has
                // never been accepted, so it cannot see that a rival closed this
                // Program off. The state above can, and is what the wire carries.
                row.CanAccept = row.State == Rp1ProgramStates.Offerable;
                raw.Programs.Add(row);
            }

            var settings = Rp1Types.StaticValue(_handler, "Settings");
            raw.DefaultCurve = EmptyAsAbsent(ReadString(settings, "defaultFundingCurve"));
            raw.Curves = ReadCurves(settings);

            raw.Slots = new Rp1ProgramSlotsRaw
            {
                MaxSlots = ReadInt(instance, "MaxProgramSlots"),
                UsedSlots = ReadInt(instance, "ActiveProgramSlots") ?? 0,
                ActiveCount = active.Count,
                CompletedCount = completed.Count,
            };
            return raw;
        }

        /// <summary>
        /// One Program. <paramref name="acceptedState"/> is null for a catalogue
        /// template, whose accept-time fields are all at their sentinels and
        /// whose state the caller decides.
        /// </summary>
        private Rp1ProgramRaw ReadProgram(object program, string? acceptedState)
        {
            var isAccepted = acceptedState != null;
            var speed = Rp1Types.Member(program, "speed");
            var row = new Rp1ProgramRaw
            {
                Name = ReadString(program, "name"),
                Title = ReadString(program, "title"),
                State = acceptedState,
                Speed = EnumName(speed),
                Slots = ReadInt(program, "slots") ?? 0,
                IsHumanSpaceflight = ReadBool(program, "isHSF") == true,
                NominalDurationSeconds = Rp1ProgramsMath.YearsToSeconds(
                    ReadDouble(program, "nominalDurationYears")),
                AcceptedUt = ZeroAsAbsent(ReadDouble(program, "acceptedUT")),
                DeadlineUt = ZeroAsAbsent(ReadDouble(program, "deadlineUT")),
                ObjectivesCompletedUt = ZeroAsAbsent(ReadDouble(program, "objectivesCompletedUT")),
                CompletedUt = ZeroAsAbsent(ReadDouble(program, "completedUT")),
                LastPaymentUt = ZeroAsAbsent(ReadDouble(program, "lastPaymentUT")),
                FracElapsed = NegativeAsAbsent(ReadDouble(program, "fracElapsed")),
                FundingCurve = EmptyAsAbsent(ReadString(program, "fundingCurve")),
                ConfidenceCost = ConfidenceCostAt(program, speed),
                RepDeltaOnCompletePerYearEarly = ReadDouble(program, "repDeltaOnCompletePerYearEarly"),
                RepPenaltyPerYearLate = Rp1ProgramsMath.RepPenaltyPerYearLate(
                    EnumName(speed), ReadDouble(program, "repPenaltyPerYearLate")),
                RepPenaltyAssessed = isAccepted ? ReadDouble(program, "repPenaltyAssessed") : null,
                RequirementsMet = ReadBool(program, "AllRequirementsMet") == true,
                ObjectivesMet = ReadBool(program, "AllObjectivesMet") == true,
                CanAccept = ReadBool(program, "CanAccept") == true,
                CanComplete = ReadBool(program, "CanComplete") == true,
                RequirementsText = EmptyAsAbsent(ReadString(program, "requirementsPrettyText")),
                ObjectivesText = EmptyAsAbsent(ReadString(program, "objectivesPrettyText")),
                ConfidenceCostBySpeed = ReadConfidenceCosts(program),
                ProgramsToDisableOnAccept = NameList(
                    Rp1Types.Member(program, "programsToDisableOnAccept")),
                IsActive = acceptedState == Rp1ProgramStates.Active,
                IsComplete = acceptedState == Rp1ProgramStates.Completed,
            };
            row.DerivedDurationSeconds = Rp1ProgramsMath.DerivedDurationSeconds(
                row.DeadlineUt, row.LastPaymentUt, row.FracElapsed);

            // Baked here rather than left to the mapper because a template's
            // baseFunding is one of the fields a program modifier overwrites, so
            // the overlay has to reach it before the total is computed.
            row.BaseFunding = ReadDouble(program, "baseFunding");
            row.TotalFunding = ReadDouble(program, "TotalFunding");
            row.FundsPaidOut = isAccepted ? ReadDouble(program, "fundsPaidOut") : null;
            return row;
        }

        /// <summary>
        /// The Confidence price at the Program's own speed, read straight out of
        /// RP-1's per-speed table. Absent when either half is unreadable, never
        /// zero: a Slow Program genuinely costs nothing under the shipped
        /// catalogue, so zero is a real price and cannot double as "unknown".
        /// </summary>
        private static double? ConfidenceCostAt(object program, object? speed)
        {
            if (speed == null)
            {
                return null;
            }
            var costs = Rp1Types.Member(program, "confidenceCosts") as IDictionary;
            if (costs == null)
            {
                return null;
            }
            try
            {
                return costs.Contains(speed) ? Rp1Types.ToDouble(costs[speed]) : null;
            }
            catch (Exception)
            {
                // fail-soft: an unreadable table costs one field, never the row
                return null;
            }
        }

        /// <summary>
        /// The RP0_PROGRAM_MODIFIER overlays currently in force: those whose
        /// source Program the career has already accepted or completed, which is
        /// exactly the condition <c>Program.ApplyProgramModifiers</c> applies.
        /// </summary>
        private List<Rp1ProgramsMath.ModifierOverlay> ReadModifiers(HashSet<string> accepted)
        {
            var overlays = new List<Rp1ProgramsMath.ModifierOverlay>();
            if (_handler == null)
            {
                return overlays;
            }
            foreach (var m in Materialise(Rp1Types.StaticValue(_handler, "ProgramModifiers")))
            {
                var src = ReadString(m, "srcProgram");
                var tgt = ReadString(m, "tgtProgram");
                if (src == null || tgt == null || !accepted.Contains(src))
                {
                    continue;
                }
                overlays.Add(new Rp1ProgramsMath.ModifierOverlay
                {
                    Target = tgt,
                    NominalDurationYears = ReadDouble(m, "nominalDurationYears"),
                    BaseFunding = ReadDouble(m, "baseFunding"),
                    FundingCurve = ReadString(m, "fundingCurve"),
                    RepDeltaOnCompletePerYearEarly = ReadDouble(m, "repDeltaOnCompletePerYearEarly"),
                    RepPenaltyPerYearLate = ReadDouble(m, "repPenaltyPerYearLate"),
                    Slots = ReadInt(m, "slots"),
                    ConfidenceCosts = ReadConfidenceCosts(m),
                });
            }
            return overlays;
        }

        /// <summary>
        /// A per-speed Confidence table, keyed by speed NAME so nothing
        /// downstream has to hold an RP-1 enum. Reads the same
        /// <c>confidenceCosts</c> field off either a Program, where it is the
        /// catalogue price, or a modifier, where it is an override.
        /// </summary>
        private static Dictionary<string, double> ReadConfidenceCosts(object owner)
        {
            var byName = new Dictionary<string, double>(StringComparer.Ordinal);
            if (!(Rp1Types.Member(owner, "confidenceCosts") is IDictionary costs))
            {
                return byName;
            }
            try
            {
                foreach (DictionaryEntry entry in costs)
                {
                    var name = EnumName(entry.Key);
                    var value = Rp1Types.ToDouble(entry.Value);
                    if (name != null && value != null)
                    {
                        byName[name] = value.Value;
                    }
                }
            }
            catch (Exception)
            {
                // fail-soft: an unreadable table leaves the catalogue price standing
            }
            return byName;
        }

        /// <summary>
        /// RP-1's whole funding-curve table from <c>ProgramHandlerSettings</c>,
        /// each curve's keys taken through the curve's own
        /// <c>IEnumerable&lt;Key&gt;</c>.
        /// </summary>
        /// <remarks>
        /// Enumerated rather than indexed on purpose: the enumerator yields the
        /// key array a <c>HermiteCurve</c> holds AFTER it compiles itself, so a
        /// curve whose config spelled two values per key instead of four hands
        /// over the tangents RP-1 derived and evaluates against, not the blanks
        /// the file carried. Nothing in the shipped table takes that path today.
        ///
        /// <para>Nothing here casts to <c>HermiteCurve</c> or to RP-1's
        /// persistent-dictionary type. Both live in assemblies this Uplink does
        /// not reference, and their identity is not the fact being read: a
        /// dictionary of name to something-enumerable-of-keys is.</para>
        /// </remarks>
        private static List<Rp1FundingCurveRaw> ReadCurves(object? settings)
        {
            var curves = new List<Rp1FundingCurveRaw>();
            if (!(Rp1Types.Member(settings, "paymentCurves") is IDictionary table))
            {
                return curves;
            }
            try
            {
                foreach (DictionaryEntry entry in table)
                {
                    var name = entry.Key as string;
                    if (name == null)
                    {
                        continue;
                    }
                    curves.Add(new Rp1FundingCurveRaw
                    {
                        Name = name,
                        Keys = ReadCurveKeys(entry.Value),
                    });
                }
            }
            catch (Exception)
            {
                // fail-soft: an unreadable table costs the curve Topic, never the Program rows
            }
            return curves;
        }

        private static List<Rp1FundingCurveKeyRaw> ReadCurveKeys(object? curve)
        {
            var keys = new List<Rp1FundingCurveKeyRaw>();
            foreach (var key in Materialise(curve))
            {
                var frac = ReadDouble(key, "time");
                var value = ReadDouble(key, "value");
                if (frac == null || value == null)
                {
                    continue;
                }
                keys.Add(new Rp1FundingCurveKeyRaw
                {
                    Frac = frac.Value,
                    PaidFraction = value.Value,
                    InTangent = ReadDouble(key, "inTangent") ?? 0.0,
                    OutTangent = ReadDouble(key, "outTangent") ?? 0.0,
                });
            }
            return keys;
        }

        // ── Reflection primitives ────────────────────────────────────────────

        private static double? ReadDouble(object? target, string name) => Rp1Types.ReadDouble(target, name);

        private static int? ReadInt(object? target, string name)
        {
            var value = Rp1Types.Member(target, name);
            switch (value)
            {
                case int i: return i;
                case long l: return (int)l;
                case short s: return s;
                default: return null;
            }
        }

        private static bool? ReadBool(object? target, string name) =>
            Rp1Types.Member(target, name) is bool b ? b : (bool?)null;

        private static string? ReadString(object? target, string name) =>
            Rp1Types.Member(target, name) as string;

        /// <summary>
        /// An enum member read as its NAME. RP-1's ordinals are its own business
        /// and shift between releases; a name is stable and is what a client maps.
        /// </summary>
        private static string? EnumName(object? value)
        {
            if (value == null)
            {
                return null;
            }
            try
            {
                var type = value.GetType();
                return type.IsEnum ? Enum.GetName(type, value) : null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The names in one of RP-1's string collections, e.g. its disabled-Program
        /// set. Walked as a bare <see cref="IEnumerable"/> and never cast: RP-1's
        /// collection types come from a separate assembly and change between
        /// releases.
        /// </summary>
        private static HashSet<string> NameSet(object? collection)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            if (!(collection is IEnumerable e) || collection is string)
            {
                return names;
            }
            foreach (var item in e)
            {
                if (item is string s)
                {
                    names.Add(s);
                }
            }
            return names;
        }

        /// <summary>
        /// The names in one of RP-1's ordered string collections, keeping the
        /// order RP-1 declared them in. Distinct from <see cref="NameSet"/>
        /// because a disable list is shown to an operator and a set would reorder
        /// it arbitrarily between runs.
        /// </summary>
        private static List<string> NameList(object? collection)
        {
            var names = new List<string>();
            if (!(collection is IEnumerable e) || collection is string)
            {
                return names;
            }
            foreach (var item in e)
            {
                if (item is string s && s.Length > 0)
                {
                    names.Add(s);
                }
            }
            return names;
        }

        private static List<object> Materialise(object? collection)
        {
            var list = new List<object>();
            if (!(collection is IEnumerable e) || collection is string)
            {
                return list;
            }
            foreach (var item in e)
            {
                if (item != null)
                {
                    list.Add(item);
                }
            }
            return list;
        }

        /// <summary>Zero is RP-1's "this never happened" sentinel on every UT field a Program persists.</summary>
        private static double? ZeroAsAbsent(double? value) =>
            value == null || value.Value == 0.0 ? (double?)null : value;

        private static double? NegativeAsAbsent(double? value) =>
            value == null || value.Value < 0.0 ? (double?)null : value;

        private static string? EmptyAsAbsent(string? value) =>
            string.IsNullOrEmpty(value) ? null : value;
    }
}
