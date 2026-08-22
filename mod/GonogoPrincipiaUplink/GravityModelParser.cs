using System;
using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// One <c>body</c> block of the producer's gravity-model config, reduced to
    /// the keys that matter, so the parse below can be exercised with no game
    /// running.
    ///
    /// <para>A dictionary rather than the game's own node type deliberately. The
    /// node is a <c>GameDatabase</c> read and belongs on the far side of the
    /// game boundary; the DECISIONS about what a value means, which of them are
    /// required, and what an unparseable one does are all here, where a test can
    /// drive them against a real shipped file's spellings.</para>
    /// </summary>
    public sealed class GravityModelBlock
    {
        public GravityModelBlock(IReadOnlyDictionary<string, string> values)
        {
            Values = values ?? throw new ArgumentNullException(nameof(values));
        }

        public IReadOnlyDictionary<string, string> Values { get; }
    }

    /// <summary>
    /// Turns the producer's own gravity-model config into the KSP-free
    /// <see cref="GravityModel"/> the propagation speaks.
    ///
    /// <para><b>Why this reads a config file rather than calling the plugin.</b>
    /// The model is a <c>GameDatabase</c> node, which is an ordinary game read
    /// outside the plugin surface entirely, so it costs nothing and risks nothing:
    /// the native ABI aborts the process on a bad call and a config read makes no
    /// call. Every parameter the integration needs is in it.</para>
    ///
    /// <para><b>A body with no gravitational parameter is dropped rather than
    /// defaulted.</b> A body with an invented GM perturbs the curve by an invented
    /// amount, which is worse than a curve that says a term is missing: the first
    /// is wrong and confident, the second is degraded and says so.</para>
    /// </summary>
    public static class GravityModelParser
    {
        /// <summary>The node name the producer stores its model under.</summary>
        public const string NodeName = "principia_gravity_model";

        /// <summary>The id published on a curve derived from this model.</summary>
        public const string ModelId = "principia-gravity-model";

        private const string NameKey = "name";
        private const string GravitationalParameterKey = "gravitational_parameter";
        private const string ReferenceRadiusKey = "reference_radius";
        private const string J2Key = "j2";

        /// <summary>
        /// The model, or null when there is nothing usable to build one from.
        ///
        /// <para>Null is the state a client is told about as
        /// <see cref="TrajectoryRefusal.NoForceModel"/>: an install problem with no
        /// operator remedy. It is deliberately not a partial model with stock
        /// values filled in, which would produce a curve that agrees with nothing
        /// while looking exactly like one that does.</para>
        /// </summary>
        public static GravityModel? Parse(IEnumerable<GravityModelBlock>? blocks)
        {
            if (blocks == null) return null;
            var bodies = new List<GravityModelBody>();
            foreach (var block in blocks)
            {
                var body = ParseBody(block);
                if (body != null) bodies.Add(body);
            }
            return bodies.Count == 0 ? null : new GravityModel(ModelId, bodies);
        }

        private static GravityModelBody? ParseBody(GravityModelBlock? block)
        {
            if (block == null) return null;
            var name = Text(block, NameKey);
            if (string.IsNullOrEmpty(name)) return null;
            var mu = Quantity(block, GravitationalParameterKey, GravitationalParameterUnits);
            if (mu == null || !(mu.Value > 0.0)) return null;
            return new GravityModelBody(
                name!,
                mu.Value,
                Quantity(block, ReferenceRadiusKey, LengthUnits),
                Quantity(block, J2Key, Dimensionless));
        }

        /// <summary>
        /// What a gravitational parameter's stated unit is worth in metres cubed
        /// per second squared.
        ///
        /// <para>The shipped model writes <c>km^3/s^2</c>, and a reader that drops
        /// the unit gets a GM a billion times too small: every perturbation
        /// vanishes, the curve looks like a clean two-body conic, and nothing on
        /// it is wrong in a way anyone can see. So the unit is REQUIRED and an
        /// unrecognised one drops the body, rather than being assumed away.</para>
        /// </summary>
        private static readonly Dictionary<string, double> GravitationalParameterUnits =
            new Dictionary<string, double>(StringComparer.Ordinal)
            {
                { "km^3/s^2", 1e9 },
                { "m^3/s^2", 1.0 },
            };

        /// <summary>Lengths, on the same terms. The shipped model writes <c>km</c>.</summary>
        private static readonly Dictionary<string, double> LengthUnits =
            new Dictionary<string, double>(StringComparer.Ordinal)
            {
                { "km", 1_000.0 },
                { "m", 1.0 },
            };

        /// <summary>
        /// A quantity that is a pure number. The shipped model writes a bare
        /// <c>j2</c> for two bodies, with no unit at all, which is correct: a zonal
        /// harmonic is dimensionless.
        /// </summary>
        private static readonly Dictionary<string, double> Dimensionless =
            new Dictionary<string, double>(StringComparer.Ordinal);

        private static string? Text(GravityModelBlock block, string key) =>
            block.Values.TryGetValue(key, out var raw) ? raw?.Trim() : null;

        /// <summary>
        /// A number that arrives with its unit attached, as the shipped file writes
        /// them: <c>3.9860043543609598e+05 km^3/s^2</c>, <c>6378.1363 km</c>.
        ///
        /// <para>Converted rather than assumed. A reader that took the numeric half
        /// and dropped the unit would read Earth's GM as 3.99e5 instead of 3.99e14,
        /// and nothing downstream could tell: every perturbation would vanish, the
        /// curve would look like a clean two-body conic, and it would be wrong in
        /// the one way a diagram cannot show.</para>
        ///
        /// <para>Null on anything not fully understood: a missing key, a numeric
        /// half that will not parse, a unit not in <paramref name="units"/>, or a
        /// unit where none was expected. Null degrades the body rather than
        /// substituting a zero, because a body of zero mass silently stops
        /// perturbing anything, which reads as a working curve.</para>
        /// </summary>
        private static double? Quantity(
            GravityModelBlock block, string key, IDictionary<string, double> units)
        {
            var raw = Text(block, key);
            if (string.IsNullOrEmpty(raw)) return null;

            var text = raw!;
            var space = text.IndexOf(' ');
            var head = space > 0 ? text.Substring(0, space) : text;
            var unit = space > 0 ? text.Substring(space + 1).Trim() : string.Empty;

            if (!double.TryParse(
                    head, NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
            {
                return null;
            }
            if (double.IsNaN(value) || double.IsInfinity(value)) return null;

            if (unit.Length == 0)
            {
                // A bare number is right only where the quantity has no dimension.
                // Elsewhere it is a value whose scale nobody stated, which is the
                // case this whole function exists to refuse.
                return units.Count == 0 ? value : (double?)null;
            }
            return units.TryGetValue(unit, out var scale) ? value * scale : (double?)null;
        }
    }
}
