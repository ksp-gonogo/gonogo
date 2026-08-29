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
