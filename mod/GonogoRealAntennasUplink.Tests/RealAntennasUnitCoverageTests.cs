using System.Reflection;
using Gonogo.RealAntennasUplink;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the uplink-types-out-of-core plan's Unit guard
    /// (§5b): now that the three RA-only comms payload types live in their own
    /// assembly (<c>GonogoRealAntennasUplink.Contract</c>) instead of
    /// <c>Sitrep.Contract</c>, nothing FORCES a future property on this Uplink's
    /// own contract types to declare its unit. The sweep itself is
    /// <c>UnitCoverageAssertion.AssertExhaustive</c>, shared with every other
    /// relocated Uplink; this file names what is this Uplink's own.
    ///
    /// <para><b>Why no baseline file.</b> Every scalar property on all three types
    /// is already annotated, so the surface starts, and must stay, entirely
    /// covered: same zero-pending starting point as every other relocated
    /// slice.</para>
    ///
    /// <para><b>What is distinctive about the link half of this slice: it is
    /// nearly all real quantities.</b> Four of the five annotated properties on
    /// the three link channels name a dimension the unit model resolves (a ratio,
    /// two bit rates, a decibel margin), and the fifth is a bool flag. Decibels is
    /// the case worth naming: a margin printed without its unit is not merely
    /// bare, it is ambiguous with the ratio on the sibling channel.</para>
    ///
    /// <para><b>The targeting surface broke that pattern, deliberately.</b> The
    /// per-antenna channel and the two commands' args brought this slice its first
    /// identifiers, its first free text and its first command args, because
    /// RealAntennas stopped being something a client only looks at. Their unit
    /// declarations carry a different weight in consequence: an antenna id is a
    /// token read off the channel and handed straight back, and an angle written
    /// as a bare number is the same ambiguity the margin has, one step closer to
    /// the craft.</para>
    ///
    /// <para>This test only checks the ATTRIBUTE side (every scalar wire property
    /// carries <c>[SitrepUnit]</c>); the generated-file/import side is
    /// <c>generated-value-import.test.ts</c> in this Uplink's client package, and
    /// the runtime-registry side is <c>topics.test.ts</c> there.</para>
    /// </summary>
    public class RealAntennasUnitCoverageTests
    {
        [Fact]
        public void EveryScalarWirePropertyDeclaresAUnit() =>
            UnitCoverageAssertion.AssertExhaustive(
                typeof(CommsLinkQuality).Assembly,
                "Units.Decibels/Units.BitsPerSecond");

        /// <summary>
        /// Every type in the slice is reached by the sweep, and nothing else is.
        /// <see cref="EveryScalarWirePropertyDeclaresAUnit"/> passes VACUOUSLY on
        /// any type the sweep does not reach, so a type losing its
        /// <c>[SitrepContract]</c> tag would leave the remaining green looking
        /// untouched. It also pins the extraction BOUNDARY: this slice must hold
        /// the three provider-private payloads and nothing from the shared comms
        /// family, so a later commit dragging <c>CommsHop</c> or
        /// <c>CommsConnectivity</c> across reds here rather than passing quietly.
        /// </summary>
        [Fact]
        public void EveryRelocatedTypeIsReachedByTheCoverageScan() =>
            UnitCoverageAssertion.AssertContractTypesAreExactly(
                typeof(CommsLinkQuality).Assembly,
                nameof(CommsLinkQuality),
                nameof(CommsDataRate),
                nameof(CommsLinkMargin),
                // The RA namespace of CommsHop's provider extension bag: RA-owned,
                // so its unit coverage is guarded here alongside the three private
                // channels rather than in core (CommsHop itself stays core).
                nameof(RealAntennasHopExt),
                // The element type of the realantennas.hopRates channel: the
                // forward band rate that left CommsHop (Major 13) for this Uplink's
                // own channel, keyed by node id. RA-owned, guarded here.
                nameof(RealAntennasHopRate),
                // The targeting surface: the per-antenna channel's element type and
                // the two commands' args. They are what made this slice stop being
                // pure observation, so the class comment above no longer describes
                // the whole of it: identifiers and free text arrived with them.
                nameof(RealAntennasAntennaState),
                nameof(RealAntennasTargetArgs),
                nameof(RealAntennasAntennaArgs));

        /// <summary>
        /// The antenna id is what both commands address, and it must stay a
        /// declared identifier rather than drifting into free text: a client reads
        /// it off this channel and hands it straight back, so it is a token, not a
        /// label to render.
        /// </summary>
        [Fact]
        public void TheAntennaAddressIsDeclaredAnIdentifierOnBothSidesOfTheRoundTrip()
        {
            foreach (var property in new[]
                     {
                         typeof(RealAntennasAntennaState).GetProperty(nameof(RealAntennasAntennaState.AntennaId))!,
                         typeof(RealAntennasTargetArgs).GetProperty(nameof(RealAntennasTargetArgs.AntennaId))!,
                         typeof(RealAntennasAntennaArgs).GetProperty(nameof(RealAntennasAntennaArgs.AntennaId))!,
                     })
            {
                Assert.Equal(Units.Id, property.GetCustomAttribute<SitrepUnitAttribute>()!.Unit);
            }
        }

        /// <summary>
        /// Every angle on the targeting surface declares degrees. A bare number
        /// beside a beamwidth is exactly the ambiguity the margin's decibels test
        /// below exists for: an elevation of 0.7 could be radians, and RealAntennas
        /// stores none of these in radians.
        /// </summary>
        [Fact]
        public void EveryTargetingAngleDeclaresDegrees()
        {
            foreach (var property in new[]
                     {
                         typeof(RealAntennasAntennaState).GetProperty(nameof(RealAntennasAntennaState.Beamwidth))!,
                         typeof(RealAntennasAntennaState).GetProperty(nameof(RealAntennasAntennaState.Cone3Db))!,
                         typeof(RealAntennasAntennaState).GetProperty(nameof(RealAntennasAntennaState.Cone10Db))!,
                         typeof(RealAntennasTargetArgs).GetProperty(nameof(RealAntennasTargetArgs.Azimuth))!,
                         typeof(RealAntennasTargetArgs).GetProperty(nameof(RealAntennasTargetArgs.Elevation))!,
                         typeof(RealAntennasTargetArgs).GetProperty(nameof(RealAntennasTargetArgs.Forward))!,
                     })
            {
                Assert.Equal(Units.Degrees, property.GetCustomAttribute<SitrepUnitAttribute>()!.Unit);
            }
        }

        /// <summary>
        /// The margin, pinned by name and by unit. It is the one reading in this
        /// slice a client cannot guess the dimension of from the value: a ratio is
        /// obviously 0..1 and a bit rate is obviously large, but a bare "3.5" next
        /// to a link is meaningless without dB, and would read as a plausible ratio
        /// on the sibling channel.
        /// </summary>
        [Fact]
        public void TheMarginDeclaresDecibels()
        {
            var margin = typeof(CommsLinkMargin).GetProperty(nameof(CommsLinkMargin.DecibelMargin))!;

            Assert.True(UnitCoverageAssertion.RequiresUnit(margin));
            Assert.Equal(Units.Decibels, margin.GetCustomAttribute<SitrepUnitAttribute>()!.Unit);
        }

        /// <summary>
        /// Both directions of the data rate declare the same unit. Asserted as a
        /// pair because a half-annotated type is the realistic regression here:
        /// they are adjacent properties added together, and one of them silently
        /// losing its annotation would still leave
        /// <see cref="EveryScalarWirePropertyDeclaresAUnit"/> red only if the sweep
        /// reaches it, which is precisely what the exactness test above defends.
        /// </summary>
        [Fact]
        public void BothDataRateDirectionsDeclareBitsPerSecond()
        {
            foreach (var name in new[]
                     {
                         nameof(CommsDataRate.UpBitsPerSec),
                         nameof(CommsDataRate.DownBitsPerSec),
                     })
            {
                var prop = typeof(CommsDataRate).GetProperty(name)!;
                Assert.True(UnitCoverageAssertion.RequiresUnit(prop));
                Assert.Equal(Units.BitsPerSecond, prop.GetCustomAttribute<SitrepUnitAttribute>()!.Unit);
            }
        }

        /// <summary>
        /// <see cref="CommsLinkMargin.ClosesLink"/> is the contrast case: annotated
        /// like everything else, but with a NON-quantity token, so it must stay a
        /// bare bool through the retyping rather than becoming a
        /// <c>Value&lt;&gt;</c>. It is the only property in the slice for which
        /// that is true, which is why the generated-file test on the client side
        /// names it too.
        /// </summary>
        [Fact]
        public void TheClosureFlagIsAnnotatedButNotAQuantity()
        {
            var closes = typeof(CommsLinkMargin).GetProperty(nameof(CommsLinkMargin.ClosesLink))!;

            Assert.Equal(Units.Flag, closes.GetCustomAttribute<SitrepUnitAttribute>()!.Unit);
            Assert.Equal(typeof(bool), closes.PropertyType);
        }
    }
}
