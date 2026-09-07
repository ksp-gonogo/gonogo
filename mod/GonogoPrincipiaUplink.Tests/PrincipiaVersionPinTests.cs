using System.Linq;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The three build pins this Uplink carries have to name releases we have
    /// actually vetted, and until this file existed nothing compared any of them
    /// to anything.
    ///
    /// <para><b>They are deliberately three constants, not one, and this does not
    /// collapse them.</b> The read gate asks "were these READS analysed for abort
    /// safety", the write gate asks "were these WRITES analysed, and is the struct
    /// layout the one they were analysed with", and the supported set answers
    /// "whose interface have we derived at all". The first two are allowed to
    /// diverge, and <see cref="PrincipiaWriteAuthority"/>'s own summary explains
    /// why sharing one constant would let a decision to keep READING across a
    /// version bump silently carry the writes along with it. So no equality
    /// between those two is asserted here.</para>
    ///
    /// <para>What is not optional is the relation to the supported set. A build
    /// whose calls were analysed for abort safety, or whose burn struct was read
    /// off, is a build whose interface was derived: the analysis is done AGAINST
    /// the derived layouts. A pin naming a release absent from
    /// <see cref="PrincipiaSupportedSet"/> is therefore a pin claiming an analysis
    /// that has no subject, and it fails closed in the worst way, by binding and
    /// then calling.</para>
    /// </summary>
    public class PrincipiaVersionPinTests
    {
        private static string[] VettedNames =>
            PrincipiaSupportedSet.All.Select(r => r.Name).ToArray();

        [Fact]
        public void TheSupportedSetIsNotEmpty()
        {
            // Guards the two checks below from passing vacuously in the other
            // direction: an emptied set would make every "is it vetted" question
            // answerable only as no, but a set that lost its entries silently is
            // the state in which those failures would read as a version problem
            // rather than as a missing table.
            Assert.NotEmpty(PrincipiaSupportedSet.All);
        }

        [Fact]
        public void TheReadGatesBuildIsOneWhoseInterfaceWasDerived()
        {
            Assert.Contains(PrincipiaSession.AnalysedPluginVersion, VettedNames);
        }

        [Fact]
        public void TheWriteGatesBuildIsOneWhoseInterfaceWasDerived()
        {
            Assert.Contains(PrincipiaWriteAuthority.WriteAnalysedPluginVersion, VettedNames);
        }
    }
}
