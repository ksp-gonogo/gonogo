// mod/GonogoTestFlightUplink/TestFlightReflection.cs
// Reflection-only bridge to TestFlight. No compile-time reference to TestFlight*.dll.
// ALL member names are [verify] against TestFlightCore.dll / TestFlightAPI.dll
// (GameData/TestFlight/Plugins/) - resolve on the RO fixture-capture pass (Task 5).
using System;
using System.Collections.Generic;
using System.Reflection;

namespace GonogoTestFlightUplink
{
    public sealed class TestFlightReflection
    {
        private readonly Assembly? _asm;
        private readonly Type? _coreInterface; // [verify] "TestFlightAPI.ITestFlightCore"

        public bool IsAvailable => _asm != null && _coreInterface != null;

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
            _coreInterface = FindType("TestFlightAPI.ITestFlightCore"); // [verify]
        }

        // Walk part modules; for each part implementing ITestFlightCore read its reliability state.
        public IEnumerable<EngineReliabilityRaw> Engines(Vessel v)
        {
            if (!IsAvailable || v?.parts == null) yield break;
            foreach (var part in v.parts)
            {
                if (part?.Modules == null) continue;
                foreach (var pm in part.Modules)
                {
                    if (pm == null) continue;
                    var t = pm.GetType();
                    if (_coreInterface == null || !_coreInterface.IsAssignableFrom(t)) continue;
                    // [verify] method names on ITestFlightCore:
                    //   double GetCurrentReliability(double flightData)  OR  GetCurrentReliability()
                    //   double GetFlightData()  /  double GetRatedTime()  /  MomentaryFailureRate
                    var reliability = InvokeDouble(pm, t, "GetCurrentReliability");
                    var flightData = InvokeDouble(pm, t, "GetFlightData");
                    var momentary = InvokeDouble(pm, t, "GetCurrentFailureRate"); // [verify]
                    yield return new EngineReliabilityRaw
                    {
                        PartId = part.flightID.ToString(),
                        Title = part.partInfo?.title ?? part.name,
                        CurrentReliability = reliability ?? 1.0,
                        FlightData = flightData ?? 0,
                        MomentaryFailureRate = momentary ?? 0,
                    };
                }
            }
        }

        public bool AnyMalfunction(Vessel v)
        {
            foreach (var e in Engines(v))
                if (e.CurrentReliability < 1.0 && e.MomentaryFailureRate > 0) return true;
            return false;
        }

        public bool AnyCritical(Vessel v)
        {
            foreach (var e in Engines(v))
                if (e.CurrentReliability <= 0.01) return true; // [verify] critical threshold
            return false;
        }

        private static double? InvokeDouble(object target, Type t, string method)
        {
            var m = t.GetMethod(method, BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
            if (m == null) return null;
            try { return Convert.ToDouble(m.Invoke(target, null)); }
            catch { return null; }
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
