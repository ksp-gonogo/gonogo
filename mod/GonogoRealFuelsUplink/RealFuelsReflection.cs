// Reflection-only bridge to RealFuels. No compile-time reference to
// RealFuels.dll (CC-BY-SA, see NOTICE-RealFuels.txt): every member is reached by
// runtime reflection, the same arm's-length pattern every third-party-mod uplink
// in this repo uses.
//
// Member names are RESOLVED, not guessed: they were locked against an ilspycmd
// dump of the installed RealFuels v15.15.0. What that dump settles, and what the
// code below therefore relies on:
//   - RealFuels.ModuleEnginesRF carries the live ignition budget as the public
//     persistent int field `ignitions`, and `ullage`/`pressureFed`/
//     `ratedBurnTime`/`ratedContinuousBurnTime`/`predictedMaximumResiduals` as
//     public fields beside it.
//   - RealFuels.Ullage.UllageSet is reached through ModuleEnginesRF's public
//     `ullageSet` field, and answers GetUllageStability() / GetUllageProbability()
//     / PressureOK() as public parameterless methods.
//   - RealFuels.ModuleEngineConfigsBase (a SEPARATE PartModule on the same part)
//     carries `literalZeroIgnitions`, and names the engine module it configures
//     through its public `pModule` field.
//   - RealFuels.RFSettings exposes the game-wide `limitedIgnitions` and
//     `simulateUllage` switches on a public static Instance.
//   - RealFuels.Tanks.ModuleFuelTanks exposes the public `BoiloffMassRate`
//     property (a MASS, not a rate, see RealFuelsCapture) and `SupportsBoiloff`.
using System;
using System.Reflection;

namespace GonogoRealFuelsUplink
{
    public sealed class RealFuelsReflection
    {
        private const BindingFlags Instance = BindingFlags.Public | BindingFlags.Instance;

        private readonly Assembly? _asm;
        private readonly Type? _moduleEnginesRf;
        private readonly Type? _moduleEngineConfigsBase;
        private readonly Type? _moduleFuelTanks;
        private readonly Type? _rfSettings;

        public bool IsAvailable => _asm != null && _moduleEnginesRf != null;

        public RealFuelsReflection()
        {
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                var n = a.GetName().Name;
                if (n != null && n.Equals("RealFuels", StringComparison.OrdinalIgnoreCase))
                {
                    _asm = a;
                    break;
                }
            }
            _moduleEnginesRf = FindType("RealFuels.ModuleEnginesRF");
            _moduleEngineConfigsBase = FindType("RealFuels.ModuleEngineConfigsBase");
            _moduleFuelTanks = FindType("RealFuels.Tanks.ModuleFuelTanks");
            _rfSettings = FindType("RealFuels.RFSettings");
        }

        /// <summary>
        /// Reads every RealFuels engine on the vessel, plus the two game-wide
        /// switches that decide whether their readings bind. Null when RealFuels
        /// is absent or the vessel has no parts.
        /// </summary>
        public RealFuelsVesselRaw? ReadEngines(Vessel v)
        {
            if (!IsAvailable || v?.parts == null)
            {
                return null;
            }

            var vessel = new RealFuelsVesselRaw
            {
                IgnitionsLimited = ReadSettingsBool("limitedIgnitions"),
                UllageSimulated = ReadSettingsBool("simulateUllage"),
            };

            foreach (var part in v.parts)
            {
                if (part?.Modules == null)
                {
                    continue;
                }
                foreach (var pm in part.Modules)
                {
                    if (pm == null || _moduleEnginesRf == null || !_moduleEnginesRf.IsInstanceOfType(pm))
                    {
                        continue;
                    }
                    vessel.Engines.Add(ReadEngine(part, pm));
                }
            }
            return vessel;
        }

        private RealFuelsEngineRaw ReadEngine(Part part, PartModule engine)
        {
            var t = engine.GetType();
            var raw = new RealFuelsEngineRaw
            {
                PartId = part.flightID,
                PartName = part.partInfo?.title,
                Ignitions = ReadInt(engine, t, "ignitions"),
                LiteralZeroIgnitions = ReadLiteralZeroIgnitions(part, engine),
                UllageModelled = ReadBool(engine, t, "ullage"),
                PressureFed = ReadBool(engine, t, "pressureFed"),
                RatedBurnTimeSeconds = PositiveOrNull(ReadDouble(engine, t, "ratedBurnTime")),
                RatedContinuousBurnTimeSeconds = PositiveOrNull(ReadDouble(engine, t, "ratedContinuousBurnTime")),
                PredictedMaximumResiduals = ReadDouble(engine, t, "predictedMaximumResiduals"),
            };

            var ullageSet = ReadMember(engine, t, "ullageSet");
            if (ullageSet != null)
            {
                var ut = ullageSet.GetType();
                raw.FeedPressureOk = InvokeBool(ullageSet, ut, "PressureOK");
                // Stability is only meaningful for an engine RealFuels actually
                // models ullage for; on any other the simulator sits at its
                // initial value, which would read as settled propellant.
                if (raw.UllageModelled == true)
                {
                    raw.UllageStability = InvokeDouble(ullageSet, ut, "GetUllageStability");
                    raw.IgnitionProbability = InvokeDouble(ullageSet, ut, "GetUllageProbability");
                }
            }
            return raw;
        }

        /// <summary>
        /// The <c>literalZeroIgnitions</c> flag off the engine-config module that
        /// configures THIS engine. A part can carry more than one config module
        /// (a bimodal engine does), so the one naming this engine through
        /// <c>pModule</c> is preferred and the part's first is the fallback.
        /// </summary>
        private bool? ReadLiteralZeroIgnitions(Part part, PartModule engine)
        {
            if (_moduleEngineConfigsBase == null || part.Modules == null)
            {
                return null;
            }
            bool? fallback = null;
            foreach (var pm in part.Modules)
            {
                if (pm == null || !_moduleEngineConfigsBase.IsInstanceOfType(pm))
                {
                    continue;
                }
                var t = pm.GetType();
                var value = ReadBool(pm, t, "literalZeroIgnitions");
                if (ReferenceEquals(ReadMember(pm, t, "pModule"), engine))
                {
                    return value;
                }
                if (fallback == null)
                {
                    fallback = value;
                }
            }
            return fallback;
        }

        /// <summary>
        /// Reads the vessel's cryogenic boiloff: the mass RealFuels accumulated
        /// across its tanks over the last physics interval, and that interval.
        /// Both travel because the property RealFuels calls a rate is not one
        /// (see <see cref="RealFuelsCapture.BoiloffRateKgPerSecond"/>).
        /// </summary>
        public RealFuelsBoiloffRaw? ReadBoiloff(Vessel v)
        {
            if (!IsAvailable || _moduleFuelTanks == null || v?.parts == null)
            {
                return null;
            }

            double massTons = 0.0;
            var tankCount = 0;
            var readAny = false;

            foreach (var part in v.parts)
            {
                if (part?.Modules == null)
                {
                    continue;
                }
                foreach (var pm in part.Modules)
                {
                    if (pm == null || !_moduleFuelTanks.IsInstanceOfType(pm))
                    {
                        continue;
                    }
                    var t = pm.GetType();
                    if (ReadBool(pm, t, "SupportsBoiloff") != true)
                    {
                        continue;
                    }
                    tankCount++;
                    var mass = ReadDouble(pm, t, "BoiloffMassRate");
                    if (mass != null)
                    {
                        massTons += mass.Value;
                        readAny = true;
                    }
                }
            }

            return new RealFuelsBoiloffRaw
            {
                BoiloffMassTons = readAny ? massTons : (double?)null,
                IntervalSeconds = ReadIntegratorInterval(v),
                CryogenicTankCount = tankCount,
            };
        }

        /// <summary>
        /// The physics interval RealFuels' own boiloff pass was handed. It reads
        /// it off the vessel's FlightIntegrator, so this reads the same field off
        /// the same object rather than approximating it with a frame time.
        /// </summary>
        private static double? ReadIntegratorInterval(Vessel v)
        {
            if (v.vesselModules == null)
            {
                return null;
            }
            foreach (var vm in v.vesselModules)
            {
                if (vm is FlightIntegrator fi)
                {
                    return fi.timeSinceLastUpdate;
                }
            }
            return null;
        }

        private bool? ReadSettingsBool(string field)
        {
            if (_rfSettings == null)
            {
                return null;
            }
            try
            {
                var instance = _rfSettings
                    .GetProperty("Instance", BindingFlags.Public | BindingFlags.Static)
                    ?.GetValue(null);
                if (instance == null)
                {
                    return null;
                }
                return ReadBool(instance, instance.GetType(), field);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// RealFuels states "this engine carries no rating" as -1 rather than as
        /// an absence, and a negative duration is not something a consumer should
        /// ever have to filter.
        /// </summary>
        private static double? PositiveOrNull(double? seconds) =>
            seconds != null && seconds.Value > 0.0 ? seconds : null;

        private static object? ReadMember(object o, Type t, string member)
        {
            try
            {
                var pi = t.GetProperty(member, Instance);
                if (pi != null)
                {
                    return pi.GetValue(o);
                }
                var fi = t.GetField(member, Instance);
                return fi?.GetValue(o);
            }
            catch (Exception)
            {
                // fail-soft: a moved member degrades to null, never throws
                return null;
            }
        }

        private static double? ReadDouble(object o, Type t, string member) => ReadMember(o, t, member) switch
        {
            double d => d,
            float f => f,
            _ => (double?)null,
        };

        private static int? ReadInt(object o, Type t, string member) =>
            ReadMember(o, t, member) is int i ? i : (int?)null;

        private static bool? ReadBool(object o, Type t, string member) =>
            ReadMember(o, t, member) is bool b ? b : (bool?)null;

        private static object? Invoke(object o, Type t, string method)
        {
            try
            {
                return t.GetMethod(method, Instance, null, Type.EmptyTypes, null)?.Invoke(o, null);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static double? InvokeDouble(object o, Type t, string method) => Invoke(o, t, method) switch
        {
            double d => d,
            float f => f,
            _ => (double?)null,
        };

        private static bool? InvokeBool(object o, Type t, string method) =>
            Invoke(o, t, method) is bool b ? b : (bool?)null;

        private Type? FindType(string fullName)
        {
            if (_asm != null)
            {
                try
                {
                    var t = _asm.GetType(fullName);
                    if (t != null)
                    {
                        return t;
                    }
                }
                catch (Exception)
                {
                    // fall through to the broad scan
                }
            }
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    var t = a.GetType(fullName);
                    if (t != null)
                    {
                        return t;
                    }
                }
                catch (Exception)
                {
                    // ignore and keep scanning
                }
            }
            return null;
        }
    }
}
