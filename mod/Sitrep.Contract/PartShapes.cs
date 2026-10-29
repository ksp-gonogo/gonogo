using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The 3D shape of one kind of part on
/// <c>parts.shape.&lt;key&gt;</c>: its model's meshes, each reduced to a few
/// hundred triangles, in the part's own frame. The key is a part row's
/// <see cref="VesselPart.Shape"/>, so a diagram of a craft subscribes once per
/// kind of part it holds rather than once per part. The meshes are those of the
/// part as built, at rest, with the meshes its variant leaves out already gone;
/// <see cref="VesselPart.ShapePoses"/> says where a moving mesh stands now and
/// which meshes a part is not drawing.
///
/// <para>Every mesh keeps its loose pieces apart, so a gap in the real model
/// is a gap in the shape, and an outline drawn from any side follows the
/// model's own. Published while something subscribes to the key's topic, and
/// the same for every craft in the game, so it never changes while the game
/// runs and arrives at once with no signal delay.</para>
/// <internal>
/// Captured by Gonogo.KSP.PartShapeChannels from the part's prefab, a few
/// meshes a frame, and reduced off the main thread by MeshReduction. Sent on
/// its own channel rather than inside vessel.parts so each kind of part costs
/// the wire once per connection, not once per part per tick, and so every
/// craft diagram (active, tracked or a saved file) shares it.
/// </internal>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PartShape
{
    /// <summary><c>AvailablePart.name</c>, the part's config id, as on <see cref="VesselPart.Name"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>The part variant this shape is drawn for, or <c>null</c> for a part with no variants.</summary>
    [SitrepUnit(Units.Text)]
    public string? Variant { get; set; }

    /// <summary>Every mesh of the part's model, in model order. Empty for a part whose model has no mesh.</summary>
    public List<PartShapeMesh> Meshes { get; set; } = new();
}

/// <summary>
/// One mesh of a <see cref="PartShape"/> as a small indexed triangle list in
/// the part's own frame.
///
/// <para>To read the points: decode <see cref="Positions"/> from base64 into
/// unsigned 16-bit little-endian integers, three per point (x, y, z); each
/// value <c>q</c> stands for <c>min + q / 65535 × (max − min)</c> on its axis,
/// with <see cref="Min"/> and <see cref="Max"/>. Decode <see cref="Indices"/>
/// the same way into unsigned 16-bit integers, three per triangle, each an
/// index into those points.</para>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PartShapeMesh
{
    /// <summary>
    /// The mesh's name within its part: the path of transform names from the
    /// part's model down to the mesh, joined by <c>/</c>, with <c>#2</c>,
    /// <c>#3</c> and so on after a name that an earlier sibling already has.
    /// The same mesh on every part of this kind has the same key, and
    /// <see cref="PartShapePose.Mesh"/> names a mesh by it.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Key { get; set; } = "";

    /// <summary>Whether the part as built draws this mesh. A mesh it hides, such as an engine's shroud with nothing mounted below, is still here, so a part that later shows it can draw it.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Shown { get; set; }

    /// <summary>The low corner of the box the points are packed into (metres, part-local).</summary>
    [SitrepUnit(Units.Metres)]
    [SitrepFrame(Frames.PartLocal)]
    public Vec3 Min { get; set; } = new();

    /// <summary>The high corner of the box the points are packed into (metres, part-local). Equal to <see cref="Min"/> on an axis the mesh is flat along.</summary>
    [SitrepUnit(Units.Metres)]
    [SitrepFrame(Frames.PartLocal)]
    public Vec3 Max { get; set; } = new();

    /// <summary>The points, base64 of unsigned 16-bit little-endian integers, three per point, packed into the box from <see cref="Min"/> to <see cref="Max"/>.</summary>
    [SitrepUnit(Units.NotApplicable)]
    public string Positions { get; set; } = "";

    /// <summary>The triangles, base64 of unsigned 16-bit little-endian point indices, three per triangle. Empty for a mesh with no triangles.</summary>
    [SitrepUnit(Units.NotApplicable)]
    public string Indices { get; set; } = "";

    /// <summary>How many triangles the mesh has in the game, before it was reduced for the wire.</summary>
    [SitrepUnit(Units.Count)]
    public int SourceTriangles { get; set; }
}

/// <summary>
/// Where one mesh of a part stands now, when it is not as its
/// <see cref="PartShape"/> has it: a landing leg folded out, a bay door open,
/// a gimballing nozzle turned, or a mesh the part has switched off or on.
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PartShapePose
{
    /// <summary>The mesh, by its <see cref="PartShapeMesh.Key"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string Mesh { get; set; } = "";

    /// <summary>Whether the part draws the mesh now.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Shown { get; set; }

    /// <summary>
    /// The 3 by 4 matrix, row by row (twelve numbers), that carries the
    /// mesh's points from where <see cref="PartShape"/> has them to where they
    /// stand now, both in the part's own frame: a point <c>p</c> moves to
    /// <c>(m0·x + m1·y + m2·z + m3, m4·x + m5·y + m6·z + m7, m8·x + m9·y +
    /// m10·z + m11)</c>. <c>null</c> when the mesh has not moved.
    /// </summary>
    [SitrepUnit(Units.Dimensionless)]
    [SitrepFrame(Frames.PartLocal)]
    public List<double>? Transform { get; set; }
}
