using System;
using System.Reflection;
using System.Reflection.Emit;

namespace GonogoKerbcastUplink.Tests;

/// <summary>
/// Builds, at runtime via <c>Reflection.Emit</c>, a minimal
/// <c>Kerbcast.KerbcastControl</c>/<c>Kerbcast.KerbcastCameraView</c> pair
/// shaped like a PRE-<c>SidecarAlive</c> kerbcast build: everything
/// <see cref="Gonogo.KerbcastUplink.KerbcastReflection"/> requires for
/// <c>IsAvailable</c> (<c>IsActive</c>, <c>CamerasFor</c>,
/// <c>KerbcastCameraView.FlightId</c>) is present, but the
/// <c>SidecarAlive</c> property itself is not.
///
/// <para>A second same-named <c>Kerbcast.KerbcastControl</c> type can't just
/// be added to <see cref="KerbcastReflectionTests"/>'s existing stand-in
/// (<c>KerbcastStandIns.cs</c>): C# forbids two types sharing one full name
/// in the same assembly, and <c>KerbcastReflection.ForAssembly</c> resolves
/// by that exact literal full name. Building a genuinely separate, in-memory
/// assembly is the same technique <c>Sitrep.Host.Tests</c>'s
/// <c>UplinkDiscoveryTests</c> uses for its own runtime-shaped fixture
/// types.</para>
/// </summary>
internal static class LegacyKerbcastAssemblyBuilder
{
    public static Assembly BuildWithoutSidecarAlive()
    {
        var assemblyName = new AssemblyName("LegacyKerbcastAsm_" + Guid.NewGuid());
        var assemblyBuilder = AssemblyBuilder.DefineDynamicAssembly(assemblyName, AssemblyBuilderAccess.Run);
        var module = assemblyBuilder.DefineDynamicModule("LegacyKerbcastModule");

        // "static class KerbcastControl" == a sealed abstract class carrying
        // only static members, the same shape the C# compiler itself emits
        // for a static class.
        var controlType = module.DefineType(
            "Kerbcast.KerbcastControl",
            TypeAttributes.Public | TypeAttributes.Class | TypeAttributes.Abstract | TypeAttributes.Sealed);

        // static bool IsActive => true;
        var isActiveGetter = controlType.DefineMethod(
            "get_IsActive",
            MethodAttributes.Public | MethodAttributes.Static | MethodAttributes.SpecialName,
            typeof(bool), Type.EmptyTypes);
        var isActiveIl = isActiveGetter.GetILGenerator();
        isActiveIl.Emit(OpCodes.Ldc_I4_1);
        isActiveIl.Emit(OpCodes.Ret);
        var isActiveProperty = controlType.DefineProperty(
            "IsActive", PropertyAttributes.None, typeof(bool), Type.EmptyTypes);
        isActiveProperty.SetGetMethod(isActiveGetter);

        // static object? CamerasFor(object vessel) => null;
        // (Content is irrelevant to this fixture: KerbcastReflection only
        // needs the method to RESOLVE by name+arity for IsAvailable to hold;
        // no test here calls CamerasFor.)
        var camerasForMethod = controlType.DefineMethod(
            "CamerasFor",
            MethodAttributes.Public | MethodAttributes.Static,
            typeof(object), new[] { typeof(object) });
        var camerasForIl = camerasForMethod.GetILGenerator();
        camerasForIl.Emit(OpCodes.Ldnull);
        camerasForIl.Emit(OpCodes.Ret);

        // Deliberately NO SidecarAlive property: that absence is this
        // fixture's whole point.
        controlType.CreateType();

        // class KerbcastCameraView { public uint FlightId; }
        // FlightId is the one field KerbcastReflection's IsAvailable gate
        // requires; the rest are optional per-field reads this fixture
        // doesn't need to carry.
        var viewType = module.DefineType("Kerbcast.KerbcastCameraView", TypeAttributes.Public | TypeAttributes.Class);
        viewType.DefineField("FlightId", typeof(uint), FieldAttributes.Public);
        viewType.CreateType();

        return module.Assembly;
    }
}
