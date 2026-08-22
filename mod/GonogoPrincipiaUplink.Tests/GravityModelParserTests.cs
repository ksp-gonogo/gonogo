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

        /// <summary>
        /// Kerbin as the game's own body table gives it: a name and a gravitational
        /// parameter in metres cubed, with no reference radius and no zonal harmonic,
        /// because the producer's per-body route has neither.
        /// </summary>
        private static GravityModelBlock StockKerbin() => Block(
            "name", "Kerbin",
            "gravitational_parameter", "3531600000000 m^3/s^2");

        /// <summary>
        /// The exact strings the body-tree reader writes are strings the parse
        /// accepts.
        ///
        /// <para>The reader needs the game to compile and so is not in this project,
        /// which is why the key names and the unit spelling are constants on the
        /// parser and the reader uses them. Without this the two halves could differ
        /// by one character, every body would be dropped for a missing key or an
        /// unrecognised unit, and the arc would refuse with no force model on an
        /// install that had one.</para>
        /// </summary>
        [Fact]
        public void TheSpellingsTheReaderWritesAreTheSpellingsTheParseAccepts()
        {
            var asTheReaderWrites = Block(
                GravityModelParser.NameKey, "Kerbin",
                GravityModelParser.GravitationalParameterKey,
                "3531600000000 " + GravityModelParser.MetresCubedPerSecondSquared);

            var model = GravityModelParser.Parse(() => null, () => new[] { asTheReaderWrites });

            Assert.NotNull(model);
            Assert.Equal(3.5316e12, model!.Find("Kerbin")!.GravitationalParameter, 6);
        }

        [Fact]
        public void TheConfiguredModelWinsAndTheBodyTreeIsNotEvenRead()
        {
            var walked = 0;

            var model = GravityModelParser.Parse(
                () => new[] { Earth() },
                () =>
                {
                    walked++;
                    return new[] { StockKerbin() };
                });

            Assert.Equal(GravityModelParser.ModelId, model!.ModelId);
            Assert.NotNull(model.Find("Earth"));
            // Reading the game's body tree costs a walk of every celestial, and it
            // buys nothing when the producer's own config answered.
            Assert.Equal(0, walked);
        }

        /// <summary>
        /// With no config node, the game's own bodies become the model, because that
        /// is what the producer itself integrates in that case.
        ///
        /// <para>This is the ordinary install rather than a corner: the producer
        /// ships its gravity-model config guarded on the planet pack it belongs to,
        /// so running it against the stock system leaves no such node anywhere. The
        /// path used to end there, and the arc refused for the lifetime of the
        /// slice.</para>
        /// </summary>
        [Fact]
        public void WithNoConfiguredModelTheGamesOwnBodiesBecomeIt()
        {
            var model = GravityModelParser.Parse(() => null, () => new[] { StockKerbin() });

            Assert.NotNull(model);
            Assert.Equal(GravityModelParser.BodyTreeModelId, model!.ModelId);
            Assert.Equal(3.5316e12, model.Find("Kerbin")!.GravitationalParameter, 6);
        }

        [Fact]
        public void TheTwoProvenancesAreNeverGivenTheSameId()
        {
            // A reader that cannot tell a configured model from one assembled out of
            // the game's bodies cannot tell which physics parameters a curve was
            // integrated against.
            Assert.NotEqual(GravityModelParser.ModelId, GravityModelParser.BodyTreeModelId);
        }

        [Fact]
        public void ABodyTreeModelCarriesNoOblatenessTerm()
        {
            // The producer's per-body route has nowhere to read a reference radius or
            // a zonal harmonic from and applies neither, so stating one here would
            // describe a force the physics is not summing.
            var kerbin = GravityModelParser
                .Parse(() => null, () => new[] { StockKerbin() })!
                .Find("Kerbin");

            Assert.Null(kerbin!.ReferenceRadius);
            Assert.Null(kerbin.J2);
        }

        [Fact]
        public void AnEmptyConfigNodeFallsThroughRatherThanWinningWithNothingInIt()
        {
            // A node present but unusable is the same situation as no node: a model
            // with no bodies integrates happily and produces a two-body curve under
            // an n-body label.
            var model = GravityModelParser.Parse(
                () => new GravityModelBlock[0], () => new[] { StockKerbin() });

            Assert.Equal(GravityModelParser.BodyTreeModelId, model!.ModelId);
        }

        [Fact]
        public void NeitherSourceAnsweringIsStillNull()
        {
            Assert.Null(GravityModelParser.Parse(() => null, () => null));
        }

        [Fact]
        public void AGmWithNoStatedUnitIsDroppedOnTheBodyTreePathToo()
        {
            // The game states a bare double and the reader has to attach the unit.
            // One that forgot would publish a GM a billion times too small, every
            // perturbation would vanish, and the curve would look like a clean conic.
            var model = GravityModelParser.Parse(
                () => null,
                () => new[] { Block("name", "Kerbin", "gravitational_parameter", "3531600000000") });

            Assert.Null(model);
        }
    }
}
