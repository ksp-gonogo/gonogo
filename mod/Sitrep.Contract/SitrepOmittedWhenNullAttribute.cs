using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Marks a nullable property whose KEY is left out of the JSON entirely when
    /// the value is absent, instead of being written as <c>"key":null</c>.
    ///
    /// <para>That is the exception, not the rule. <c>JsonWriter.AppendObject</c>
    /// walks every pair in a payload dictionary and calls <c>AppendValue</c>
    /// unconditionally, and <c>AppendValue</c>'s <c>case null:</c> writes the
    /// four bytes <c>null</c>, so an absent reading normally reaches a client as
    /// a key that is present and null. The generated TypeScript says so:
    /// <c>RtConfig.ApplyUnitValueTypes</c> emits a nullable value-type property
    /// as <c>name?: T | null</c>.</para>
    ///
    /// <para>This attribute turns that off for one property, which then emits as
    /// <c>name?: T</c>, because a key that is never written cannot arrive null
    /// and a type claiming otherwise sends a reader looking for a state that does
    /// not exist. Put the REASON on the property beside it: the omission is a
    /// hand-written branch in a flattener, and the attribute only mirrors the
    /// decision the flattener already made.</para>
    /// </summary>
    [AttributeUsage(AttributeTargets.Property, AllowMultiple = false, Inherited = false)]
    public sealed class SitrepOmittedWhenNullAttribute : Attribute
    {
    }
}
