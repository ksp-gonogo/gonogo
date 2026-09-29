#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The one 3-vector shape on the wire: an <c>{x, y, z}</c> object. Every
/// vector-valued field in the contract uses this type. The unit and the
/// reference frame are documented on the field that holds a <see cref="Vec3"/>,
/// never implied by the shape itself.
/// </summary>
/// <category>Units and values</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Vec3
{
    /// <summary>The x component, in the unit and frame of the field holding this vector.</summary>
    [SitrepUnit(Units.NotApplicable)]
    public double X { get; set; }
    /// <summary>The y component, in the unit and frame of the field holding this vector.</summary>
    [SitrepUnit(Units.NotApplicable)]
    public double Y { get; set; }
    /// <summary>The z component, in the unit and frame of the field holding this vector.</summary>
    [SitrepUnit(Units.NotApplicable)]
    public double Z { get; set; }

    /// <summary>Creates the zero vector.</summary>
    public Vec3()
    {
    }

    /// <summary>Creates a vector from its three components.</summary>
    /// <param name="x">The x component.</param>
    /// <param name="y">The y component.</param>
    /// <param name="z">The z component.</param>
    public Vec3(double x, double y, double z)
    {
        X = x;
        Y = y;
        Z = z;
    }
}
