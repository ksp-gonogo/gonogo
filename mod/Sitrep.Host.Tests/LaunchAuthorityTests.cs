using System;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class LaunchAuthorityTests
    {
        private sealed class Body
        {
            public Body(string name, bool isStar = false)
            {
                Name = name;
                IsStar = isStar;
                Parent = this;
            }

            public string Name { get; }
            public bool IsStar { get; }

            /// <summary>Itself for a body with no orbit, the way KSP's referenceBody answers.</summary>
            public Body? Parent { get; set; }

            public Body Orbiting(Body parent)
            {
                Parent = parent;
                return this;
            }
        }

        private static Body? RootOf(Body body) =>
            LaunchAuthority.SystemRootOf(body, b => b.Parent, b => b.IsStar);

        private static readonly SystemRoot KerbinSystem = new SystemRoot(1, "Kerbin", isStar: false);
        private static readonly SystemRoot DunaSystem = new SystemRoot(6, "Duna", isStar: false);
        private static readonly SystemRoot SunSystem = new SystemRoot(0, "Sun", isStar: true);

        private static Func<LaunchReach> Reach(string centre, SystemRoot? centreSystem, SystemRoot? siteSystem) => () => new LaunchReach
        {
            CentreName = centre,
            SiteName = "Launch Pad",
            CentreSystem = centreSystem,
            SiteSystem = siteSystem,
        };

        private static Func<LaunchReach> NeverAsked() =>
            () => throw new InvalidOperationException("the reach was read for a vantage that is not a place");

        [Fact]
        public void APlanetOrbitingTheSunIsItsOwnRoot()
        {
            var sun = new Body("Sun", isStar: true);
            var kerbin = new Body("Kerbin").Orbiting(sun);

            Assert.Same(kerbin, RootOf(kerbin));
        }

        [Fact]
        public void AMoonsRootIsItsPlanetAndSoIsASubMoons()
        {
            var sun = new Body("Sun", isStar: true);
            var jool = new Body("Jool").Orbiting(sun);
            var laythe = new Body("Laythe").Orbiting(jool);
            var subMoon = new Body("Laythe's moon").Orbiting(laythe);

            Assert.Same(jool, RootOf(laythe));
            Assert.Same(jool, RootOf(subMoon));
        }

        [Fact]
        public void TheSunIsItsOwnRootSoACraftInSolarOrbitIsInNoPlanetsSystem()
        {
            var sun = new Body("Sun", isStar: true);

            Assert.Same(sun, RootOf(sun));
        }

        [Fact]
        public void ACompanionStarAndItsPlanetsAreSeparateFromTheSunsPlanets()
        {
            var sun = new Body("Sun", isStar: true);
            var kerbin = new Body("Kerbin").Orbiting(sun);
            var companion = new Body("Companion", isStar: true).Orbiting(sun);
            var farPlanet = new Body("Far Planet").Orbiting(companion);
            var farMoon = new Body("Far Moon").Orbiting(farPlanet);

            Assert.Same(companion, RootOf(companion));
            Assert.Same(farPlanet, RootOf(farMoon));
            Assert.NotSame(RootOf(kerbin), RootOf(farMoon));
        }

        [Fact]
        public void AStarOrbitingARootThatIsNotAStarStopsAtTheStar()
        {
            var core = new Body("Galactic Core");
            var sun = new Body("Sun", isStar: true).Orbiting(core);
            var kerbin = new Body("Kerbin").Orbiting(sun);

            Assert.Same(kerbin, RootOf(kerbin));
        }

        [Fact]
        public void ANullParentIsTheSameAnswerAsNoOrbit()
        {
            var lone = new Body("Lone") { Parent = null };

            Assert.Same(lone, RootOf(lone));
        }

        [Fact]
        public void AHierarchyThatNeverEndsHasNoRoot()
        {
            var a = new Body("A");
            var b = new Body("B").Orbiting(a);
            a.Orbiting(b);

            Assert.Null(RootOf(a));
        }

        [Fact]
        public void ACentreInThePadsOwnSystemMayLaunch()
        {
            Assert.Null(LaunchAuthority.Refusal("vessel:mun-base", "LaunchPad", Reach("Mun Base", KerbinSystem, KerbinSystem)));
        }

        [Fact]
        public void ACentreInAnotherPlanetsSystemIsRefusedAndTheRefusalNamesBothEnds()
        {
            var refusal = LaunchAuthority.Refusal("vessel:ike-base", "LaunchPad", Reach("Ike Base", DunaSystem, KerbinSystem));

            Assert.NotNull(refusal);
            Assert.False(refusal!.Success);
            Assert.Equal(CommandErrorCode.OutOfReach, refusal.ErrorCode);
            Assert.Equal(
                "Ike Base is in the Duna system, and a launch from Launch Pad needs a command centre in the Kerbin system",
                refusal.Detail);
        }

        [Fact]
        public void ACentreInSolarOrbitIsRefusedAsOutsideEveryPlanetsSystem()
        {
            var refusal = LaunchAuthority.Refusal("vessel:transfer", "LaunchPad", Reach("Transfer Stage", SunSystem, KerbinSystem));

            Assert.Equal(CommandErrorCode.OutOfReach, refusal!.ErrorCode);
            Assert.Equal(
                "Transfer Stage is in orbit of Sun, outside every planet's system, and a launch from Launch Pad needs a command centre in the Kerbin system",
                refusal.Detail);
        }

        [Theory]
        [InlineData("")]
        [InlineData(null)]
        public void WithNoCommandCentreAnywhereThereIsNoVantageToRefuse(string? vantage)
        {
            Assert.Null(LaunchAuthority.Refusal(vantage, "LaunchPad", NeverAsked()));
        }

        [Fact]
        public void TheMetaVantageIsNotAPlaceALaunchCanBeSentFrom()
        {
            var refusal = LaunchAuthority.Refusal(ChannelEngine.MetaVantage, "LaunchPad", NeverAsked());

            Assert.Equal(CommandErrorCode.OutOfReach, refusal!.ErrorCode);
            Assert.Equal("a launch is sent from a command centre, and the meta vantage is not one", refusal.Detail);
        }

        [Fact]
        public void AVantageThatNamesNoActiveCentreIsRefusedByName()
        {
            var refusal = LaunchAuthority.Refusal("vessel:gone", "LaunchPad", () => new LaunchReach
            {
                SiteName = "Launch Pad",
                SiteSystem = KerbinSystem,
            });

            Assert.Equal(CommandErrorCode.NotFound, refusal!.ErrorCode);
            Assert.Equal("'vessel:gone' is not an active command centre", refusal.Detail);
        }

        [Fact]
        public void ASiteTheGameDoesNotKnowIsRefusedByName()
        {
            var refusal = LaunchAuthority.Refusal("ground:KSC", "Duna_Pad", () => new LaunchReach
            {
                CentreName = "Kerbal Space Center",
                CentreSystem = KerbinSystem,
            });

            Assert.Equal(CommandErrorCode.NotFound, refusal!.ErrorCode);
            Assert.Equal("no launch site is named 'Duna_Pad'", refusal.Detail);
        }

        [Fact]
        public void ACentreWhoseSystemCouldNotBeReadIsRefusedRatherThanWaved()
        {
            var refusal = LaunchAuthority.Refusal("ground:KSC", "LaunchPad", Reach("Kerbal Space Center", null, KerbinSystem));

            Assert.Equal(CommandErrorCode.Unreadable, refusal!.ErrorCode);
            Assert.Equal("which system Kerbal Space Center is in could not be read", refusal.Detail);
        }

        [Fact]
        public void ASiteWhoseSystemCouldNotBeReadIsRefusedRatherThanWaved()
        {
            var refusal = LaunchAuthority.Refusal("ground:KSC", "LaunchPad", Reach("Kerbal Space Center", KerbinSystem, null));

            Assert.Equal(CommandErrorCode.Unreadable, refusal!.ErrorCode);
            Assert.Equal("which system Launch Pad is in could not be read", refusal.Detail);
        }
    }
}
