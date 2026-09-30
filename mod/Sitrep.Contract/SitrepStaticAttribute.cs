using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Declares that THIS VALUE is static: a fact about its subject that does not
    /// change with time, so a copy of it is never old and it cannot become stale.
    ///
    /// <para>A body's radius, mass and atmosphere are static: the value observed
    /// once is the value now. A body's orbital elements are not, because the
    /// body's state moves along them even while the elements themselves hold.
    /// The test is whether the value at an instant nobody observed could differ
    /// from the last one observed, not whether the value tends to change.</para>
    ///
    /// <para><b>The other end of <see cref="SitrepReckonableAttribute"/>.</b> A
    /// reckonable value is carried forward between observations by a model with
    /// published inputs. A static value is carried forward by constancy, which is
    /// exact and needs no inputs, so the two marks never sit on one property, and
    /// the build rejects a property carrying both.</para>
    ///
    /// <para><b>Per value, never per topic,</b> for the reason reckonability is: a
    /// payload bundles heterogeneous fields, and a catalogue entry carries its
    /// orbit beside its radius. The client stamps a static value as it decodes
    /// it, so a figure drawn from one is never marked as held when the stream
    /// stops, and a figure drawn from anything else still is.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    [AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepStaticAttribute : Attribute
    {
    }
}
