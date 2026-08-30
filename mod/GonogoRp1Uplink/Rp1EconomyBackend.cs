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
//   UnlockCreditHandler.TotalCredit
//       public getter over a private [KSPField(isPersistant)] double. Reads
//       nothing else and computes nothing. The full map of what that number is,
//       every source and sink of it, and why only the balance is carried:
//       local_docs/design/2026-08-26-rp1-unlock-credit.md.
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
// ONE SIGN CONVENTION, and it is not uniform on RP-1's side.
// UpkeepPerDayForDisplay is built by UpdateUpkeep as a sum of currency-modifier
// queries run on NEGATED costs, so it is a funds DELTA and is negative;
// SpaceCenterManagement adds it straight to the subsidy to get a net per-day
// change. Every field in the breakdown beside it is a positive cost. The wire
// carries costs, so the total is negated to match the parts it is made of.
//
// TWO PRICING CONVENTIONS, and they are the reason there are two breakdowns.
// Those raw fields are stated BEFORE the career's currency modifiers and
// UpkeepPerDayForDisplay is stated after them, so publishing the seven under the
// one total was publishing a set that does not add up, on any career running a
// leader that names one of the six upkeep transaction reasons. Five of the six
// are named by leaders RP-1 ships. So the decomposition now carries the same
// per-line query the game runs (Rp1EconomyUpkeepQuery, which also holds the
// field-to-reason pairing and why the query cannot be run from here), and the
// raw figures move to UpkeepBeforeModifiers rather than being dropped: the
// difference between the two is what the career's current arrangements are
// worth, and the raw set is also what survives when the query cannot be asked.
//
// WHAT WE STILL DO NOT SAY. The subsidy is the raw FillSubsidyDetails figure and
// RP-1's Budget tab puts it through a Subsidy-reason query of its own; no leader
// RP-1 ships names that reason, so the two agree today and the mismatch is a
// convention one rather than a live wrong number. RP-1's Budget tab also CLAMPS
// its net at zero (Math.Min(0, upkeep + subsidy)) because FixedUpdate never pays
// out more subsidy than the upkeep consumes; nothing here publishes a net, and
// a client that derives one unclamped will show a surplus the game does not
// grant.
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
        private const string UnlockCreditTypeName = "RP0.UnlockCreditHandler";

        private readonly Type? _maintenance;
        private readonly Type? _subsidyDetails;
        private readonly Type? _database;
        private readonly Type? _unlockCredit;
        private readonly MethodInfo? _fillSubsidyDetails;

        /// <summary>
        /// The main-thread half: RP-1's own price for each upkeep line. Held
        /// rather than called, because asking it fires a game event and this runs
        /// on the Courier thread; see that type's header.
        /// </summary>
        private readonly Rp1EconomyUpkeepQuery _upkeepQuery;

        public string ProviderId => "rp1";

        /// <summary>
        /// RP-1's maintenance types resolved. Gated on the TYPE, never on an
        /// assembly name, for the reason <see cref="Rp1ScReflection"/>'s header
        /// gives: a name match is not evidence the types exist.
        /// </summary>
        public bool IsAvailable => _maintenance != null;

        public Rp1EconomyBackend() : this(new Rp1EconomyUpkeepQuery())
        {
        }

        public Rp1EconomyBackend(Rp1EconomyUpkeepQuery upkeepQuery)
        {
            _upkeepQuery = upkeepQuery;
            _maintenance = Rp1Types.Find(MaintenanceTypeName);
            _database = Rp1Types.Find(DatabaseTypeName);
            _unlockCredit = Rp1Types.Find(UnlockCreditTypeName);
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
                // RP-1's own total, and the parts below are now built to sum to
                // it. Still read rather than summed: the game's own figure is what
                // an operator can check against the game's own screen.
                UpkeepPerDay = AsCost(Rp1Types.ReadDouble(instance, "UpkeepPerDayForDisplay")),
                UpkeepBreakdown = Modified(),
                UpkeepBeforeModifiers = new EconomyUpkeepBreakdown
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
                UnlockCredit = UnlockCreditBalance(),
            };

            FillSubsidy(reading, ut, reputation);
            return reading;
        }

        /// <summary>
        /// The upkeep after RP-1's own per-line currency modifiers, which is what
        /// its Budget tab shows and what its total is made of. Absent, never
        /// substituted, when the query could not be asked: the raw figures under
        /// this key are precisely the disagreement this seam removes, and a
        /// breakdown that silently stopped adding up would be indistinguishable
        /// from one that does.
        /// </summary>
        private EconomyUpkeepBreakdown? Modified()
        {
            var lines = _upkeepQuery.Lines;
            if (lines == null)
            {
                return null;
            }
            return new EconomyUpkeepBreakdown
            {
                Facilities = lines.Facilities,
                LaunchComplexes = lines.LaunchComplexes,
                ResearchSalary = lines.ResearchSalary,
                Training = lines.Training,
                CrewBase = lines.CrewBase,
                CrewInFlight = lines.CrewInFlight,
                IntegrationSalary = lines.IntegrationSalary,
            };
        }

        /// <summary>
        /// RP-1's Unlock Credit: a prepaid, funds-denominated allowance it spends
        /// before funds on part and upgrade entry costs and on tooling, and on
        /// nothing else. Null when its handler is absent, which is also how a
        /// stock save answers.
        /// </summary>
        /// <remarks>
        /// <para>A plain field read through a public getter over a persisted
        /// <c>double</c>, so unlike the upkeep figures above there is no cadence
        /// to it and no staleness: it is exact at the instant it is read. The
        /// handler's scenario module is registered for SpaceCenter, Editor,
        /// Flight and TrackingStation, so there is no career scene where a
        /// balance exists and cannot be read.</para>
        /// <para>The BALANCE only. What a given purchase would actually draw from
        /// it comes from <c>GetPrePostCostAndAffordability</c>, which runs a
        /// currency-modifier query, and a query broadcasts a game event to every
        /// modifier in the save: a thing to run when an operator commits, not a
        /// thing to sample every tick. Same reasoning that keeps
        /// <see cref="DecayPerDay"/> off RP-1's own tooltip figure.</para>
        /// <para>Accrual is deliberately not derived here. It is a fraction of the
        /// researcher salary bill, rebated ONLY while a tech node is actually
        /// progressing in the research queue, and RP-1's own forecast puts the
        /// result through the same broadcasting query. A single per-day scalar
        /// would claim a steady stream that an idle queue does not produce.</para>
        /// </remarks>
        private double? UnlockCreditBalance()
        {
            if (_unlockCredit == null)
            {
                return null;
            }
            var instance = Rp1Types.StaticValue(_unlockCredit, "Instance");
            // No zero-substitute on an absent instance: RP-1's handler not being
            // live is a different fact from an allowance spent down to nothing,
            // and a career genuinely can hold zero credit.
            return instance == null ? (double?)null : Rp1Types.ReadDouble(instance, "TotalCredit");
        }

        /// <summary>
        /// Reputation actually lost tomorrow, which is the portion RP-1 applies
        /// times the reputation there is to lose. Absent when either half is
        /// unreadable: a decay figure computed from an assumed reputation would be
        /// a fabrication about the operator's income.
        /// </summary>
        /// <remarks>
        /// This is the raw figure RP-1's own daily tick subtracts, and not the
        /// one its reputation tooltip prints: the tooltip puts the same product
        /// through a currency-modifier query first, so a leader or strategy that
        /// softens the decline moves the tooltip and not this. That query
        /// broadcasts a game event to every modifier in the save, which is a
        /// thing to run and not a thing to read, so it stays uncalled.
        /// </remarks>
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

        /// <summary>
        /// RP-1's signed funds delta as a positive cost, which is the direction
        /// every field in the breakdown already uses and the direction the
        /// contract declares. Zero stays zero rather than becoming a negative
        /// one, which survives JSON and prints as "-0".
        /// </summary>
        private static double? AsCost(double? fundsDelta) =>
            fundsDelta == null ? (double?)null
                : fundsDelta.Value == 0.0 ? 0.0
                : -fundsDelta.Value;
    }
}
