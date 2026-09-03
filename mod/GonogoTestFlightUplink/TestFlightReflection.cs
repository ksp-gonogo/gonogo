// mod/GonogoTestFlightUplink/TestFlightReflection.cs
// Reflection-only bridge to TestFlight. No compile-time reference to TestFlight*.dll.
//
// Every member below was resolved against the INSTALLED TestFlight v2.12.0.0
// (GameData/TestFlight/Plugins/{TestFlight,TestFlightAPI,TestFlightCore}.dll,
// decompiled 2026-08-29). The layer this replaces reflected for
// GetCurrentReliability, GetCurrentFailureRate and GetRatedBurnTime, none of which
// exists in any TestFlight assembly, and bound with Type.EmptyTypes, which
// structurally cannot reach the two methods that DO exist and take a RatingScope.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using Sitrep.Contract;

namespace GonogoTestFlightUplink
{
    public sealed class TestFlightReflection
    {
        private const BindingFlags Instance = BindingFlags.Public | BindingFlags.Instance;
        private const BindingFlags Static = BindingFlags.Public | BindingFlags.Static;

        private readonly Assembly? _asm;

        private readonly Type? _coreInterface;      // TestFlightAPI.ITestFlightCore
        private readonly Type? _reliabilityInterface; // TestFlightAPI.ITestFlightReliability
        private readonly Type? _failureInterface;   // TestFlightAPI.ITestFlightFailure
        private readonly Type? _util;               // TestFlightAPI.TestFlightUtil
        private readonly Type? _ratingScope;        // TestFlightAPI.RatingScope

        private readonly MethodInfo? _getPartStatus;
        private readonly MethodInfo? _getActiveFailures;
        private readonly MethodInfo? _getFlightData;
        private readonly MethodInfo? _getRunTime;
        private readonly PropertyInfo? _title;
        private readonly PropertyInfo? _alias;
        private readonly PropertyInfo? _configuration;
        private readonly PropertyInfo? _testFlightEnabled;
        private readonly PropertyInfo? _activeConfiguration;

        private readonly MethodInfo? _getRatedTime;
        private readonly MethodInfo? _getBaseFailureRate;

        private readonly MethodInfo? _getReliabilityModules;
        private readonly MethodInfo? _failureRateToReliability;
        private readonly MethodInfo? _getFailureDetails;

        private readonly MethodInfo? _canAttemptRepair;
        private readonly MethodInfo? _forceRepair;

        private readonly object? _scopeCumulative;
        private readonly object? _scopeContinuous;

        private readonly List<string> _bound = new();
        private readonly List<string> _unbound = new();

        public bool IsAvailable => _asm != null && _coreInterface != null;

        /// <summary>
        /// Whether the one member that decides a part's CONDITION resolved. A
        /// partially-bound binder (this bound, the rated-time reads not) still
        /// models reliability: budgets are simply absent, and absent is not the
        /// same as unreadable.
        /// </summary>
        public bool BoundPartStatus => _getPartStatus != null;

        /// <summary>What resolved and what did not, for the provider's extension namespace.</summary>
        public TestFlightBindingReport Binding => new()
        {
            Bound = _bound.ToArray(),
            Unbound = _unbound.ToArray(),
        };

        public TestFlightReflection()
        {
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                var n = a.GetName().Name;
                if (n != null && n.StartsWith("TestFlight", StringComparison.OrdinalIgnoreCase))
                {
                    _asm = a;
                    break;
                }
            }

            _coreInterface = FindType("TestFlightAPI.ITestFlightCore");
            _reliabilityInterface = FindType("TestFlightAPI.ITestFlightReliability");
            _failureInterface = FindType("TestFlightAPI.ITestFlightFailure");
            _util = FindType("TestFlightAPI.TestFlightUtil");
            _ratingScope = FindType("TestFlightAPI.RatingScope");

            _getPartStatus = Method("ITestFlightCore.GetPartStatus", _coreInterface, "GetPartStatus", Type.EmptyTypes);
            _getActiveFailures = Method("ITestFlightCore.GetActiveFailures", _coreInterface, "GetActiveFailures", Type.EmptyTypes);
            _getFlightData = Method("ITestFlightCore.GetFlightData", _coreInterface, "GetFlightData", Type.EmptyTypes);
            _title = Property("ITestFlightCore.Title", _coreInterface, "Title");
            _alias = Property("ITestFlightCore.Alias", _coreInterface, "Alias");
            _configuration = Property("ITestFlightCore.Configuration", _coreInterface, "Configuration");
            _testFlightEnabled = Property("ITestFlightCore.TestFlightEnabled", _coreInterface, "TestFlightEnabled");
            _activeConfiguration = Property("ITestFlightCore.ActiveConfiguration", _coreInterface, "ActiveConfiguration");

            // The two RatingScope-taking reads. Bound by SIGNATURE, which is the
            // whole reason the old layer could not reach them.
            _getRunTime = _ratingScope == null
                ? Missing<MethodInfo>("ITestFlightCore.GetRunTime(RatingScope)")
                : Method("ITestFlightCore.GetRunTime(RatingScope)", _coreInterface, "GetRunTime", new[] { _ratingScope });
            _getRatedTime = _ratingScope == null
                ? Missing<MethodInfo>("ITestFlightReliability.GetRatedTime(RatingScope)")
                : Method("ITestFlightReliability.GetRatedTime(RatingScope)", _reliabilityInterface, "GetRatedTime", new[] { _ratingScope });

            _getBaseFailureRate = Method(
                "ITestFlightReliability.GetBaseFailureRate(float)",
                _reliabilityInterface, "GetBaseFailureRate", new[] { typeof(float) });
            _getReliabilityModules = Method(
                "TestFlightUtil.GetReliabilityModules",
                _util, "GetReliabilityModules", new[] { typeof(Part), typeof(string), typeof(bool) }, isStatic: true);
            _failureRateToReliability = Method(
                "TestFlightUtil.FailureRateToReliability",
                _util, "FailureRateToReliability", new[] { typeof(double), typeof(float) }, isStatic: true);
            _getFailureDetails = Method(
                "ITestFlightFailure.GetFailureDetails", _failureInterface, "GetFailureDetails", Type.EmptyTypes);

            /*
             * TestFlight's repair path, and the whole of it. AttemptRepair() and
             * GetRepairTime() are also on ITestFlightFailure, but nothing in any
             * TestFlight assembly calls either and no shipped failure module
             * overrides them: the base returns 0f from both. ForceRepair is what
             * TestFlight's own ResetAllFailuresOnVessel drives.
             *
             * ITestFlightCore.ForceRepair(failure) rather than the failure's own
             * ForceRepair(): the core's version calls it AND removes the failure
             * from the core's list and recomputes hasMajorFailure. Calling the
             * failure directly clears the part and leaves the core still
             * reporting it, so the row would repair and stay red.
             */
            _canAttemptRepair = Method(
                "ITestFlightFailure.CanAttemptRepair", _failureInterface, "CanAttemptRepair", Type.EmptyTypes);
            _forceRepair = _failureInterface == null
                ? Missing<MethodInfo>("ITestFlightCore.ForceRepair(ITestFlightFailure)")
                : Method(
                    "ITestFlightCore.ForceRepair(ITestFlightFailure)",
                    _coreInterface, "ForceRepair", new[] { _failureInterface });

            if (_ratingScope != null && _ratingScope.IsEnum)
            {
                _scopeCumulative = EnumValue(_ratingScope, "Cumulative");
                _scopeContinuous = EnumValue(_ratingScope, "Continuous");
                Record("RatingScope.Cumulative", _scopeCumulative != null);
                Record("RatingScope.Continuous", _scopeContinuous != null);
            }
            else
            {
                Record("RatingScope.Cumulative", false);
                Record("RatingScope.Continuous", false);
            }
        }

        /// <summary>
        /// One raw reading per ACTIVE TestFlight core on the vessel. A read that
        /// did not bind, or threw, leaves its field null; nothing is substituted.
        /// </summary>
        public IEnumerable<EngineReliabilityRaw> Engines(Vessel v)
        {
            if (!IsAvailable || v?.parts == null) yield break;
            foreach (var part in v.parts)
            {
                if (part?.Modules == null) continue;
                foreach (PartModule pm in part.Modules)
                {
                    if (pm == null || _coreInterface == null) continue;
                    if (!_coreInterface.IsAssignableFrom(pm.GetType())) continue;
                    // A core that TestFlight itself is not running, or that belongs
                    // to a config other than the flying one, is not this part's
                    // reliability model and must not be reported as one.
                    if (Bool(_testFlightEnabled, pm) == false) continue;
                    if (Bool(_activeConfiguration, pm) == false) continue;
                    yield return Read(part, pm);
                }
            }
        }

        private EngineReliabilityRaw Read(Part part, object core)
        {
            var alias = Str(_alias, core);
            var flightData = Num(Invoke(_getFlightData, core));
            var raw = new EngineReliabilityRaw
            {
                PartId = part.flightID.ToString(),
                Title = Str(_title, core) ?? part.partInfo?.title ?? part.name,
                Configuration = Str(_configuration, core) ?? alias,
                PartStatus = Int(Invoke(_getPartStatus, core)),
                FlightData = flightData,
                FailureTitles = FailureTitles(core),
                RunCumulativeSeconds = Num(Invoke(_getRunTime, core, _scopeCumulative)),
                RunContinuousSeconds = Num(Invoke(_getRunTime, core, _scopeContinuous)),
            };

            // Rated times live on the RELIABILITY modules, run times on the core:
            // the two halves are on different objects, which is precisely what a
            // no-arg core-only reflection could never reach.
            var modules = ReliabilityModules(part, alias);
            double? ratedCumulative = null;
            double? ratedContinuous = null;
            double? baseRate = null;
            foreach (var module in modules)
            {
                ratedCumulative = MaxOf(ratedCumulative, Num(Invoke(_getRatedTime, module, _scopeCumulative)));
                ratedContinuous = MaxOf(ratedContinuous, Num(Invoke(_getRatedTime, module, _scopeContinuous)));
                // Evaluated at LIVE flight data, not the no-arg cached
                // GetBaseFailureRate(), which evaluates at initialFlightData and so
                // never moves during a mission.
                if (flightData.HasValue)
                {
                    var rate = Num(Invoke(_getBaseFailureRate, module, (float)flightData.Value));
                    if (rate.HasValue) baseRate = (baseRate ?? 0.0) + rate.Value;
                }
            }
            raw.RatedCumulativeSeconds = ratedCumulative;
            raw.RatedContinuousSeconds = ratedContinuous;
            raw.BaseFailureRate = baseRate;

            // Deliberately NOT GetWorstMomentaryFailureRate(): the momentary list is
            // empty before first ignition and returns default(MomentaryFailureRate)
            // with valid == false and failureRate == 0, which would render as a
            // perfect pre-launch score. The base rate at live flight data is the
            // number TestFlight's own GUI quotes, over the cumulative rating.
            if (baseRate.HasValue && ratedCumulative is > 0)
            {
                raw.Survival = Survival(baseRate.Value, ratedCumulative.Value);
                if (raw.Survival.HasValue) raw.SurvivalHorizonSeconds = ratedCumulative;
            }
            return raw;
        }

        /// <summary>
        /// Repair one published part id, through TestFlight's own
        /// <c>ITestFlightCore.ForceRepair</c>.
        ///
        /// <para>The crew name is deliberately unused, and that is TestFlight's
        /// answer rather than an omission: its repair path has no crew check, no
        /// consumable, no EVA condition and no duration anywhere in the shipped
        /// model. Inventing one here would put a second authority beside the one
        /// that acts, and would refuse repairs the game allows. The reason it is
        /// still on the interface is that another backend's path genuinely
        /// needs it.</para>
        ///
        /// <para>A repair also AWARDS flight data (<c>duRepair</c>, read from the
        /// part's config), which is why this must never be simulated: the state
        /// change belongs to TestFlight.</para>
        /// </summary>
        public RepairOutcome Repair(Vessel? v, string partId)
        {
            var outcome = new RepairOutcome();
            if (!IsAvailable || _forceRepair == null || _getActiveFailures == null)
            {
                outcome.Refusal = RepairRefusal.NotModelled;
                return outcome;
            }
            if (!TestFlightRepairScope.TryParsePartId(partId, out var flightId, out var occurrence)
                || v?.parts == null)
            {
                outcome.Refusal = RepairRefusal.NoSuchPart;
                return outcome;
            }

            var core = CoreAt(v, flightId, occurrence);
            var repairable = RepairableFailures(core);
            var refusal = TestFlightRepairScope.RefusalFor(
                core != null, ActiveFailureCount(core), repairable.Count);
            if (refusal != null)
            {
                outcome.Refusal = refusal;
                return outcome;
            }

            foreach (var failure in repairable)
            {
                Invoke(_forceRepair, core, failure);
            }

            outcome.Repaired = TestFlightRepairScope.Cleared(
                repairable.Count, RepairableFailures(core).Count);
            if (!outcome.Repaired)
            {
                // TestFlight gates a repair on nothing an operator can change, so
                // a ForceRepair that left the failure standing is the mod
                // declining without saying more, not a fact about the crew.
                outcome.Refusal = RepairRefusal.Refused;
            }
            return outcome;
        }

        /// <summary>
        /// The <paramref name="occurrence"/>-th ACTIVE core on the part with this
        /// flightID, walked in the same order and with the same two liveness
        /// filters <see cref="Engines"/> uses to mint the id. Two different walks
        /// would number the cores differently and repair the wrong one.
        /// </summary>
        private object? CoreAt(Vessel v, uint flightId, int occurrence)
        {
            var seen = 0;
            foreach (var part in v.parts)
            {
                if (part == null || part.flightID != flightId || part.Modules == null) continue;
                foreach (PartModule pm in part.Modules)
                {
                    if (pm == null || _coreInterface == null) continue;
                    if (!_coreInterface.IsAssignableFrom(pm.GetType())) continue;
                    if (Bool(_testFlightEnabled, pm) == false) continue;
                    if (Bool(_activeConfiguration, pm) == false) continue;
                    if (seen == occurrence) return pm;
                    seen++;
                }
            }
            return null;
        }

        private int ActiveFailureCount(object? core)
        {
            if (core == null) return 0;
            var count = 0;
            if (Invoke(_getActiveFailures, core) is IEnumerable failures)
            {
                foreach (var failure in failures)
                {
                    if (failure != null) count++;
                }
            }
            return count;
        }

        /// <summary>
        /// The active failures this part's model says can be repaired at all.
        /// <c>CanAttemptRepair()</c> is a per-failure-CLASS predicate, not a
        /// contingent one: an exploded part, a fired docking clamp and a snapped
        /// solar mechanism answer false whatever the crew do.
        ///
        /// <para>A failure whose predicate did not BIND is treated as repairable,
        /// which is the recoverable direction: attempting one TestFlight would
        /// have declined costs a round trip, where declining one it would have
        /// allowed hides a repair the operator could have made.</para>
        /// </summary>
        private List<object> RepairableFailures(object? core)
        {
            var repairable = new List<object>();
            if (core == null) return repairable;
            if (Invoke(_getActiveFailures, core) is not IEnumerable failures) return repairable;
            foreach (var failure in failures)
            {
                if (failure == null) continue;
                if (Invoke(_canAttemptRepair, failure) is bool can && !can) continue;
                repairable.Add(failure);
            }
            return repairable;
        }

        /// <summary>
        /// P(survive <paramref name="horizonSeconds"/> seconds of operation) at
        /// <paramref name="failureRate"/>, asked of TestFlight's own
        /// <c>FailureRateToReliability</c> rather than reimplemented, so the two
        /// cannot disagree about the exponential. Null when the member did not bind.
        /// </summary>
        public double? Survival(double failureRate, double horizonSeconds) =>
            Num(Invoke(_failureRateToReliability, null, failureRate, (float)horizonSeconds));

        private IEnumerable<object> ReliabilityModules(Part part, string? alias)
        {
            var result = Invoke(_getReliabilityModules, null, part, alias ?? "", true);
            if (result is not IEnumerable list) yield break;
            foreach (var module in list)
            {
                if (module != null) yield return module;
            }
        }

        /// <summary>
        /// The active failures' OWN titles, which is a far better statement of
        /// what is wrong than any threshold on a probability.
        /// </summary>
        private string? FailureTitles(object core)
        {
            if (Invoke(_getActiveFailures, core) is not IEnumerable failures) return null;
            var titles = new List<string>();
            foreach (var failure in failures)
            {
                if (failure == null) continue;
                var details = Invoke(_getFailureDetails, failure);
                if (details == null) continue;
                var title = details.GetType().GetField("failureTitle", Instance)?.GetValue(details) as string;
                if (!string.IsNullOrEmpty(title)) titles.Add(title!);
            }
            return titles.Count == 0 ? null : string.Join(", ", titles.ToArray());
        }

        // ── binding + invocation helpers ────────────────────────────────────

        private MethodInfo? Method(string name, Type? owner, string method, Type[] args, bool isStatic = false)
        {
            MethodInfo? found = null;
            try
            {
                found = owner?.GetMethod(method, isStatic ? Static : Instance, null, args, null);
            }
            catch { }
            Record(name, found != null);
            return found;
        }

        private PropertyInfo? Property(string name, Type? owner, string property)
        {
            PropertyInfo? found = null;
            try { found = owner?.GetProperty(property, Instance); } catch { }
            Record(name, found != null);
            return found;
        }

        private T? Missing<T>(string name) where T : class
        {
            Record(name, false);
            return null;
        }

        private void Record(string name, bool bound) => (bound ? _bound : _unbound).Add(name);

        private static object? EnumValue(Type enumType, string name)
        {
            try { return Enum.IsDefined(enumType, name) ? Enum.Parse(enumType, name) : null; }
            catch { return null; }
        }

        private static object? Invoke(MethodBase? member, object? target, params object?[] args)
        {
            if (member == null) return null;
            foreach (var arg in args)
            {
                // A null argument here means an enum value or a dependency that did
                // not bind, so the call cannot be made honestly at all.
                if (arg == null) return null;
            }
            try { return member.Invoke(target, args); } catch { return null; }
        }

        private static string? Str(PropertyInfo? p, object target)
        {
            if (p == null) return null;
            try { return p.GetValue(target) as string; } catch { return null; }
        }

        private static bool? Bool(PropertyInfo? p, object target)
        {
            if (p == null) return null;
            try { return p.GetValue(target) as bool?; } catch { return null; }
        }

        private static double? Num(object? o)
        {
            if (o == null) return null;
            try { return Convert.ToDouble(o); } catch { return null; }
        }

        private static int? Int(object? o)
        {
            if (o == null) return null;
            try { return Convert.ToInt32(o); } catch { return null; }
        }

        private static double? MaxOf(double? a, double? b)
        {
            if (a == null) return b;
            if (b == null) return a;
            return Math.Max(a.Value, b.Value);
        }

        private Type? FindType(string fullName)
        {
            if (_asm != null)
            {
                try { var t = _asm.GetType(fullName); if (t != null) return t; }
                catch { }
            }
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                try { var t = a.GetType(fullName); if (t != null) return t; }
                catch { }
            }
            return null;
        }
    }
}
