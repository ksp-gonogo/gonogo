using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Reflection.Emit;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Foundation tests for <see cref="UplinkDiscovery"/> — the kOS
    /// <c>AddonManager</c> precedent adapted for Uplinks (see
    /// <see cref="UplinkDiscovery"/>'s own doc comment). Uses the
    /// assembly-set overload (<see cref="UplinkDiscovery.Discover(IEnumerable{System.Reflection.Assembly})"/>)
    /// rather than the AppDomain-wide one so each test controls exactly
    /// which types are visible to the scan.
    /// </summary>
    public class UplinkDiscoveryTests
    {
        private static readonly System.Reflection.Assembly[] ThisAssembly =
            { typeof(UplinkDiscoveryTests).Assembly };

        [Fact]
        public void DiscoversAttributedUplinkWithParameterlessConstructor()
        {
            var found = UplinkDiscovery.Discover(ThisAssembly);

            var match = found.SingleOrDefault(d => d.Uplink.Manifest.Id == "discovery-test-normal");
            Assert.NotEqual(default, match);
            Assert.IsType<NormalDiscoverableUplink>(match.Uplink);
            Assert.Equal(ContractVersion.Major, match.ContractMajor);
            Assert.Equal(ContractVersion.Minor, match.ContractMinor);
        }

        [Fact]
        public void SkipsTypeWithNoSitrepUplinkAttribute()
        {
            var found = UplinkDiscovery.Discover(ThisAssembly);

            Assert.DoesNotContain(found, d => d.Uplink is UnattributedUplink);
        }

        [Fact]
        public void SkipsTypeWithNoParameterlessConstructorWithoutThrowing()
        {
            // NoParameterlessCtorUplink carries [SitrepUplink] but only a
            // one-arg constructor — discovery must skip it (log + continue),
            // never throw, and every OTHER attributed type in the same scan
            // must still be found.
            var found = UplinkDiscovery.Discover(ThisAssembly);

            Assert.DoesNotContain(found, d => d.Uplink is NoParameterlessCtorUplink);
            Assert.Contains(found, d => d.Uplink.Manifest.Id == "discovery-test-normal");
        }

        [Fact]
        public void SkipsConstructorThatThrowsWithoutThrowing()
        {
            // ThrowingCtorUplink's constructor throws -- discovery must
            // catch it, skip that one Uplink, and keep scanning/returning
            // every other attributed type in the same assembly (the
            // per-Uplink fail-soft applies even at DISCOVERY time, before
            // ChannelEngine.RegisterUplink ever gets a chance to fail-soft
            // its Register() call).
            var found = UplinkDiscovery.Discover(ThisAssembly);

            Assert.DoesNotContain(found, d => d.Uplink is ThrowingCtorUplink);
            Assert.Contains(found, d => d.Uplink.Manifest.Id == "discovery-test-normal");
        }

        [Fact]
        public void SurvivesTypeWhoseAttributeResolutionThrowsWithoutAbortingTheWholeScan()
        {
            // Builds, at runtime, a type carrying [SitrepUplink] applied
            // TWICE -- SitrepUplinkAttribute is AllowMultiple = false, so
            // the compiler would reject a second [SitrepUplink(...)]
            // outright, but Reflection.Emit's SetCustomAttribute has no such
            // check, so two records land in the type's metadata anyway.
            // type.GetCustomAttribute<SitrepUplinkAttribute>() -- exactly
            // the call discovery itself makes -- throws
            // AmbiguousMatchException for a non-AllowMultiple attribute with
            // >1 match. This reproduces, with no compiled/static dependency
            // on any unloadable assembly, the general shape
            // foundation-review finding #5 named: "a candidate type carries
            // some OTHER attribute [...] whose [resolution] can throw" — the
            // fix must make GetCustomAttribute's throw here skip only THIS
            // type (log + continue), not abort the whole scan. Asserted by
            // requiring NormalDiscoverableUplink still comes back in the
            // same scan.
            var crashyType = BuildTypeWithDuplicatedSitrepUplinkAttribute();
            var assemblies = ThisAssembly.Append(crashyType.Assembly).ToArray();

            var found = UplinkDiscovery.Discover(assemblies);

            Assert.DoesNotContain(found, d => d.Uplink.GetType() == crashyType);
            Assert.Contains(found, d => d.Uplink.Manifest.Id == "discovery-test-normal");
        }

        /// <summary>See <see cref="SurvivesTypeWhoseAttributeResolutionThrowsWithoutAbortingTheWholeScan"/>.</summary>
        private static Type BuildTypeWithDuplicatedSitrepUplinkAttribute()
        {
            var targetAsmName = new AssemblyName("CrashyUplinkAsm_" + Guid.NewGuid());
            var targetAsmBuilder = AssemblyBuilder.DefineDynamicAssembly(targetAsmName, AssemblyBuilderAccess.Run);
            var targetModule = targetAsmBuilder.DefineDynamicModule("CrashyUplinkModule");
            var typeBuilder = targetModule.DefineType(
                "CrashyEmittedUplink",
                TypeAttributes.Public | TypeAttributes.Class,
                typeof(object),
                new[] { typeof(ISitrepUplink) });

            // [SitrepUplink("discovery-test-crashy-attribute")] applied
            // TWICE -- see this method's caller for why that's legal via
            // Reflection.Emit even though AllowMultiple = false.
            var sitrepUplinkCtor = typeof(SitrepUplinkAttribute).GetConstructor(new[] { typeof(string), typeof(int), typeof(int) })!;
            var attributeBuilder = new CustomAttributeBuilder(
                sitrepUplinkCtor,
                new object[] { "discovery-test-crashy-attribute", ContractVersion.Major, ContractVersion.Minor });
            typeBuilder.SetCustomAttribute(attributeBuilder);
            typeBuilder.SetCustomAttribute(attributeBuilder);

            // Manifest { Id = ... } get-only property backed by a field set in a default ctor.
            var manifestField = typeBuilder.DefineField("_manifest", typeof(UplinkManifest), FieldAttributes.Private);
            var ctorBuilder = typeBuilder.DefineConstructor(MethodAttributes.Public, CallingConventions.Standard, Type.EmptyTypes);
            var ctorIl = ctorBuilder.GetILGenerator();
            var objectCtor = typeof(object).GetConstructor(Type.EmptyTypes)!;
            var manifestCtor = typeof(UplinkManifest).GetConstructor(Type.EmptyTypes)!;
            var idSetter = typeof(UplinkManifest).GetProperty(nameof(UplinkManifest.Id))!.SetMethod!;
            ctorIl.Emit(OpCodes.Ldarg_0);
            ctorIl.Emit(OpCodes.Call, objectCtor);
            ctorIl.Emit(OpCodes.Ldarg_0);
            ctorIl.Emit(OpCodes.Newobj, manifestCtor);
            ctorIl.Emit(OpCodes.Dup);
            ctorIl.Emit(OpCodes.Ldstr, "discovery-test-crashy-attribute");
            ctorIl.Emit(OpCodes.Callvirt, idSetter);
            ctorIl.Emit(OpCodes.Stfld, manifestField);
            ctorIl.Emit(OpCodes.Ret);

            var manifestGetter = typeof(ISitrepUplink).GetProperty(nameof(ISitrepUplink.Manifest))!.GetMethod!;
            var manifestProp = typeBuilder.DefineProperty(nameof(ISitrepUplink.Manifest), PropertyAttributes.None, typeof(UplinkManifest), null);
            var manifestGetterImpl = typeBuilder.DefineMethod(
                "get_Manifest",
                MethodAttributes.Public | MethodAttributes.Virtual | MethodAttributes.SpecialName | MethodAttributes.Final,
                typeof(UplinkManifest),
                Type.EmptyTypes);
            var getterIl = manifestGetterImpl.GetILGenerator();
            getterIl.Emit(OpCodes.Ldarg_0);
            getterIl.Emit(OpCodes.Ldfld, manifestField);
            getterIl.Emit(OpCodes.Ret);
            manifestProp.SetGetMethod(manifestGetterImpl);
            typeBuilder.DefineMethodOverride(manifestGetterImpl, manifestGetter);

            var registerIface = typeof(ISitrepUplink).GetMethod(nameof(ISitrepUplink.Register))!;
            var registerImpl = typeBuilder.DefineMethod(
                "Register",
                MethodAttributes.Public | MethodAttributes.Virtual | MethodAttributes.Final,
                typeof(void),
                new[] { typeof(IUplinkHost) });
            var registerIl = registerImpl.GetILGenerator();
            registerIl.Emit(OpCodes.Ret);
            typeBuilder.DefineMethodOverride(registerImpl, registerIface);

            // Health() is now a mandatory ISitrepUplink member, so the emitted type
            // must implement it or CreateType() fails. Return the trivial floor
            // (UplinkHealth.Healthy) — this type is never actually registered (the
            // duplicated-attribute resolution throws first), it just has to be a
            // valid ISitrepUplink to load.
            var healthIface = typeof(ISitrepUplink).GetMethod(nameof(ISitrepUplink.Health))!;
            var healthImpl = typeBuilder.DefineMethod(
                "Health",
                MethodAttributes.Public | MethodAttributes.Virtual | MethodAttributes.Final,
                typeof(UplinkHealth),
                Type.EmptyTypes);
            var healthIl = healthImpl.GetILGenerator();
            healthIl.Emit(OpCodes.Ldsfld, typeof(UplinkHealth).GetField(nameof(UplinkHealth.Healthy))!);
            healthIl.Emit(OpCodes.Ret);
            typeBuilder.DefineMethodOverride(healthImpl, healthIface);

            return typeBuilder.CreateType()!;
        }

        [Fact]
        public void ExplicitContractVersionOverrideIsHonored()
        {
            // StaleContractUplink declares an explicit OLD contract version
            // via its [SitrepUplink] attribute arguments -- simulating a
            // binary compiled against an earlier ContractVersion.Major that
            // was never recompiled (see SitrepUplinkAttribute's doc comment
            // on why the default-parameter mechanism captures this for real
            // stale binaries; this test exercises the explicit-override path
            // directly rather than needing an actual old assembly on disk).
            var found = UplinkDiscovery.Discover(ThisAssembly);

            var stale = found.Single(d => d.Uplink.Manifest.Id == "discovery-test-stale");
            Assert.Equal(0, stale.ContractMajor);
            Assert.Equal(9, stale.ContractMinor);
        }

        [Fact]
        public void RegisterDiscoveredUplinkFailsSoftOnMajorMismatchWithoutCallingRegister()
        {
            // RegisterUplink/RegisterDiscoveredUplink must run BEFORE
            // Start() (see ChannelEngine.RegisterUplink's own doc comment),
            // so this engine is deliberately never started — Dispose() on an
            // unstarted engine would otherwise throw ThreadStateException
            // trying to Join a Thread that was never Start()ed, unrelated to
            // what this test actually exercises. No Stop()/Dispose() needed:
            // an unstarted engine holds no thread/socket to release.
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new NormalDiscoverableUplink();

            engine.RegisterDiscoveredUplink(uplink, contractMajor: ContractVersion.Major + 1, contractMinor: 0);

            Assert.False(uplink.RegisterWasCalled);
            var availability = engine.AvailabilityOf(uplink.Manifest.Id);
            Assert.False(availability.IsAvailable);
            Assert.Contains("major mismatch", availability.Reason);
        }

        [Fact]
        public void RegisterDiscoveredUplinkSucceedsOnMatchingMajor()
        {
            // See the no-Start()/no-Dispose() rationale in the sibling test above.
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new NormalDiscoverableUplink();

            engine.RegisterDiscoveredUplink(uplink, contractMajor: ContractVersion.Major, contractMinor: ContractVersion.Minor + 5);

            Assert.True(uplink.RegisterWasCalled);
            Assert.True(engine.AvailabilityOf(uplink.Manifest.Id).IsAvailable);
        }

        // ---- fixtures ----------------------------------------------------

        [SitrepUplink("discovery-test-normal")]
        public sealed class NormalDiscoverableUplink : ISitrepUplink
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public bool RegisterWasCalled { get; private set; }

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "discovery-test-normal",
                Version = "1.0.0",
                Channels = Array.Empty<ChannelDeclaration>(),
                Commands = Array.Empty<CommandDeclaration>(),
            };

            public void Register(IUplinkHost host) => RegisterWasCalled = true;
        }

        public sealed class UnattributedUplink : ISitrepUplink
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "discovery-test-unattributed" };
            public void Register(IUplinkHost host) { }
        }

        [SitrepUplink("discovery-test-no-parameterless-ctor")]
        public sealed class NoParameterlessCtorUplink : ISitrepUplink
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public NoParameterlessCtorUplink(string _) { }
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "discovery-test-no-parameterless-ctor" };
            public void Register(IUplinkHost host) { }
        }

        [SitrepUplink("discovery-test-throwing-ctor")]
        public sealed class ThrowingCtorUplink : ISitrepUplink
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public ThrowingCtorUplink() => throw new InvalidOperationException("boom");
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "discovery-test-throwing-ctor" };
            public void Register(IUplinkHost host) { }
        }

        [SitrepUplink("discovery-test-stale", contractMajor: 0, contractMinor: 9)]
        public sealed class StaleContractUplink : ISitrepUplink
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "discovery-test-stale" };
            public void Register(IUplinkHost host) { }
        }

    }
}
