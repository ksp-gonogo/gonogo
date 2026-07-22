// Reflection-only bridge to RP-1 avionics. No compile-time reference to the
// RP-0 plugin (RP0.dll, CC-BY-NC-SA-4.0) — every member is reached by runtime
// reflection, the same arm's-length pattern as RaReflection.
//
// Member names are RESOLVED (not guessed): they were locked against an ilspycmd
// dump of the installed RP-1 v4.5.0.0 RP0.dll (see
// local_docs/ro-fixtures/ro-fixture-avionics.json). Key facts baked in here:
//   - types are RP0.ModuleAvionics and RP0.ProceduralAvionics.ModuleProceduralAvionics
//     (the latter is a subclass of the former)
//   - the controllable-mass value is the PUBLIC float property CurrentMassLimit,
//     which already returns 0 when the unit is dead / powered-off / tech-locked /
//     interplanetary-locked. GetInternalMassLimit() is PROTECTED (unreadable via
//     public reflection) and raw massLimit ignores those locks — CurrentMassLimit
//     is exactly what RP0.ControlLockerUtils.ShouldLock sums, so we read it.
//   - ShouldLock sums CurrentMassLimit per PART, then takes the MAX across parts
//     (a second smaller unit elsewhere does not add to the best part's rating).
//     We mirror that: per-part sum, then max across parts.
//   - systemEnabled (public bool) marks whether a unit is switched on.
using System;
using System.Reflection;

namespace GonogoAvionicsUplink
{
    public sealed class AvionicsReflection
    {
        private readonly Assembly? _asm;
        private readonly Type? _moduleAvionics;            // RP0.ModuleAvionics
        private readonly Type? _moduleProceduralAvionics;  // RP0.ProceduralAvionics.ModuleProceduralAvionics

        public bool IsAvailable => _asm != null && (_moduleAvionics != null || _moduleProceduralAvionics != null);

        public AvionicsReflection()
        {
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                var n = a.GetName().Name;
                if (n != null && (n.StartsWith("RP0", StringComparison.OrdinalIgnoreCase) || n.Equals("RP-1", StringComparison.OrdinalIgnoreCase)))
                {
                    _asm = a;
                    break;
                }
            }
            _moduleAvionics = FindType("RP0.ModuleAvionics");
            _moduleProceduralAvionics = FindType("RP0.ProceduralAvionics.ModuleProceduralAvionics");
        }

        private bool IsAvionicsModule(Type t) =>
            (_moduleAvionics != null && _moduleAvionics.IsAssignableFrom(t)) ||
            (_moduleProceduralAvionics != null && _moduleProceduralAvionics.IsAssignableFrom(t));

        /// <summary>
        /// Reads the vessel's avionics controllability: the MAX across parts of
        /// each part's summed <c>CurrentMassLimit</c> (matching ShouldLock), plus
        /// whether any avionics unit is switched on. Null when no avionics unit is
        /// present on the vessel.
        /// </summary>
        public AvionicsRaw? Read(Vessel v)
        {
            if (!IsAvailable || v?.parts == null)
            {
                return null;
            }

            double? maxAcrossParts = null;
            bool active = false;

            foreach (var part in v.parts)
            {
                if (part?.Modules == null)
                {
                    continue;
                }

                double partSum = 0.0;
                bool partHasAvionics = false;

                foreach (var pm in part.Modules)
                {
                    if (pm == null)
                    {
                        continue;
                    }
                    var t = pm.GetType();
                    if (!IsAvionicsModule(t))
                    {
                        continue;
                    }

                    partHasAvionics = true;
                    var limit = ReadDouble(pm, t, "CurrentMassLimit");
                    if (limit is double l)
                    {
                        partSum += l;
                    }
                    var systemEnabled = ReadBool(pm, t, "systemEnabled");
                    if (systemEnabled ?? true)
                    {
                        active = true;
                    }
                }

                if (partHasAvionics)
                {
                    maxAcrossParts = maxAcrossParts == null ? partSum : Math.Max(maxAcrossParts.Value, partSum);
                }
            }

            if (maxAcrossParts == null)
            {
                return null;
            }
            return new AvionicsRaw { ControllableMassTons = maxAcrossParts.Value, AvionicsActive = active };
        }

        private static double? ReadDouble(object o, Type t, string member)
        {
            // Prefer a public property (CurrentMassLimit); fall back to a public
            // field (massLimit) for older RP-1 surfaces. Inherited public members
            // are found from the runtime (possibly derived) type by default.
            try
            {
                var pi = t.GetProperty(member, BindingFlags.Public | BindingFlags.Instance);
                if (pi != null)
                {
                    return ToDouble(pi.GetValue(o));
                }
                var fi = t.GetField(member, BindingFlags.Public | BindingFlags.Instance);
                if (fi != null)
                {
                    return ToDouble(fi.GetValue(o));
                }
            }
            catch (Exception)
            {
                // fail-soft: a moved member degrades to null, never throws
            }
            return null;
        }

        private static double? ToDouble(object? value) => value switch
        {
            double d => d,
            float f => f,
            _ => (double?)null,
        };

        private static bool? ReadBool(object o, Type t, string field)
        {
            try
            {
                var fi = t.GetField(field, BindingFlags.Public | BindingFlags.Instance);
                if (fi == null)
                {
                    return null;
                }
                return fi.GetValue(o) is bool b ? b : (bool?)null;
            }
            catch (Exception)
            {
                return null;
            }
        }

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
