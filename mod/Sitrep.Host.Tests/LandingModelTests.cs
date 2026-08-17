using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for the pure landing maths (<see cref="LandingModel"/>): the
    /// source-side relevance gate and the atmosphere-aware terminal-velocity
    /// model. No KSP types: the KSP capture feeds these the live readings.
    /// </summary>
    public class LandingModelTests
    {
        // ── Relevance gate ──────────────────────────────────────────────────

        [Fact]
        public void RelevantWhenDescendingTowardASolidPqsSurfaceWithinHorizon()
        {
            // 1000 m up, descending 50 m/s => 20 s to terrain, horizon 120 s.
            Assert.True(LandingModel.IsRelevant(
                hasSolidSurface: true, hasPqs: true,
                verticalSpeed: -50, heightFromTerrain: 1000, horizonSeconds: 120));
        }

        [Fact]
        public void NotRelevantWithoutSolidSurfaceOrPqs()
        {
            Assert.False(LandingModel.IsRelevant(false, true, -50, 1000, 120));
            Assert.False(LandingModel.IsRelevant(true, false, -50, 1000, 120));
        }

        [Fact]
        public void NotRelevantWhenAscendingOrLevel()
        {
            Assert.False(LandingModel.IsRelevant(true, true, +50, 1000, 120));
            Assert.False(LandingModel.IsRelevant(true, true, 0, 1000, 120));
        }

        [Fact]
        public void NotRelevantWhenStillBeyondTheClosureHorizon()
        {
            // 100 km up, descending 1 m/s => 100000 s to terrain, past a 120 s horizon.
            Assert.False(LandingModel.IsRelevant(true, true, -1, 100000, 120));
        }

        // ── Terminal velocity ───────────────────────────────────────────────

        [Fact]
        public void TerminalVelocityUnchangedAtEqualDensityWhenAtTerminal()
        {
            // D == W (at terminal), same density => v_t == vNow.
            var vt = LandingModel.TerminalVelocityAt(
                dragForce: 10, weight: 10, vNow: 100, rhoNow: 0.1, rhoAt: 0.1);
            Assert.NotNull(vt);
            Assert.Equal(100.0, vt!.Value, 6);
        }

        [Fact]
        public void TerminalVelocityDropsInDenserAirTowardTheGround()
        {
            // Ground air 4x denser => terminal velocity halves.
            var vt = LandingModel.TerminalVelocityAt(
                dragForce: 10, weight: 10, vNow: 100, rhoNow: 0.1, rhoAt: 0.4);
            Assert.NotNull(vt);
            Assert.Equal(50.0, vt!.Value, 6);
        }

        [Fact]
        public void TerminalVelocityNullOnNonPositiveInputs()
        {
            Assert.Null(LandingModel.TerminalVelocityAt(0, 10, 100, 0.1, 0.1));
            Assert.Null(LandingModel.TerminalVelocityAt(10, 10, 100, 0, 0.1));
            Assert.Null(LandingModel.TerminalVelocityAt(10, 10, 100, 0.1, 0));
        }

        // ── Regime ──────────────────────────────────────────────────────────

        [Fact]
        public void ClassifyRegimeReadsTheDragWeightBalance()
        {
            Assert.Equal("at-terminal", LandingModel.ClassifyRegime(10.2, 10.0));
            Assert.Equal("decelerating", LandingModel.ClassifyRegime(20.0, 10.0));
            Assert.Equal("accelerating", LandingModel.ClassifyRegime(5.0, 10.0));
        }

        // ── Atmosphere-aware time to impact ─────────────────────────────────

        [Fact]
        public void AtmosphericTimeToImpactIntegratesTheDensityColumn()
        {
            // At terminal (D==W), constant density: dt = height / vNow.
            // 200 m at a constant 0.4 density; vNow 50, rhoNow 0.4 => v_t = 50
            // everywhere => TTI = 200 / 50 = 4 s.
            var tti = LandingModel.AtmosphericTimeToImpact(
                dragForce: 10, weight: 10, vNow: 50, rhoNow: 0.4,
                altitudes: new[] { 200.0, 100.0, 0.0 },
                densities: new[] { 0.4, 0.4, 0.4 });
            Assert.NotNull(tti);
            Assert.Equal(4.0, tti!.Value, 6);
        }

        [Fact]
        public void AtmosphericTimeToImpactNullOnDegenerateProfile()
        {
            Assert.Null(LandingModel.AtmosphericTimeToImpact(
                10, 10, 50, 0.4, new[] { 100.0 }, new[] { 0.4 }));
        }

        // ── The all-or-nothing field set ────────────────────────────────────

        [Fact]
        public void AtmosphericFieldsAreAbsentEntirelyWhenTheDragCouldNotBeRead()
        {
            // Null drag is "we could not read the parts", not "this craft has no
            // drag". Every field below is derived from those same parts, so they
            // are unknowable TOGETHER: publishing any of them from a zero yields
            // a plausible terminal velocity, a plausible time to impact, a
            // descent regime classified from a zero ratio and "no parachutes",
            // in the one place a reader is deciding whether a landing survives.
            Assert.Null(LandingModel.AtmosphericFields(
                dragForce: null, parachuteState: null,
                weight: 10, vNow: 50, rhoNow: 0.4, rhoGround: 0.4,
                altitudes: new[] { 200.0, 100.0, 0.0 },
                densities: new[] { 0.4, 0.4, 0.4 }));
        }

        [Fact]
        public void AtmosphericFieldsCarryTheWholeSetWhenTheDragWasRead()
        {
            // The sibling of the assertion above: all-or-nothing means the
            // present case has to be all, or "absent" would stop meaning
            // anything.
            var fields = LandingModel.AtmosphericFields(
                dragForce: 10, parachuteState: "armed",
                weight: 10, vNow: 50, rhoNow: 0.4, rhoGround: 0.4,
                altitudes: new[] { 200.0, 100.0, 0.0 },
                densities: new[] { 0.4, 0.4, 0.4 });

            Assert.NotNull(fields);
            Assert.Equal(50.0, (double)fields!["terminalVelocity"]!, 6);
            Assert.Equal(50.0, (double)fields["projectedTouchdownSpeed"]!, 6);
            Assert.Equal(4.0, (double)fields["atmosphericTimeToImpact"]!, 6);
            Assert.Equal("at-terminal", fields["descentRegime"]);
            Assert.Equal(1.0, (double)fields["dragToWeightRatio"]!, 6);
            Assert.Equal("armed", fields["parachuteState"]);
        }

        [Fact]
        public void AWeightlessCraftStillReportsItsRatioAsUnknownRatherThanZero()
        {
            var fields = LandingModel.AtmosphericFields(
                dragForce: 10, parachuteState: "none",
                weight: 0, vNow: 50, rhoNow: 0.4, rhoGround: 0.4,
                altitudes: new[] { 200.0, 100.0, 0.0 },
                densities: new[] { 0.4, 0.4, 0.4 });

            Assert.NotNull(fields);
            Assert.Null(fields!["dragToWeightRatio"]);
        }
    }
}
