using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// The name a field is listed under where an operator picks a value, such as
    /// a graph's series picker and its legend ("Altitude (sea level)" for
    /// <c>altitudeAsl</c>). Useful where the field's own name, split into words,
    /// would read ambiguously or as an abbreviation. A field without one is
    /// listed under its name split into words. Name a Topic itself with
    /// <see cref="SitrepTopicAttribute.DisplayName"/>.
    ///
    /// <para>The name is a fact about the field, so it applies wherever the
    /// field's shape is published: a name on <see cref="VesselOrbit"/>'s
    /// <c>Sma</c> also names the target's orbit's.</para>
    /// <internal>
    /// RtConfig.EmitUnitMap carries it into the generated contract tag table and
    /// UnitDescriptor into units.json, which the AsyncAPI document reads as each
    /// property's title. Compiled into both target frameworks, like
    /// SitrepTopicAttribute, so reflecting over it never resolves an external
    /// assembly. JsonWriter never reads it.
    /// </internal>
    /// </summary>
    /// <category>Serialization</category>
    [AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepDisplayNameAttribute : Attribute
    {
        /// <summary>The name the field is listed under.</summary>
        public string Name { get; }

        /// <summary>Names the property.</summary>
        /// <param name="name">The name the field is listed under, in the game's own nouns.</param>
        public SitrepDisplayNameAttribute(string name)
        {
            Name = name;
        }
    }
}
