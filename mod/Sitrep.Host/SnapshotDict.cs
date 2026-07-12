using System.Collections.Generic;
using System.Linq;

namespace Sitrep.Host
{
    /// <summary>
    /// Shared, KSP-free readers for pulling typed scalars out of a raw
    /// <c>Dictionary&lt;string, object?&gt;</c> snapshot group -- the exact
    /// shape both a live <c>KspHost</c> capture and a <see cref="ReplayKspHost"/>
    /// (post JSON round-trip via <c>RecordedSessionCodec</c>) hand to every
    /// <c>*ViewProvider</c> mapper. Extracted from the near-verbatim copies
    /// that used to live separately in <see cref="VesselViewProvider"/> and
    /// <see cref="SystemViewProvider"/> so every provider -- present and
    /// future (M1 Task 2's ~10 providers) -- shares one implementation.
    ///
    /// <para><b>R1/F-1 -- non-finite numbers are ABSENT, not present:</b>
    /// <see cref="GetDouble"/> and <see cref="GetVec3"/> both treat a
    /// <c>NaN</c>/<c>Infinity</c> raw value as though the key were missing
    /// entirely, returning <c>null</c> rather than the non-finite value.
    /// This is not a hypothetical: KSP's own <c>Orbit.LAN</c> is <c>NaN</c>
    /// for a near-equatorial orbit (inc ~ 0) and <c>argumentOfPeriapsis</c>
    /// is <c>NaN</c> for a near-circular orbit (ecc ~ 0) -- both ROUTINE
    /// flight states, not edge cases -- and <c>telemachus-api-issues.md</c>
    /// F-1 catalogues the old Telemachus fork stringifying exactly these
    /// values onto the wire as <c>"NaN"</c>. <c>m1-provider-taxonomy-design.md</c>
    /// R1 is explicit: "numbers are always finite -- a non-finite in the
    /// mapper is a bug, not a wire value." A caller that requires a field
    /// (see each provider's own "all required" guards) sees a non-finite
    /// input the same way it sees a missing one: the field maps to
    /// <c>null</c>, and it is the CALLER's job to decide whether that
    /// specific field is optional (e.g. <c>VesselOrbit.Lan</c>/<c>ArgPe</c>)
    /// or fatal to the whole record (e.g. <c>VesselOrbit.Sma</c>).</para>
    /// </summary>
    internal static class SnapshotDict
    {
        public static string? GetString(IDictionary<string, object?> raw, string key)
        {
            return raw.TryGetValue(key, out var v) && v is string s ? s : null;
        }

        public static bool? GetBool(IDictionary<string, object?> raw, string key)
        {
            return raw.TryGetValue(key, out var v) && v is bool b ? b : (bool?)null;
        }

        /// <summary>
        /// Reads an integral field. Accepts any boxed CLR numeric type,
        /// because a live <c>KspHost</c> may store a raw <c>int</c> while a
        /// <see cref="ReplayKspHost"/> snapshot always carries <c>double</c>.
        /// Returns <c>null</c> -- never a sentinel like <c>-1</c> -- when the
        /// key is absent or explicitly <c>null</c>.
        ///
        /// <para><b>Fix E (R1/F-1, mirrors <see cref="GetDouble"/>):</b> a
        /// <c>double</c>/<c>float</c> source that is <c>NaN</c>/<c>Infinity</c>
        /// is ALSO treated as absent, never cast through to a fabricated
        /// integer. Before this guard, an unchecked <c>(int)d</c> conversion
        /// silently produced <c>0</c> for <c>NaN</c> and <c>int.MaxValue</c>/
        /// <c>int.MinValue</c> for +/-<c>Infinity</c> -- reachable via a
        /// replay decode of a literal <c>"NaN"</c>/<c>"Infinity"</c> string
        /// landing in an integral field. <c>int</c>/<c>long</c> sources are
        /// always finite by construction and never hit this branch.</para>
        /// </summary>
        public static int? GetInt(IDictionary<string, object?> raw, string key)
        {
            if (!raw.TryGetValue(key, out var v) || v == null)
            {
                return null;
            }

            return v switch
            {
                int i => i,
                long l => (int)l,
                double d => IsFinite(d) ? (int)d : (int?)null,
                float f => IsFinite(f) ? (int)f : (int?)null,
                _ => (int?)null,
            };
        }

        /// <summary>
        /// Reads a floating-point field. Accepts any boxed CLR numeric type
        /// (a live <c>KspHost</c> may store a raw <c>int</c>/<c>float</c>; a
        /// <see cref="ReplayKspHost"/> snapshot post JSON round-trip always
        /// carries <c>double</c>). Returns <c>null</c> -- never the raw
        /// value -- when the key is absent, explicitly <c>null</c>, OR when
        /// the underlying number is <c>NaN</c>/<c>Infinity</c>/<c>-Infinity</c>
        /// (R1/F-1: see the class doc comment). Integral sources
        /// (<c>int</c>/<c>long</c>) are always finite by construction and
        /// never hit that branch.
        /// </summary>
        public static double? GetDouble(IDictionary<string, object?> raw, string key)
        {
            if (!raw.TryGetValue(key, out var v) || v == null)
            {
                return null;
            }

            double? value = v switch
            {
                double d => d,
                float f => f,
                int i => i,
                long l => l,
                _ => (double?)null,
            };

            return value.HasValue && IsFinite(value.Value) ? value : null;
        }

        /// <summary>
        /// Reads a 3-element numeric array/list field into a <see cref="Sitrep.Contract.Vec3"/>.
        /// KspHost emits a real <c>double[]</c> directly; a
        /// <see cref="ReplayKspHost"/> snapshot carries a
        /// <c>List&lt;object?&gt;</c> instead -- both are accepted. Returns
        /// null (never a partial/non-finite-carrying vector) if the field is
        /// missing, isn't length-3, or any element isn't a finite number
        /// (R1/F-1).
        /// </summary>
        public static Sitrep.Contract.Vec3? GetVec3(IDictionary<string, object?> raw, string key)
        {
            if (!raw.TryGetValue(key, out var v) || v == null)
            {
                return null;
            }

            double[]? components = v switch
            {
                double[] d => d,
                IList<object?> list when list.Count == 3 => TryConvertTriple(list),
                _ => null,
            };

            if (components == null || components.Length != 3 || !components.All(IsFinite))
            {
                return null;
            }

            return new Sitrep.Contract.Vec3(components[0], components[1], components[2]);
        }

        private static double[]? TryConvertTriple(IList<object?> list)
        {
            var result = new double[3];
            for (var i = 0; i < 3; i++)
            {
                switch (list[i])
                {
                    case double d:
                        result[i] = d;
                        break;
                    case float f:
                        result[i] = f;
                        break;
                    case int n:
                        result[i] = n;
                        break;
                    case long n:
                        result[i] = n;
                        break;
                    default:
                        return null;
                }
            }
            return result;
        }

        /// <summary>
        /// netstandard2.0/net472 don't have <c>double.IsFinite</c> (added in
        /// netstandard2.1) -- this is the one-line equivalent.
        /// </summary>
        private static bool IsFinite(double d) => !double.IsNaN(d) && !double.IsInfinity(d);
    }
}
