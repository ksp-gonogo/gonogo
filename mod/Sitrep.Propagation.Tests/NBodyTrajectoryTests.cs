using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// The n-body integration, checked against arithmetic rather than against
    /// itself.
    ///
    /// <para>The accuracy case is the load-bearing one and it is deliberately a
    /// CLOSED-FORM comparison: with no perturbers the integrator is solving a
    /// two-body problem, whose answer is known exactly, so a drifting or spiralling
    /// step scheme fails here rather than producing a plausible curve nobody can
    /// falsify. Every perturbed case then measures a DIFFERENCE from that same
    /// unperturbed run, so a perturbation silently dropped shows as zero rather than
    /// as a number in range.</para>
    /// </summary>
    public class NBodyTrajectoryTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double MunMu = 6.5138398e10;
        private const int Kerbin = 0, Mun = 1;

        /// <summary>Kerbin as the root, the Mun on its real circular orbit about it.</summary>
        private static IReadOnlyList<SystemBody> System() => new[]
        {
            new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
            new SystemBody(Kerbin, new OrbitElements(12_000_000.0, 0.0, 0, 0, 0, 0.0, 0.0, KerbinMu)),
        };

        private static IPropagationProvider Provider() => new KeplerProvider(System());

        private static GravityModel Model(params GravityModelBody[] bodies) =>
            new GravityModel("test", bodies);

        private static GravityModelBody MunEntry() =>
            new GravityModelBody("Mun", MunMu, referenceRadius: 200_000.0, j2: 1e-6);

        /// <summary>A 700 km circular orbit about Kerbin, starting on +x moving +y.</summary>
        private static StateVector CircularStart(double radius, double mu) =>
            new StateVector(
                new Vector3d(radius, 0, 0),
                new Vector3d(0, Math.Sqrt(mu / radius), 0));

        private static double PeriodOf(double radius, double mu) =>
            2.0 * Math.PI * Math.Sqrt(radius * radius * radius / mu);

        private static NBodyRequest Request(
            double radius,
            double spanSeconds,
            IReadOnlyList<PerturbingBody> perturbers,
            int maxPoints = 256,
            int maxSteps = 100_000,
            double? stepSeconds = null)
        {
            var period = PeriodOf(radius, KerbinMu);
            return new NBodyRequest(
                CircularStart(radius, KerbinMu),
                fromUt: 0.0,
                toUt: spanSeconds,
                primaryGravitationalParameter: KerbinMu,
                perturbers: perturbers,
                maxPoints: maxPoints,
                maxSteps: maxSteps,
                stepSeconds: stepSeconds ?? NBodyTrajectory.StepFor(period));
        }

        private static TrajectoryArc Drawn(TrajectoryArcAnswer answer)
        {
            Assert.Equal(TrajectoryRefusal.Unspecified, answer.Refusal);
            Assert.NotNull(answer.Arc);
            return answer.Arc!;
        }

        [Fact]
        public void AnUnperturbedCircularOrbitStaysOnItsCircle()
        {
            // No perturbers, so the answer is a two-body circle of known radius,
            // which is what tells a working integrator from one that merely
            // produces points. The bound has headroom over the measured truncation
            // of a second-order scheme at 300 steps per revolution, which is
            // 2.19e-4: about 150 m on a 700 km radius.
            const double radius = 700_000.0;
            var answer = NBodyTrajectory.Integrate(
                Request(radius, PeriodOf(radius, KerbinMu), Array.Empty<PerturbingBody>()),
                Model(MunEntry()),
                Kerbin,
                Provider());

            var worst = WorstRadiusError(Drawn(answer), radius);
            Assert.True(
                worst < 5e-4,
                "Worst relative radius error over one revolution was " + worst.ToString("E3")
                + ". Measured at 2.19e-4 (about 150 m on 700 km) for the shipped scheme and step.");
        }

        [Fact]
        public void HalvingTheStepQuartersTheError()
        {
            // What pins the ORDER of the scheme, which a single tolerance cannot: a
            // first-order integrator HALVES its error when the step halves and would
            // sit comfortably inside any bound loose enough to admit the real one.
            // This is the check that can tell the two apart.
            const double radius = 700_000.0;
            var period = PeriodOf(radius, KerbinMu);
            var model = Model(MunEntry());
            var provider = Provider();

            var coarse = NBodyTrajectory.StepFor(period);
            var atCoarse = WorstRadiusError(
                Drawn(NBodyTrajectory.Integrate(
                    Request(radius, period, Array.Empty<PerturbingBody>(),
                        maxPoints: 100_000, stepSeconds: coarse),
                    model, Kerbin, provider)),
                radius);
            var atFine = WorstRadiusError(
                Drawn(NBodyTrajectory.Integrate(
                    Request(radius, period, Array.Empty<PerturbingBody>(),
                        maxPoints: 100_000, stepSeconds: coarse / 2.0),
                    model, Kerbin, provider)),
                radius);

            var ratio = atCoarse / atFine;
            Assert.True(
                ratio > 3.0 && ratio < 5.0,
                "Halving the step should cut the error by about four for a second-order scheme. "
                + "It changed by " + ratio.ToString("F2") + "x, and two is what first order gives.");
        }

        private static double WorstRadiusError(TrajectoryArc arc, double radius)
        {
            var worst = 0.0;
            foreach (var p in arc.Points)
            {
                var r = new Vector3d(p.X, p.Y, p.Z).Magnitude();
                worst = Math.Max(worst, Math.Abs(r - radius) / radius);
            }
            return worst;
        }

        [Fact]
        public void AnUnperturbedOrbitComesBackToWhereItStarted()
        {
            // Closure over exactly one period, which catches an along-track phase
            // error that a radius check alone cannot see: a curve can stay on its
            // circle and still arrive at the wrong point on it.
            const double radius = 700_000.0;
            var period = PeriodOf(radius, KerbinMu);
            var arc = Drawn(NBodyTrajectory.Integrate(
                Request(radius, period, Array.Empty<PerturbingBody>()),
                Model(MunEntry()),
                Kerbin,
                Provider()));

            var first = arc.Points[0];
            var last = arc.Points[arc.Points.Count - 1];
            var drift = new Vector3d(last.X - first.X, last.Y - first.Y, last.Z - first.Z).Magnitude();
            Assert.InRange(drift / radius, 0.0, 2e-3);
        }

        [Fact]
        public void APerturberInTheModelActuallyMovesTheCurve()
        {
            // The failure this catches is a perturbation counted in
            // PerturbingBodyCount and never summed into the acceleration: the arc
            // would say "one body" and be identical to the unperturbed one, which
            // is a report of success from a computation that did not happen.
            const double radius = 2_000_000.0;
            var span = PeriodOf(radius, KerbinMu) * 4.0;
            var provider = Provider();
            var model = Model(MunEntry());

            var bare = Drawn(NBodyTrajectory.Integrate(
                Request(radius, span, Array.Empty<PerturbingBody>()),
                model, Kerbin, provider));
            var perturbed = Drawn(NBodyTrajectory.Integrate(
                Request(radius, span, new[] { new PerturbingBody("Mun", Mun) }),
                model, Kerbin, provider));

            Assert.Equal(0, bare.ForceModel!.PerturbingBodyCount);
            Assert.Equal(1, perturbed.ForceModel!.PerturbingBodyCount);

            var a = bare.Points[bare.Points.Count - 1];
            var b = perturbed.Points[perturbed.Points.Count - 1];
            var separation = new Vector3d(b.X - a.X, b.Y - a.Y, b.Z - a.Z).Magnitude();
            Assert.True(
                separation > 100.0,
                "The Mun's pull over four revolutions must move the endpoint by more than a "
                + "hundred metres. It moved " + separation.ToString("F3") + " m, which is what a "
                + "perturber counted and never summed looks like.");
        }

        [Fact]
        public void AVeryDistantPerturberBarelyMovesTheCurve()
        {
            // The differential term, checked from the direction it fails in. A
            // perturber's pull on the CRAFT minus its pull on the PRIMARY tends to
            // zero as the perturber recedes; keeping only the first half leaves a
            // term that does not, so a distant heavy body drags the whole orbit
            // sideways. Same body, same mass, a hundred times further out.
            //
            // Twenty revolutions rather than one, and the span is what makes the
            // check able to fail. Measured with the primary's own acceleration
            // deliberately dropped: over ONE revolution the endpoint moves 9 cm and
            // sits inside any tolerance the correct term also fits in, while over
            // twenty it moves 3.3 m against under a millimetre for the correct one.
            const double radius = 700_000.0;
            var span = PeriodOf(radius, KerbinMu) * 20.0;
            var far = new[]
            {
                new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
                new SystemBody(Kerbin, new OrbitElements(1.2e9, 0.0, 0, 0, 0, 0.0, 0.0, KerbinMu)),
            };
            var provider = new KeplerProvider(far);
            var model = Model(MunEntry());

            var bare = Drawn(NBodyTrajectory.Integrate(
                Request(radius, span, Array.Empty<PerturbingBody>()),
                model, Kerbin, provider));
            var perturbed = Drawn(NBodyTrajectory.Integrate(
                Request(radius, span, new[] { new PerturbingBody("Mun", Mun) }),
                model, Kerbin, provider));

            var a = bare.Points[bare.Points.Count - 1];
            var b = perturbed.Points[perturbed.Points.Count - 1];
            var separation = new Vector3d(b.X - a.X, b.Y - a.Y, b.Z - a.Z).Magnitude();
            Assert.True(
                separation < 1.0,
                "A perturber a hundred Mun-distances away must be worth less than a metre over "
                + "twenty revolutions. It was worth " + separation.ToString("F3") + " m, which is "
                + "the signature of the primary's own acceleration being left out of the term.");
        }

        [Fact]
        public void NoGravityModelIsARefusalWithItsOwnReason()
        {
            var answer = NBodyTrajectory.Integrate(
                Request(700_000.0, 600.0, Array.Empty<PerturbingBody>()),
                null,
                Kerbin,
                Provider());

            Assert.Equal(TrajectoryRefusal.NoForceModel, answer.Refusal);
            Assert.Null(answer.Arc);
        }

        [Fact]
        public void AnEmptyGravityModelIsAlsoNoForceModel()
        {
            var answer = NBodyTrajectory.Integrate(
                Request(700_000.0, 600.0, Array.Empty<PerturbingBody>()),
                Model(),
                Kerbin,
                Provider());

            Assert.Equal(TrajectoryRefusal.NoForceModel, answer.Refusal);
        }

        [Fact]
        public void AnExhaustedStepBudgetRefusesRatherThanPublishingWhatItHas()
        {
            // A partial curve is the dangerous answer: it stops where the budget
            // ran out, which on a diagram is indistinguishable from stopping where
            // the craft got to.
            var answer = NBodyTrajectory.Integrate(
                Request(700_000.0, 100_000.0, Array.Empty<PerturbingBody>(), maxSteps: 10),
                Model(MunEntry()),
                Kerbin,
                Provider());

            Assert.Equal(TrajectoryRefusal.BeyondBudget, answer.Refusal);
            Assert.Null(answer.Arc);
        }

        [Fact]
        public void APerturberTheModelDoesNotNameDegradesTheCurveAndSaysWhich()
        {
            var arc = Drawn(NBodyTrajectory.Integrate(
                Request(700_000.0, 600.0, new[] { new PerturbingBody("Mun", Mun) }),
                Model(new GravityModelBody("Kerbin", KerbinMu)),
                Kerbin,
                Provider()));

            Assert.Equal(TrajectoryDerivation.OwnNBodyDegraded, arc.Derivation);
            Assert.Equal(0, arc.ForceModel!.PerturbingBodyCount);
            Assert.Contains("Mun", arc.ForceModel.MissingTerm);
        }

        [Fact]
        public void AFullyMatchedModelIsNotDegraded()
        {
            var arc = Drawn(NBodyTrajectory.Integrate(
                Request(700_000.0, 600.0, new[] { new PerturbingBody("Mun", Mun) }),
                Model(MunEntry()),
                Kerbin,
                Provider()));

            Assert.Equal(TrajectoryDerivation.OwnNBody, arc.Derivation);
            Assert.Null(arc.ForceModel!.MissingTerm);
        }

        [Fact]
        public void DecimationKeepsTheEndsExactlyAndSaysHowMuchItDropped()
        {
            // The far end has to survive verbatim: a horizon mark is drawn on it,
            // and a mark a step short of where authority ends tells a small lie in
            // the one place the mechanism exists to tell the truth.
            const double radius = 700_000.0;
            var period = PeriodOf(radius, KerbinMu);
            var arc = Drawn(NBodyTrajectory.Integrate(
                Request(radius, period, Array.Empty<PerturbingBody>(), maxPoints: 16),
                Model(MunEntry()),
                Kerbin,
                Provider()));

            Assert.Equal(16, arc.Points.Count);
            Assert.True(
                arc.SourcePointCount > arc.Points.Count,
                "A decimated curve has to carry its pre-decimation count, or a thinned curve and "
                + "a short one read identically.");
            Assert.Equal(0.0, arc.Points[0].Ut, 6);
            Assert.Equal(arc.ToUt, arc.Points[arc.Points.Count - 1].Ut, 6);
            Assert.Equal(period, arc.ToUt, 6);
        }

        [Fact]
        public void AnUndecimatedCurveSaysItsSourceCountIsItsOwn()
        {
            var arc = Drawn(NBodyTrajectory.Integrate(
                Request(700_000.0, 600.0, Array.Empty<PerturbingBody>(), maxPoints: 100_000),
                Model(MunEntry()),
                Kerbin,
                Provider()));

            Assert.Equal(arc.Points.Count, arc.SourcePointCount);
        }

        [Fact]
        public void TheArcNamesItsFrameAndItsCentre()
        {
            var arc = Drawn(NBodyTrajectory.Integrate(
                Request(700_000.0, 600.0, Array.Empty<PerturbingBody>()),
                Model(MunEntry()),
                Kerbin,
                Provider()));

            Assert.Equal(TrajectoryFrameKind.BodyCentredInertial, arc.Frame.Kind);
            Assert.Equal(Kerbin, arc.Frame.CentreBodyIndex);
            Assert.False(arc.Frame.LengthsPulsate);
        }

        [Fact]
        public void EveryArcStatesThatItModelsNoAirAndNoOblateness()
        {
            // Both are stated on the payload rather than in documentation. A
            // reentry countdown computed in a vacuum is a vacuum countdown, and a
            // reader who does not know that will read it as a reentry one.
            var arc = Drawn(NBodyTrajectory.Integrate(
                Request(700_000.0, 600.0, new[] { new PerturbingBody("Mun", Mun) }),
                Model(MunEntry()),
                Kerbin,
                Provider()));

            Assert.True(arc.ForceModel!.Vacuum);
            Assert.Equal(0, arc.ForceModel.GeopotentialDegree);
            Assert.True(arc.ForceModel.GravityModelFound);
            Assert.Equal("kepler-from-snapshot", arc.ForceModel.BodyEphemeris);
            Assert.Equal(NBodyTrajectory.IntegratorName, arc.ForceModel.Integrator);
        }

        [Fact]
        public void ThirdBodyDominanceRisesWithTheThirdBody()
        {
            // Published so the chaotic regime is visible rather than inferred, so
            // it has to actually move with the thing it measures.
            const double radius = 2_000_000.0;
            var span = PeriodOf(radius, KerbinMu);
            var model = Model(MunEntry());
            var provider = Provider();

            var bare = Drawn(NBodyTrajectory.Integrate(
                Request(radius, span, Array.Empty<PerturbingBody>()), model, Kerbin, provider));
            var perturbed = Drawn(NBodyTrajectory.Integrate(
                Request(radius, span, new[] { new PerturbingBody("Mun", Mun) }),
                model, Kerbin, provider));

            Assert.Equal(0.0, bare.ForceModel!.ThirdBodyDominance!.Value);
            Assert.True(
                perturbed.ForceModel!.ThirdBodyDominance!.Value > 0.0,
                "A summed perturber has to show in the dominance, or the field reports zero "
                + "through the exact regime it exists to warn about.");
        }

        [Fact]
        public void TheStepIsPeriodRelativeSoCostIsFlatInRevolutions()
        {
            // A fixed ten seconds is finest exactly where it matters least. Same
            // step count per revolution at either altitude is the property.
            var low = NBodyTrajectory.StepFor(PeriodOf(700_000.0, KerbinMu));
            var high = NBodyTrajectory.StepFor(PeriodOf(3_463_334.0, KerbinMu));
            Assert.True(high > low * 5.0);
            Assert.Equal(
                PeriodOf(700_000.0, KerbinMu) / NBodyTrajectory.StepsPerRevolution, low, 6);
        }

        [Fact]
        public void ADegeneratePeriodStillGivesAStepThatCanTerminate()
        {
            // A step of zero would spin the loop against its budget and refuse for
            // a reason that names the budget rather than the degenerate input.
            Assert.True(NBodyTrajectory.StepFor(0.0) > 0.0);
            Assert.True(NBodyTrajectory.StepFor(double.NaN) > 0.0);
            Assert.True(NBodyTrajectory.StepFor(-5.0) > 0.0);
        }

        [Fact]
        public void ARefusalHasToNameItsReason()
        {
            // Unspecified is what a producer that never attempted an arc sends, and
            // a client reads it as nothing refused. Refusing with it would be
            // silence dressed as a refusal.
            Assert.Throws<ArgumentException>(
                () => TrajectoryArcAnswer.Refused(TrajectoryRefusal.Unspecified));
        }

        [Fact]
        public void AnArcOfFewerThanTwoPointsIsNotPublishable()
        {
            var arc = new TrajectoryArc();
            arc.Points.Add(new TrajectoryPoint { Ut = 0, X = 1, Y = 0, Z = 0 });
            Assert.Throws<ArgumentException>(() => TrajectoryArcAnswer.Drawn(arc));
        }
    }
}
