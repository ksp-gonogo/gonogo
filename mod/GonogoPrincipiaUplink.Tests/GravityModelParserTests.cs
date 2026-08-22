using System.Collections.Generic;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The gravity-model parse, driven against the SHIPPED file's own spellings.
    ///
    /// <para>Every block below is copied verbatim from the RSS gravity model that
    /// ships with the producer, units included, because the unit is where this
    /// fails silently: the file writes <c>km^3/s^2</c>, a reader that takes the
    /// numeric half gets a GM a billion times too small, and the resulting curve is
    /// a clean two-body conic with no perturbation in it and nothing on it wrong in
    /// a way a diagram can show.</para>
    /// </summary>
    public class GravityModelParserTests
    {
        private static GravityModelBlock Block(params string[] pairs)
        {
            var values = new Dictionary<string, string>();
            for (var i = 0; i + 1 < pairs.Length; i += 2)
            {
                values[pairs[i]] = pairs[i + 1];
            }
            return new GravityModelBlock(values);
        }

        /// <summary>Earth, exactly as the shipped RSS file writes it.</summary>
        private static GravityModelBlock Earth() => Block(
            "name", "Earth",
            "gravitational_parameter", "3.9860043543609598e+05 km^3/s^2",
            "reference_instant", "JD2451545.000000000",
            "reference_radius", "6378.1363 km");

        [Fact]
        public void AKilometreCubedGmBecomesMetresCubed()
        {
            var model = GravityModelParser.Parse(new[] { Earth() });

            Assert.NotNull(model);
            var earth = model!.Find("Earth");
            Assert.NotNull(earth);
            // 3.986e14, the real value, not the 3.986e5 the file's digits alone say.
            Assert.Equal(3.9860043543609598e+14, earth!.GravitationalParameter, 6);
        }

        [Fact]
        public void AKilometreRadiusBecomesMetres()
        {
            var earth = GravityModelParser.Parse(new[] { Earth() })!.Find("Earth");
            Assert.Equal(6_378_136.3, earth!.ReferenceRadius!.Value, 6);
        }

        [Fact]
        public void ABareJ2IsReadAsThePureNumberItIs()
        {
            // Two bodies in the shipped file carry a bare j2 with no unit, which is
            // correct: a zonal harmonic is dimensionless.
            var model = GravityModelParser.Parse(new[]
            {
                Block(
                    "name", "Vesta",
                    "gravitational_parameter", "1.7288131e+01 km^3/s^2",
                    "j2", "7.10608919544419154e-02"),
            });

            Assert.Equal(7.10608919544419154e-02, model!.Find("Vesta")!.J2!.Value, 12);
        }

        [Fact]
        public void AGmInAnUnrecognisedUnitDropsTheBodyRatherThanGuessing()
        {
            // The whole reason the unit is required. A body admitted with a
            // mis-scaled GM perturbs the curve by an invented amount and nothing
            // downstream can tell; a body dropped shows up as a smaller
            // perturbingBodyCount and a named missing term.
            var model = GravityModelParser.Parse(new[]
            {
                Block("name", "Nonsense", "gravitational_parameter", "1.0e+05 furlongs^3/fortnight^2"),
                Earth(),
            });

            Assert.Single(model!.Bodies);
            Assert.Equal("Earth", model.Bodies[0].Name);
        }

        [Fact]
        public void AGmWithNoUnitAtAllIsAlsoRefused()
        {
            // A bare number is a value whose scale nobody stated. It is exactly what
            // a naive reader produces from the shipped file, so accepting it would
            // make the whole unit rule decorative.
            var model = GravityModelParser.Parse(new[]
            {
                Block("name", "Unstated", "gravitational_parameter", "3.986e+14"),
            });

            Assert.Null(model);
        }

        [Fact]
        public void ARadiusInAnUnrecognisedUnitLeavesTheBodyAPointMass()
        {
            // The radius is not summed into the acceleration, so an unreadable one
            // costs nothing and must not cost the body its mass.
            var model = GravityModelParser.Parse(new[]
            {
                Block(
                    "name", "Earth",
                    "gravitational_parameter", "3.9860043543609598e+05 km^3/s^2",
                    "reference_radius", "3963 miles"),
            });

            var earth = model!.Find("Earth");
            Assert.Equal(3.9860043543609598e+14, earth!.GravitationalParameter, 6);
            Assert.Null(earth.ReferenceRadius);
        }

        [Fact]
        public void ABodyWithNoGmIsDroppedRatherThanDefaulted()
        {
            // A body with an invented GM perturbs the curve by an invented amount,
            // which is worse than one that is missing and says so.
            var model = GravityModelParser.Parse(new[]
            {
                Block("name", "Nameless"),
                Earth(),
            });

            Assert.Single(model!.Bodies);
        }

        [Fact]
        public void ABodyWithNoNameIsDropped()
        {
            var model = GravityModelParser.Parse(new[]
            {
                Block("gravitational_parameter", "1.0e+02 km^3/s^2"),
                Earth(),
            });

            Assert.Single(model!.Bodies);
        }

        [Fact]
        public void ANonPositiveGmIsDropped()
        {
            var model = GravityModelParser.Parse(new[]
            {
                Block("name", "Ghost", "gravitational_parameter", "0.0 km^3/s^2"),
                Earth(),
            });

            Assert.Single(model!.Bodies);
        }

        [Fact]
        public void NoBlocksIsNoModelRatherThanAnEmptyOne()
        {
            // Null is the state a client is told about as an install problem with no
            // remedy. An empty model would be a force model with nothing in it,
            // which integrates happily and produces a two-body curve under an
            // n-body label.
            Assert.Null(GravityModelParser.Parse(null));
            Assert.Null(GravityModelParser.Parse(new GravityModelBlock[0]));
        }

        [Fact]
        public void TheModelSaysWhoItCameFrom()
        {
            var model = GravityModelParser.Parse(new[] { Earth() });
            Assert.Equal(GravityModelParser.ModelId, model!.ModelId);
        }

        [Fact]
        public void LookupIsExactRatherThanForgiving()
        {
            // Body names come from the game's own table on one side and from a
            // config file on the other. A case-insensitive or trimmed match here
            // would quietly paper over a real mismatch between the two, which is
            // the thing a degraded curve is meant to report.
            var model = GravityModelParser.Parse(new[] { Earth() });
            Assert.NotNull(model!.Find("Earth"));
            Assert.Null(model.Find("earth"));
            Assert.Null(model.Find(null));
            Assert.Null(model.Find(""));
        }
    }
}
