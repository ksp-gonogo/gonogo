#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One canonical 3-vector shape for the whole wire contract — kills
/// Telemachus's V-8 (bare <c>[x,y,z]</c> arrays in some places, <c>{x,y,z}</c>
/// objects in others, no consistent units). Every vector-valued field in
/// Sitrep.Contract uses this type; units are documented on the FIELD that
/// holds a <see cref="Vec3"/>, never implied by the shape itself.
/// </summary>
#if NETSTANDARD2_0
[TsInterface]
#endif
public class Vec3
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Z { get; set; }

    public Vec3()
    {
    }

    public Vec3(double x, double y, double z)
    {
        X = x;
        Y = y;
        Z = z;
    }
}
