using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Declares the field that identifies one entry of a list across samples: a
    /// kerbal's name in a crew roster, a part's flight id in a list of labs.
    ///
    /// <para>A list reorders, grows and shrinks between samples, so an entry's
    /// position says nothing about which entry it is. A value marked
    /// <see cref="SitrepReckonableAttribute"/> inside a list can only be carried
    /// forward when every list it sits in names its key, because a model that
    /// moved "the third entry" would move a different one the moment the list
    /// changed.</para>
    ///
    /// <para>It goes on one scalar property of the list's element type, and each
    /// level of a nested list names its own. A dictionary needs none: its key is
    /// the entry's identity already.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    [AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepEntryKeyAttribute : Attribute
    {
    }
}
