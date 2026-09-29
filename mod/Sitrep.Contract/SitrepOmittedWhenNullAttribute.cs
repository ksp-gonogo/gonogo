using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Marks a nullable property whose KEY is left out of the JSON entirely when
    /// the value is absent, instead of being written as <c>"key":null</c>.
    ///
    /// <para>That is the exception, not the rule: an absent reading normally
    /// reaches a client as a key that is present and null, and the TypeScript
    /// type of a nullable property is <c>name?: T | null</c>. A marked property's
    /// type is <c>name?: T</c> instead, because a key that is never written
    /// cannot arrive null.</para>
    ///
    /// <para>The mark does not omit the key itself: the producer that writes the
    /// payload must leave it out, and the mark records that it does. Put the
    /// REASON on the property beside it.</para>
    /// <internal>
    /// <c>JsonWriter.AppendObject</c> walks every pair in a payload dictionary and
    /// calls <c>AppendValue</c> unconditionally, whose <c>case null:</c> writes
    /// <c>null</c>; <c>RtConfig.ApplyUnitValueTypes</c> emits any nullable property
    /// as <c>name?: T | null</c> unless this attribute is present. The omission is
    /// a hand-written branch in a flattener, and the attribute only mirrors it.
    /// </internal>
    /// </summary>
    /// <category>Serialization</category>
    [AttributeUsage(AttributeTargets.Property, AllowMultiple = false, Inherited = false)]
    public sealed class SitrepOmittedWhenNullAttribute : Attribute
    {
    }
}
