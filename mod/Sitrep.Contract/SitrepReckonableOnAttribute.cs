using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Declares that an Uplink carries forward a value on a Topic it does not
    /// own: the assembly-level twin of <see cref="SitrepReckonableAttribute"/>,
    /// for a model whose subject is another owner's payload.
    ///
    /// <para>A model belongs with whoever supplies it, so the mark sits in the
    /// modelling Uplink's own contract, and its inputs may name that Uplink's
    /// Topics, which the Topic's owner has never heard of.</para>
    ///
    /// <para><see cref="Field"/> is the value's dotted path from the payload
    /// root as the wire spells it, with <c>*</c> for each list or dictionary it
    /// crosses: <c>resources.*.current</c>. An input without <c>@</c> is a path
    /// on the object holding the field, as it is for a property mark.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    [AttributeUsage(AttributeTargets.Assembly, Inherited = false, AllowMultiple = true)]
    public sealed class SitrepReckonableOnAttribute : Attribute
    {
        /// <summary>The Topic the modelled value is published on, such as <c>vessel.resources</c>.</summary>
        public string Topic { get; }

        /// <summary>The value's path inside that Topic's payload.</summary>
        public string Field { get; }

        /// <summary>One of the <see cref="ReckoningBases"/> tokens.</summary>
        public string Basis { get; }

        /// <summary>The published inputs the model needs, beyond the value itself.</summary>
        public string[] Inputs { get; }

        /// <summary>Marks <paramref name="field"/> of <paramref name="topic"/> as carried forward by <paramref name="basis"/> from <paramref name="inputs"/>.</summary>
        public SitrepReckonableOnAttribute(string topic, string field, string basis, params string[] inputs)
        {
            Topic = topic;
            Field = field;
            Basis = basis;
            Inputs = inputs ?? new string[0];
        }
    }
}
