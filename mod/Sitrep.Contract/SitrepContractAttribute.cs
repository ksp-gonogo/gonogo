using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Marks a wire-visible class or enum as part of the Sitrep contract, so the
    /// build's contract shape check can see it. A removed, renamed or retyped
    /// member of a marked class, or a renamed or renumbered member of a marked
    /// enum, is a breaking change that requires a <see cref="ContractVersion.Major"/>
    /// change.
    /// <internal>
    /// Every type carrying [TsInterface] carries this too; the shape gate is
    /// Sitrep.Host.Tests.ContractShapeGateTests. A separate, same-assembly
    /// attribute because Reinforced.Typings (where [TsInterface] lives) is a
    /// compile-time-only codegen dependency that must never become a runtime
    /// dependency of anything referencing Sitrep.Contract (Kopernicus fails to
    /// load the net472 build otherwise). Reflecting over [TsInterface] at run
    /// time forces the CLR to load its declaring assembly; resolving this
    /// attribute never loads anything beyond Sitrep.Contract itself.
    /// </internal>
    /// </summary>
    /// <category>Serialization</category>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Enum, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepContractAttribute : Attribute
    {
    }
}
