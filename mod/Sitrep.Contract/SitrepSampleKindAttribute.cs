using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Declares how one value relates in time, where it differs from the kind
    /// its channel declares on <see cref="ChannelDeclaration.Kind"/>.
    ///
    /// <para>It applies to the value and to everything beneath it, a nested
    /// shape or every entry of a list, and the nearest declaration on a path
    /// wins. A stage's dry mass inside a burning craft's propulsion is
    /// <see cref="SampleKind.Discrete"/> while the total mass beside it is
    /// <see cref="SampleKind.Continuous"/>.</para>
    ///
    /// <para>Only <see cref="SampleKind.Continuous"/> and
    /// <see cref="SampleKind.Discrete"/> may be declared here. Whether a sample
    /// is an occurrence is a fact about the whole sample, so
    /// <see cref="SampleKind.Event"/> belongs to the channel alone, and a field
    /// recording the last occurrence of something is Discrete.</para>
    /// </summary>
    /// <category>Channels and emission</category>
    [AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepSampleKindAttribute : Attribute
    {
        /// <summary>How this value relates in time.</summary>
        public SampleKind Kind { get; }

        /// <summary>Declares this value's kind as <paramref name="kind"/>.</summary>
        public SitrepSampleKindAttribute(SampleKind kind)
        {
            Kind = kind;
        }
    }
}
