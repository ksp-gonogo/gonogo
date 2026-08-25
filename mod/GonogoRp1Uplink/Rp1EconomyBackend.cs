// RP-1's money model, read by reflection. No compile-time reference to RP0.dll,
// same arm's-length pattern as Rp1ScReflection, whose header carries the
// provenance rules this file follows.
//
// PROVENANCE. Every member below was read out of an ilspycmd disassembly of the
// SHIPPED RP-1 v4.6.0.0 RP0.dll. Nothing here has been seen in a running game.
//
// WHAT THIS ANSWERS, and why it is a capability rather than a topic of its own.
// Reputation under RP-1 is not a score, it is INCOME: it decays every day and it
// sets a funding subsidy, against which a continuous per-day upkeep runs. The
// stock reputation field is read correctly by core and always was; what was
// missing is the context that makes it legible. So this backend interprets a
// number it is HANDED rather than one it reads, which is also what keeps this
// assembly KSP-free.
//
// EVERY MEMBER CALLED HERE HAS HAD ITS BODY READ:
//
//   MaintenanceHandler.FillSubsidyDetails(ref SubsidyDetails, ut, rep)
//       static, public, and PURE. Evaluates Database.SettingsSC.subsidyCurve,
//       reads subsidyMultiplierForMax and repToSubsidyConversion, and writes
//       only its ref struct. It is the same call RP-1's own reputation tooltip
//       makes. This was the one member the spec flagged as not yet vouched for.
//   MaintenanceHandler.FacilityUpkeepPerDay
//       public getter, a LINQ Sum over its own dictionary. Pure.
//   MaintenanceHandler.IntegrationSalaryPerDay
//       public getter, sums its own dictionary and scales by a settings value.
//       Pure.
//
// The rest are plain public fields: LCsCostPerDay, ResearchSalaryPerDay,
// TrainingUpkeepPerDay, NautBaseUpkeepPerDay, NautInFlightUpkeepPerDay,
// UpkeepPerDayForDisplay, and Database.SettingsSC.repPortionLostPerDay.
//
// A FIELD YOU CAN READ IS NOT NECESSARILY A FIELD THAT IS TRUE, so: those upkeep
// fields are written by MaintenanceHandler.UpdateUpkeep, called from RP-1's own
// Update() on an hourly UT cadence and on first load, NOT only while its
// maintenance window is open. So they are safe to read whenever, and they may be
// up to an in-game hour stale, or up to a day under high time warp. That is
// RP-1's own figure at its own cadence, which is the number its UI shows too.
//
// TWO UNIT CONVERSIONS, both from RP-1's own arithmetic rather than assumed:
//   the subsidy is a YEARLY figure over a JULIAN year (FillSubsidyDetails divides
//   ut by 31,557,600 = 365.25 days), so a per-day figure is that over 365.25. Not
//   a game day, and not 365.
//   repPortionLostPerDay is a PORTION, applied by RP-1 as rep * portion once per
//   86,400s. The absolute daily loss is what an operator can act on, so that is
//   what goes on the wire.
using System;
using System.Reflection;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The <c>"economy"</c> capability's RP-1 provider: reputation decay, the
    /// funding subsidy it buys, and the standing cost running against it.
    /// </summary>
    public sealed class Rp1EconomyBackend : IEconomyBackend
    {
        /// <summary>Days in the Julian year RP-1's subsidy curve is sampled over.</summary>
        private const double SubsidyYearDays = 365.25;

        private const string MaintenanceTypeName = "RP0.MaintenanceHandler";
        private const string DatabaseTypeName = "RP0.Database";

        private readonly Type? _maintenance;
        private readonly Type? _subsidyDetails;
        private readonly Type? _database;
        private readonly MethodInfo? _fillSubsidyDetails;

        public string ProviderId => "rp1";

        /// <summary>
        /// RP-1's maintenance types resolved. Gated on the TYPE, never on an
        /// assembly name, for the reason <see cref="Rp1ScReflection"/>'s header
        /// gives: a name match is not evidence the types exist.
        /// </summary>
        public bool IsAvailable => _maintenance != null;

        public Rp1EconomyBackend()
        {
            _maintenance = Rp1Types.Find(MaintenanceTypeName);
            _database = Rp1Types.Find(DatabaseTypeName);
            // A nested struct, so the name carries the outer type's.
            _subsidyDetails = Rp1Types.Find(MaintenanceTypeName + "+SubsidyDetails");
            if (_maintenance != null)
            {
                try
                {
                    _fillSubsidyDetails = _maintenance.GetMethod(
                        "FillSubsidyDetails",
                        BindingFlags.Public | BindingFlags.Static);
                }
                catch (Exception)
                {
                    // fail-soft: an absent subsidy calculator costs three fields,
                    // never the reading
                }
            }
        }

        public EconomyReading? Interpret(double ut, double? reputation)
        {
            if (_maintenance == null)
            {
                return null;
            }
            var instance = Rp1Types.StaticValue(_maintenance, "Instance");
            if (instance == null)
            {
                // RP-1 is installed but its maintenance module is not live: the
                // main menu, or a save it does not manage. Nothing to say, and a
                // bag of zeros here would say stock's answer in RP-1's name.
                return null;
            }

            var reading = new EconomyReading
            {
                // RP-1's own total, as its own UI shows it, rather than our sum of
                // the parts below: if the two ever disagree, the operator should
                // see the game's figure.
                UpkeepPerDay = Rp1Types.ReadDouble(instance, "UpkeepPerDayForDisplay"),
                UpkeepBreakdown = new EconomyUpkeepBreakdown
                {
                    Facilities = Rp1Types.ReadDouble(instance, "FacilityUpkeepPerDay"),
                    LaunchComplexes = Rp1Types.ReadDouble(instance, "LCsCostPerDay"),
                    ResearchSalary = Rp1Types.ReadDouble(instance, "ResearchSalaryPerDay"),
                    Training = Rp1Types.ReadDouble(instance, "TrainingUpkeepPerDay"),
                    CrewBase = Rp1Types.ReadDouble(instance, "NautBaseUpkeepPerDay"),
                    CrewInFlight = Rp1Types.ReadDouble(instance, "NautInFlightUpkeepPerDay"),
                    IntegrationSalary = Rp1Types.ReadDouble(instance, "IntegrationSalaryPerDay"),
                },
                ReputationDecayPerDay = DecayPerDay(reputation),
            };

            FillSubsidy(reading, ut, reputation);
            return reading;
        }

        /// <summary>
        /// Reputation actually lost tomorrow, which is the portion RP-1 applies
        /// times the reputation there is to lose. Absent when either half is
        /// unreadable: a decay figure computed from an assumed reputation would be
        /// a fabrication about the operator's income.
        /// </summary>
        private double? DecayPerDay(double? reputation)
        {
            if (reputation == null || _database == null)
            {
                return null;
            }
            var settings = Rp1Types.StaticValue(_database, "SettingsSC");
            var portion = settings == null ? null : Rp1Types.ReadDouble(settings, "repPortionLostPerDay");
            return portion == null ? (double?)null : reputation.Value * portion.Value;
        }

        /// <summary>
        /// The subsidy this reputation buys, and the floor and ceiling it sits
        /// between. All three absent together when the calculator cannot be
        /// called: a subsidy with no range around it does not answer the question
        /// the operator is asking, which is how much of the range they have
        /// bought.
        /// </summary>
        private void FillSubsidy(EconomyReading reading, double ut, double? reputation)
        {
            if (_fillSubsidyDetails == null || _subsidyDetails == null || reputation == null)
            {
                return;
            }
            try
            {
                // The struct travels boxed, in the args array, because that is how
                // a `ref` parameter reaches a reflected call: the method writes
                // into the box and we read the box back.
                var details = Activator.CreateInstance(_subsidyDetails);
                var args = new object?[] { details, ut, reputation.Value };
                _fillSubsidyDetails.Invoke(null, args);
                var filled = args[0];
                if (filled == null)
                {
                    return;
                }
                reading.SubsidyPerDay = PerDay(Rp1Types.ReadDouble(filled, "subsidy"));
                reading.SubsidyMinPerDay = PerDay(Rp1Types.ReadDouble(filled, "minSubsidy"));
                reading.SubsidyMaxPerDay = PerDay(Rp1Types.ReadDouble(filled, "maxSubsidy"));
            }
            catch (Exception)
            {
                // fail-soft: an uncallable calculator leaves the three subsidy
                // fields absent and the upkeep standing. Never a zero, which would
                // read as "your programme is funded at nothing".
            }
        }

        /// <summary>A yearly subsidy as a daily one. RP-1's year here is Julian, not a game year.</summary>
        private static double? PerDay(double? perYear) =>
            perYear == null ? (double?)null : perYear.Value / SubsidyYearDays;
    }
}
