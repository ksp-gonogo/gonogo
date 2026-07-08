using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Marks a wire-visible type for the CI "lying minor" gate
    /// (<c>Sitrep.Host.Tests.ContractShapeGateTests</c>) — every type that
    /// already carries <c>[TsInterface]</c> (the <c>rtcli</c> TS-SDK-codegen
    /// marker, see <c>Sitrep.Contract.csproj</c>'s own doc comment) also
    /// carries this one. Also applied to every wire-visible ENUM (e.g.
    /// <see cref="Quality"/>, <see cref="Staleness"/>) — a member rename or
    /// renumber is just as breaking a wire change as a removed/retyped
    /// property, so the gate must see enums too (<c>AttributeTargets.Enum</c>
    /// below).
    ///
    /// Deliberately a SEPARATE, same-assembly attribute rather than reusing
    /// <c>[TsInterface]</c> directly: <c>Reinforced.Typings</c> (where
    /// <c>[TsInterface]</c> lives) is a COMPILE-time-only codegen dependency
    /// by explicit design — that csproj comment is emphatic that it must
    /// NEVER become a runtime dependency of anything that references
    /// <c>Sitrep.Contract</c> (Kopernicus would fail to load the net472
    /// build otherwise). Reflecting over <c>[TsInterface]</c> at runtime
    /// (e.g. <c>CustomAttributeData.AttributeType</c>, which forces the CLR
    /// to resolve/load the attribute's declaring assembly) would violate
    /// that guarantee the moment anything actually needs to inspect it
    /// outside the netstandard2.0 rtcli codegen path — exactly what the
    /// shape gate needs to do. <see cref="SitrepContractAttribute"/> lives
    /// IN <c>Sitrep.Contract</c> itself, so resolving it never requires
    /// loading anything beyond the assembly already being reflected over.
    /// </summary>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Enum, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepContractAttribute : Attribute
    {
    }
}
