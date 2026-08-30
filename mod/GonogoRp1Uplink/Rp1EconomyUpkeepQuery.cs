/*
 * RP-1's own price for each line of the standing upkeep, asked the way RP-1 asks
 * it. No compile-time reference to RP0.dll, the same arm's-length reflection
 * pattern as Rp1ScReflection, whose header carries the provenance rules this
 * file follows.
 *
 * WHY THIS EXISTS. MaintenanceHandler states its per-source costs and its total
 * in two different conventions, and we were publishing one of each:
 *
 *   FacilityUpkeepPerDay, LCsCostPerDay, ResearchSalaryPerDay,
 *   TrainingUpkeepPerDay, NautBaseUpkeepPerDay, NautInFlightUpkeepPerDay and
 *   IntegrationSalaryPerDay are the raw costs, before any modifier.
 *
 *   UpkeepPerDayForDisplay is built by UpdateUpkeep as the SUM of six
 *   CurrencyUtils.Funds(reason, -cost) queries, one per line, each with its own
 *   TransactionReasonsRP0. So it is stated AFTER the career's modifiers.
 *
 * A leader or strategy that names one of those six reasons therefore moved the
 * total and not the parts, and our seven parts stopped summing to our total and
 * stopped agreeing with RP-1's own Budget tab. That is not a corner case: of the
 * CurrencyModifier effects RP-1 ships on its leaders, five of the six upkeep
 * reasons are named by at least one (CrewTraining by four, SalaryCrew by two,
 * SalaryResearchers, StructureRepairLC and the composite Salary by one each).
 *
 * THE PAIRING, read out of UpdateUpkeep rather than guessed from the names,
 * because two of them are structure-repair variants:
 *
 *   FacilityUpkeepPerDay      StructureRepair
 *   LCsCostPerDay             StructureRepairLC     <- the launch-complex one
 *   IntegrationSalaryPerDay   SalaryEngineers
 *   ResearchSalaryPerDay      SalaryResearchers
 *   NautBase + NautInFlight   SalaryCrew
 *   TrainingUpkeepPerDay      CrewTraining
 *
 * THE CREW LINE IS SPLIT HERE, and RP-1 disagrees with itself about it.
 * UpdateUpkeep runs ONE SalaryCrew query on base + in-flight; MaintenanceGUI's
 * Budget tab runs TWO and adds them. GetTotal is affine
 * (input * multiplier + postMultiplierDelta), so the two differ by one copy of
 * any post-multiplier delta. Nothing in RP-1's leader model can produce one:
 * RP0.Leaders.CurrencyModifier only ever calls Multiply. So the two agree today,
 * the split is what the operator's own screen shows, and it is the split the
 * wire already carries.
 *
 * MAIN THREAD, WHICH IS THE WHOLE REASON THIS IS A SEPARATE CAPTURE.
 * CurrencyUtils.Funds runs CurrencyModifierQueryRP0.RunQuery, which FIRES
 * GameEvents.Modifiers.OnCurrencyModifierQuery at every modifier in the save.
 * Rp1EconomyBackend.Interpret is reached from a channel mapper, and a channel
 * mapper runs on the Courier thread (IUplinkHost.AddSampledSource's own doc says
 * so). Firing a Unity game event into arbitrary third-party listeners from a
 * background thread is not a thing to do at any cadence, so the query lives here
 * and the backend reads what this left behind.
 *
 * UNGATED, AND THROTTLED FROM THE INSIDE INSTEAD. The capture writes state a
 * DIFFERENT topic's mapper reads (core's career.status), and AddSampledSource is
 * explicit that a subscription gate on one of those starves it silently, with no
 * log line and no degraded mode. So the cost is controlled by a change-gate on
 * the eight numbers RP-1 derives the queries from: unchanged inputs mean
 * UpdateUpkeep produced the same six answers, so the cached lines still hold. A
 * tick where nothing moved costs eight cached-MemberInfo reads and no broadcast
 * at all.
 *
 * A FIELD YOU CAN READ IS NOT NECESSARILY A FIELD THAT IS TRUE, so the cadence,
 * as read from MaintenanceHandler.Update: UpdateUpkeep runs when
 * Planetarium UT passes nextUpdate, which is set an hour ahead
 * (UpdateInterval = 3600) below 100x warp and up to a full in-game day above it,
 * and Update returns immediately for the whole of a simulated flight. So a
 * leader activated now is reflected here within an in-game hour of normal play,
 * and the figures freeze entirely inside one of RP-1's rehearsals. That is
 * RP-1's own staleness, and it is the staleness the raw fields already carried.
 */
using System;
using System.Reflection;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The six upkeep lines after RP-1's own currency modifiers, per day, as
    /// positive costs. Plain data with no live RP-1 object in it, so it can cross
    /// the capture/handle seam.
    /// </summary>
    /// <remarks>
    /// Every member nullable and null-together in practice: the query either runs
    /// for all six or for none, because what makes it unavailable is the type
    /// missing rather than one line failing.
    /// </remarks>
    public sealed class Rp1UpkeepLines
    {
        public double? Facilities;
        public double? LaunchComplexes;
        public double? ResearchSalary;
        public double? Training;
        public double? CrewBase;
        public double? CrewInFlight;
        public double? IntegrationSalary;
    }

    /// <summary>
    /// Runs RP-1's per-line currency-modifier query on the main thread and hands
    /// the answers to <see cref="Rp1EconomyBackend"/>, which reads them from the
    /// Courier thread.
    /// </summary>
    public sealed class Rp1EconomyUpkeepQuery
    {
        private const string MaintenanceTypeName = "RP0.MaintenanceHandler";
        private const string CurrencyUtilsTypeName = "RP0.CurrencyUtils";
        private const string TransactionReasonsTypeName = "RP0.TransactionReasonsRP0";

        /// <summary>
        /// RP-1's own reason per line. Positional: paired with
        /// <see cref="UpkeepFields"/> index for index, and both orders are read
        /// out of UpdateUpkeep.
        /// </summary>
        private static readonly string[] UpkeepReasons =
        {
            "StructureRepair",
            "StructureRepairLC",
            "SalaryResearchers",
            "CrewTraining",
            "SalaryCrew",
            "SalaryCrew",
            "SalaryEngineers",
        };

        /// <summary>The RP-1 field each line is priced from.</summary>
        private static readonly string[] UpkeepFields =
        {
            "FacilityUpkeepPerDay",
            "LCsCostPerDay",
            "ResearchSalaryPerDay",
            "TrainingUpkeepPerDay",
            "NautBaseUpkeepPerDay",
            "NautInFlightUpkeepPerDay",
            "IntegrationSalaryPerDay",
        };

        private readonly Type? _maintenance;
        private readonly Type? _currencyUtils;
        private readonly Type? _transactionReasons;
        private readonly MethodInfo? _funds;

        /// <summary>
        /// Main-thread only: the inputs the cached answers were computed from, so
        /// a tick where nothing moved skips the broadcast. Seven raw costs plus
        /// RP-1's own total, which moves whenever UpdateUpkeep re-ran the same six
        /// queries and got a different answer.
        /// </summary>
        private readonly double?[] _lastInputs = new double?[UpkeepFields.Length + 1];

        private Rp1UpkeepLines? _cached;
        private bool _primed;

        /// <summary>
        /// The last answers, or null while none have been computed. Written on the
        /// Courier thread by <see cref="HandleOnCourier"/> and read there by the
        /// backend, so a plain field would do; volatile because the two are not
        /// the same call and nothing else orders them.
        /// </summary>
        private volatile Rp1UpkeepLines? _published;

        public Rp1EconomyUpkeepQuery()
        {
            _maintenance = Rp1Types.Find(MaintenanceTypeName);
            _currencyUtils = Rp1Types.Find(CurrencyUtilsTypeName);
            _transactionReasons = Rp1Types.Find(TransactionReasonsTypeName);
            if (_currencyUtils != null)
            {
                // Arity 3: UpdateUpkeep calls the two-argument form, which is this
                // one with includeHidden defaulted. A reflected call supplies no
                // defaults, so the flag is passed explicitly below.
                _funds = Rp1Types.StaticMethod(_currencyUtils, "Funds", 3);
            }
        }

        /// <summary>
        /// Whether the query can be asked at all. False takes the modified
        /// breakdown off the wire rather than substituting the raw figures for it:
        /// the raw ones under that key are exactly the bug this exists to fix.
        /// </summary>
        public bool IsAvailable => _funds != null && _transactionReasons != null;

        /// <summary>The last answers, for the backend. Null until a capture has produced some.</summary>
        public Rp1UpkeepLines? Lines => _published;

        /// <summary>
        /// MAIN-THREAD capture. Returns the six lines as plain data, recomputing
        /// them only when RP-1's own inputs moved.
        /// </summary>
        public object? CaptureOnMain(KspSnapshot? snapshot)
        {
            if (!IsAvailable || _maintenance == null)
            {
                return null;
            }
            var instance = Rp1Types.StaticValue(_maintenance, "Instance");
            if (instance == null)
            {
                // RP-1 installed but its maintenance module not live. Clearing
                // rather than holding: the next save that does have one must not
                // inherit the last one's prices.
                _primed = false;
                _cached = null;
                return null;
            }

            if (!InputsMoved(instance))
            {
                return _cached;
            }

            _cached = Price(instance);
            return _cached;
        }

        /// <summary>
        /// COURIER-THREAD handle. Publishes what the capture found, touching no
        /// game API. A skipped capture (RP-1 not live) publishes null, which is
        /// the same thing the backend does with it as never having run.
        /// </summary>
        public void HandleOnCourier(object? captured) => _published = captured as Rp1UpkeepLines;

        /// <summary>
        /// Whether any number the six queries are derived from has changed since
        /// the cached answers were computed, and records the current ones either
        /// way.
        /// </summary>
        /// <remarks>
        /// UpkeepPerDayForDisplay is in the set, and it is the half that catches a
        /// modifier changing while the raw costs do not: RP-1 rebuilds it from the
        /// same six queries on the same tick it refreshes them. A modifier whose
        /// effect on the total cancels out exactly would slip through, which costs
        /// the operator one refresh interval and cannot make the parts disagree
        /// with the total, since both are then unchanged.
        /// </remarks>
        private bool InputsMoved(object instance)
        {
            var moved = !_primed;
            for (var i = 0; i < UpkeepFields.Length; i++)
            {
                var now = Rp1Types.ReadDouble(instance, UpkeepFields[i]);
                moved |= now != _lastInputs[i];
                _lastInputs[i] = now;
            }
            var total = Rp1Types.ReadDouble(instance, "UpkeepPerDayForDisplay");
            moved |= total != _lastInputs[UpkeepFields.Length];
            _lastInputs[UpkeepFields.Length] = total;
            _primed = true;
            return moved;
        }

        /// <summary>
        /// The six queries. One failure takes all six, because a breakdown with a
        /// hole in it does not sum to the total and the hole would be invisible
        /// beside six numbers that look fine.
        /// </summary>
        private Rp1UpkeepLines? Price(object instance)
        {
            try
            {
                var priced = new double?[UpkeepFields.Length];
                for (var i = 0; i < UpkeepFields.Length; i++)
                {
                    var raw = Rp1Types.ReadDouble(instance, UpkeepFields[i]);
                    if (raw == null)
                    {
                        return null;
                    }
                    priced[i] = AsCost(Charge(UpkeepReasons[i], raw.Value));
                }
                return new Rp1UpkeepLines
                {
                    Facilities = priced[0],
                    LaunchComplexes = priced[1],
                    ResearchSalary = priced[2],
                    Training = priced[3],
                    CrewBase = priced[4],
                    CrewInFlight = priced[5],
                    IntegrationSalary = priced[6],
                };
            }
            catch (Exception)
            {
                // fail-soft: an unaskable query costs the modified breakdown and
                // leaves the unmodified one standing. Never a substitution, which
                // is the bug this file exists to remove.
                return null;
            }
        }

        /// <summary>
        /// What RP-1 says this line comes to, as the funds DELTA it answers in.
        /// The cost is negated on the way in because that is how UpdateUpkeep asks:
        /// the query is about a transaction, and a transaction that costs money is
        /// a negative one.
        /// </summary>
        private double? Charge(string reason, double cost)
        {
            var parsed = Enum.Parse(_transactionReasons!, reason);
            return Rp1Types.ToDouble(_funds!.Invoke(null, new object[] { parsed, -cost, false }));
        }

        /// <summary>
        /// A signed funds delta as a positive cost, matching the direction the
        /// contract declares. Zero stays zero rather than becoming a negative one,
        /// which survives JSON and prints as "-0".
        /// </summary>
        private static double? AsCost(double? fundsDelta) =>
            fundsDelta == null ? (double?)null
                : fundsDelta.Value == 0.0 ? 0.0
                : -fundsDelta.Value;
    }
}
