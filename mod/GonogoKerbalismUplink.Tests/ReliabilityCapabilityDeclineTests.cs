using System.Collections.Generic;
using Gonogo.KerbalismUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoKerbalismUplink.Tests
{
    /// <summary>
    /// Whether this backend TAKES the exclusive "reliability" capability, which is
    /// a different question from what it answers once it has it.
    ///
    /// <para><b>Why it matters, and why nothing visibly broke.</b> An exclusive
    /// capability is held by exactly one provider. A backend that holds it while
    /// modelling nothing starves every lower-priority provider that could have
    /// modelled reliability on that install. A higher-priority provider currently
    /// outranks this one, so on the installs anybody here runs the starvation is
    /// invisible: the symptom needs a third provider between the two priorities,
    /// which is exactly the case a third-party author would hit and nobody here
    /// would.</para>
    ///
    /// <para>The cut is DEFINITE-off only, and the indeterminate case below is the
    /// point of the distinction rather than a leftover.</para>
    /// </summary>
    public class ReliabilityCapabilityDeclineTests
    {
        private static ReliabilityPreferencesRaw Prefs(bool? mtbfFailures) =>
            new() { MtbfFailures = mtbfFailures };

        [Fact]
        public void DeclinesWhenTheReliabilityFeatureIsSwitchedOff()
        {
            var features = new Dictionary<string, bool> { ["Reliability"] = false };

            Assert.Equal(ReliabilityCoverage.Disabled,
                KerbalismReliabilityMap.ComputeCoverage(features, Prefs(true)));
            Assert.False(KerbalismReliabilityMap.CanServe(features, Prefs(true)));
        }

        /// <summary>
        /// The gate that is easy to miss: with the feature ON and mtbfFailures OFF,
        /// Kerbalism's own Reliability FixedUpdate skips the whole wear-and-break
        /// path, so nothing ever fails and every part reads clean. Holding the
        /// capability there would tell the operator the craft is watched and fine.
        /// </summary>
        [Fact]
        public void DeclinesWhenMtbfFailuresAreSwitchedOffEvenWithTheFeatureOn()
        {
            var features = new Dictionary<string, bool> { ["Reliability"] = true };

            Assert.Equal(ReliabilityCoverage.Disabled,
                KerbalismReliabilityMap.ComputeCoverage(features, Prefs(false)));
            Assert.False(KerbalismReliabilityMap.CanServe(features, Prefs(false)));
        }

        [Fact]
        public void ServesWhenItIsActuallyModelling()
        {
            var features = new Dictionary<string, bool> { ["Reliability"] = true };

            Assert.Equal(ReliabilityCoverage.Modeled,
                KerbalismReliabilityMap.ComputeCoverage(features, Prefs(true)));
            Assert.True(KerbalismReliabilityMap.CanServe(features, Prefs(true)));
        }

        /// <summary>
        /// STILL SERVES when it cannot tell which way its own switch is set.
        ///
        /// <para>Declining hands the capability to the vanilla fallback, which says
        /// "nothing is installed that could model reliability". That is a false
        /// statement with Kerbalism sitting right there. Serving and admitting the
        /// uncertainty is honest; declining would launder a "do not know" into a
        /// clean "nothing here", which is the same class of mistake as the boolean
        /// this contract replaced.</para>
        /// </summary>
        [Theory]
        [InlineData(true)]   // feature on, mtbfFailures unreadable
        [InlineData(false)]  // features unreadable entirely
        public void ServesWhenItCannotTellWhetherItIsModelling(bool featuresResolved)
        {
            var features = featuresResolved
                ? new Dictionary<string, bool> { ["Reliability"] = true }
                : new Dictionary<string, bool>();
            var prefs = Prefs(featuresResolved ? null : true);

            Assert.Equal(ReliabilityCoverage.Indeterminate,
                KerbalismReliabilityMap.ComputeCoverage(features, prefs));
            Assert.True(KerbalismReliabilityMap.CanServe(features, prefs));
        }

        /// <summary>
        /// A features dictionary that resolved but carries no Reliability key at
        /// all: the type was found and the field was not, which is a shape this
        /// build does not understand rather than a switch it can read.
        /// </summary>
        [Fact]
        public void ServesWhenTheFeatureKeyIsAbsentFromAResolvedDictionary()
        {
            var features = new Dictionary<string, bool> { ["Science"] = true };

            Assert.Equal(ReliabilityCoverage.Indeterminate,
                KerbalismReliabilityMap.ComputeCoverage(features, Prefs(true)));
            Assert.True(KerbalismReliabilityMap.CanServe(features, Prefs(true)));
        }
    }
}
