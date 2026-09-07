// A Dv component that could not be read is not a Dv component of zero.
//
// PrincipiaBurnStruct's own summary states the rule the whole file is built on: a
// null from Get is "this is not the shape that was analysed", and every caller
// turns it into a refusal rather than into a default. DeltaV was the one caller
// that did the opposite, substituting 0.0 per component.
//
// The reachable case is not a renamed field. MissingBurnField already refuses a
// burn whose xyz has lost a member, so a shape change is caught above this. What
// is NOT caught is a component the producer genuinely holds and this Uplink
// cannot express: ReflectedMembers.AsDouble answers null for NaN and for either
// infinity, which is exactly the state Principia calls a singular maneuver and
// reports rather than aborting on. So a burn whose Dv went non-finite was
// published as a burn with zero Dv on that axis.
//
// Three consequences, and the middle one is the one that writes:
//
//   The wire carried a fabricated component AND a magnitude derived from it, so
//   the fabrication reached the operator twice on one row.
//
//   PrincipiaBurnRules.Reject's ValueNotFinite guard could not fire. It is
//   written for precisely this case, in those words, and the substitution one
//   layer down handed it three finite numbers every time, so a singular burn was
//   sent back to the plugin by the check that exists to stop it.
//
//   The round-trip probe compared 0.0 against 0.0 and reported no difference, so
//   a component that went in finite and came back NaN passed as unchanged.
using System;
using System.Collections.Generic;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    public class BurnDeltaVAbsenceTests
    {
        /// <summary>
        /// A burn out of the plugin whose Dv has gone singular on one axis. Every
        /// other field is ordinary: the point is the one component, not a burn that
        /// is broken all over.
        /// </summary>
        private static FakeBurn SingularBurn()
        {
            var burn = FakeBurn.FromPlugin();
            burn.intensity.xyz.x = 120.0;
            burn.intensity.xyz.y = double.NaN;
            burn.intensity.xyz.z = -30.0;
            return burn;
        }

        /// <summary>
        /// The triple is unreadable, not partly readable. The two components that
        /// DID resolve are withheld with the third deliberately: a Dv of
        /// (120, 0, -30) is a burn nobody planned, and publishing two thirds of a
        /// vector while still calling it the vector is the same claim in a quieter
        /// voice.
        /// </summary>
        [Fact]
        public void AComponentThatIsNotANumberMakesTheWholeTripleUnreadable()
        {
            Assert.Null(new PrincipiaBurnStruct().DeltaV(SingularBurn()));
        }

        /// <summary>
        /// What the operator would have been told. Every component null and, with
        /// them, the magnitude, which is derived from the triple and so carried the
        /// fabrication a second time.
        /// </summary>
        [Fact]
        public void TheBurnReachesTheWireWithNoDeltaVRatherThanZero()
        {
            var manoeuvre = new FakeManoeuvre { burn = SingularBurn() };

            var described = PlanReader.Describe(manoeuvre, 0, 1, 0, 500.0, celestials: null);

            Assert.Null(described.DeltaVTangent);
            Assert.Null(described.DeltaVNormal);
            Assert.Null(described.DeltaVBinormal);

            var observation = new PlanObservation();
            observation.Burns.Add(described);
            var burns = Assert.IsType<List<object?>>(PlanBuilder.Build(observation)["burns"]);
            var published = Assert.IsType<Dictionary<string, object?>>(burns[0]);

            Assert.Null(published["deltaVTangent"]);
            Assert.Null(published["deltaVNormal"]);
            Assert.Null(published["deltaVBinormal"]);
            Assert.Null(published["deltaV"]);
        }

        /// <summary>
        /// The refusal that was already written for this and could not fire. Its
        /// own sentence names the case: Principia reports a singular maneuver
        /// rather than aborting on it, and there is no reason to ask. The
        /// substitution below it made the triple finite before the test ran, so the
        /// burn went back to the plugin every time.
        /// </summary>
        [Fact]
        public void ABurnWhoseDeltaVIsNotANumberIsRefusedRatherThanSent()
        {
            var refusal = PrincipiaBurnRules.Reject(SingularBurn());

            Assert.NotNull(refusal);
            Assert.Equal(PrincipiaWriteRefusal.ValueNotFinite, refusal!.Value.Refusal);
        }

        /// <summary>
        /// A burn whose shape has moved is still refused where it always was, one
        /// layer above this. Here so that the change above is read as reaching a
        /// case the missing-field guard never covered, rather than as a second
        /// answer to a question already settled.
        /// </summary>
        [Fact]
        public void ABurnMissingTheFieldEntirelyIsStillRefusedAsAShapeChange()
        {
            var refusal = PrincipiaBurnRules.Reject(new object());

            Assert.NotNull(refusal);
            Assert.Equal(PrincipiaWriteRefusal.PluginShapeChanged, refusal!.Value.Refusal);
        }

        /// <summary>
        /// And the edit path says which of the two it is.
        ///
        /// <para>Apply tests the shape at its top and refuses there, so by the time
        /// it reads the triple a null can no longer mean a missing field: the branch
        /// that used to catch one was unreachable, and withholding a non-finite
        /// triple is what made it live again. Left as it stood it would have told an
        /// operator whose burn went singular that Principia's struct had changed
        /// shape, which is a different fault, in a different place, with a different
        /// remedy.</para>
        /// </summary>
        [Fact]
        public void AnEditOntoANonFiniteTripleIsRefusedAsAValueRatherThanAShapeChange()
        {
            var refusal = PrincipiaBurnRules.Apply(
                SingularBurn(),
                new PrincipiaBurnEditArgs { BurnIndex = 0, DeltaVTangent = 25.0 },
                initialMassTons: 10.0);

            Assert.NotNull(refusal);
            Assert.Equal(PrincipiaWriteRefusal.ValueNotFinite, refusal!.Value.Refusal);
            Assert.DoesNotContain("shape", refusal.Value.Detail!, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// And the refusal above holds only where the unreadable triple is actually
        /// needed. An edit stating all three components overwrites every slot, so
        /// nothing is kept and nothing has to be read: it is the one move that mends
        /// a burn that has gone singular, and the sentence above tells an operator
        /// to make it.
        /// </summary>
        [Fact]
        public void StatingAllThreeComponentsMendsABurnWhoseTripleWasNotANumber()
        {
            var burn = SingularBurn();

            var refusal = PrincipiaBurnRules.Apply(
                burn,
                new PrincipiaBurnEditArgs
                {
                    BurnIndex = 0,
                    DeltaVTangent = 25.0,
                    DeltaVNormal = 0.0,
                    DeltaVBinormal = -5.0,
                },
                initialMassTons: 10.0);

            Assert.Null(refusal);
            var mended = new PrincipiaBurnStruct().DeltaV(burn);
            Assert.NotNull(mended);
            Assert.Equal(25.0, mended!.Value.X);
            Assert.Equal(0.0, mended.Value.Y);
            Assert.Equal(-5.0, mended.Value.Z);
        }

        /// <summary>
        /// And the round-trip probe sees it. Its own doc comment is the
        /// specification: an unreadable field records as <c>?</c> so a field that
        /// stopped resolving cannot pass as unchanged. While every component fell
        /// back to 0.0, a component that went in as zero and came back as NaN read
        /// as zero on both sides, and the write was reported to have survived the
        /// crossing intact.
        /// </summary>
        [Fact]
        public void AComponentThatCameBackNotANumberIsNotTheComponentThatWentIn()
        {
            var went = FakeBurn.FromPlugin();
            var came = FakeBurn.FromPlugin();
            came.intensity.xyz.y = double.NaN;

            var difference = PrincipiaLayoutProbe.DescribeBurnDifference(went, came);

            Assert.NotNull(difference);
            Assert.Contains("delta_v_normal", difference!);
            Assert.False(PrincipiaLayoutProbe.SameBurn(went, came));
        }
    }
}
