using Sitrep.Contract;

namespace Sitrep.Contract.Tests
{
    /// <summary>
    /// Contract-shaped POCOs that exist only to be WRONG, so the reckonability gate
    /// can be shown failing.
    ///
    /// <para><b>Why these are fixtures and not compile errors.</b>
    /// <see cref="SitrepReckonableAttribute"/>'s arguments are strings, and a bogus
    /// input name is a perfectly valid compile-time constant that nothing forces to
    /// resolve. That is the whole reason the gate exists, and it is also what makes
    /// planting a violation possible: the only other way to plant one is to write it
    /// into <c>Sitrep.Contract</c> itself, where it either ships to every consumer or
    /// blocks the build for everyone. A red test is the honest form.</para>
    ///
    /// <para>They live in the TEST assembly, so the production sweep over
    /// <c>Sitrep.Contract</c> never sees them and no fake topic id can reach the
    /// wire.</para>
    /// </summary>
    public static class ReckonabilityFakes
    {
        /// <summary>A clean declaration: the gate must report NOTHING for this one.</summary>
        [SitrepContract]
        [SitrepTopic("fake.resolvable")]
        public class Resolvable
        {
            [SitrepReckonable(ReckoningBases.KeplerPropagation, "epoch")]
            public double Range { get; set; }

            public double Epoch { get; set; }
        }

        /// <summary>An input naming a field this payload does not publish.</summary>
        [SitrepContract]
        [SitrepTopic("fake.dangling-same-topic")]
        public class DanglingSameTopicInput
        {
            [SitrepReckonable(ReckoningBases.KeplerPropagation, "noSuchField")]
            public double Range { get; set; }
        }

        /// <summary>An input naming a Topic nothing publishes.</summary>
        [SitrepContract]
        [SitrepTopic("fake.dangling-cross-topic")]
        public class DanglingCrossTopicInput
        {
            [SitrepReckonable(ReckoningBases.KeplerPropagation, "@no.such.topic")]
            public double Range { get; set; }
        }

        /// <summary>A real Topic, a field that Topic does not carry.</summary>
        [SitrepContract]
        [SitrepTopic("fake.dangling-cross-field")]
        public class DanglingCrossTopicField
        {
            [SitrepReckonable(ReckoningBases.KeplerPropagation, "@fake.resolvable#noSuchField")]
            public double Range { get; set; }
        }

        /// <summary>The marked value listed as its own input, which the anchor rule forbids.</summary>
        [SitrepContract]
        [SitrepTopic("fake.self-referential")]
        public class SelfReferentialInput
        {
            [SitrepReckonable(ReckoningBases.KeplerPropagation, "range")]
            public double Range { get; set; }
        }

        /// <summary>A mark on an array Topic, whose projection cannot be joined back to its element.</summary>
        [SitrepContract]
        [SitrepTopic("fake.array", isArray: true)]
        public class ArrayTopicMark
        {
            [SitrepReckonable(ReckoningBases.KeplerPropagation, "epoch")]
            public double Range { get; set; }

            public double Epoch { get; set; }
        }

        /// <summary>A mark on a nested shape that no Topic publishes.</summary>
        [SitrepContract]
        public class UntopickedMark
        {
            [SitrepReckonable(ReckoningBases.KeplerPropagation, "epoch")]
            public double Range { get; set; }

            public double Epoch { get; set; }
        }

        /// <summary>A basis token invented at the call site instead of chosen from the catalogue.</summary>
        [SitrepContract]
        [SitrepTopic("fake.unknown-basis")]
        public class UnknownBasis
        {
            [SitrepReckonable("vibes", "epoch")]
            public double Range { get; set; }

            public double Epoch { get; set; }
        }

        /// <summary>A mark that declares nothing to run on.</summary>
        [SitrepContract]
        [SitrepTopic("fake.no-inputs")]
        public class NoInputs
        {
            [SitrepReckonable(ReckoningBases.KeplerPropagation)]
            public double Range { get; set; }
        }

        /// <summary>The same input twice, which reads as two promises and is one.</summary>
        [SitrepContract]
        [SitrepTopic("fake.duplicate-input")]
        public class DuplicateInput
        {
            [SitrepReckonable(ReckoningBases.KeplerPropagation, "epoch", "epoch")]
            public double Range { get; set; }

            public double Epoch { get; set; }
        }
    }
}
