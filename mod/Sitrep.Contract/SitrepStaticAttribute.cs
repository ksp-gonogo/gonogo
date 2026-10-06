using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Declares that a value is static: a fact about its subject that does not
    /// change with time, so a copy of it is never out of date.
    ///
    /// <para>A body's radius, mass and atmosphere are static: the value observed
    /// once is the value now. A body's orbital elements are not, because the
    /// body's state moves along them even while the elements themselves hold.
    /// The test is whether the value at an instant nobody observed could differ
    /// from the last one observed, not whether the value tends to change.</para>
    ///
    /// <para>A property is never both static and
    /// <see cref="SitrepReckonableAttribute"/>, and the build rejects one that
    /// carries both: a reckonable value is carried forward by a model with
    /// published inputs, a static one by staying the same.</para>
    ///
    /// <para>It goes on each property, never on a whole topic, since one payload
    /// mixes both kinds: a catalogue entry carries its orbit beside its radius.
    /// The client stamps a static value as it decodes it, so a figure drawn from
    /// one is never marked as held when the stream stops, and a figure drawn from
    /// anything else still is.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    [AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepStaticAttribute : Attribute
    {
    }
}
