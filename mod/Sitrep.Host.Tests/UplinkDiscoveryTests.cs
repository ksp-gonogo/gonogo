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
    /// Foundation tests for <see cref="UplinkDiscovery"/>: the kOS
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

            var match = found.SingleOrDefault(d => d.Uplink?.Manifest.Id == "discovery-test-normal");
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
            // one-arg constructor: discovery must skip it (log + continue),
            // never throw, and every OTHER attributed type in the same scan
            // must still be found.
            var found = UplinkDiscovery.Discover(ThisAssembly);

            Assert.DoesNotContain(found, d => d.Uplink is NoParameterlessCtorUplink);
            Assert.Contains(found, d => d.Uplink?.Manifest.Id == "discovery-test-normal");
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
            Assert.Contains(found, d => d.Uplink?.Manifest.Id == "discovery-test-normal");
        }

        /// <summary>
        /// Both rejection paths reach the caller's sink, naming the offending
        /// type. GonogoAddon passes UnityEngine.Debug.LogWarning here; before
        /// the sink existed these lines went only to Console.Error, which KSP
        /// does not capture, so an Uplink the scan refused was invisible and
        /// an author's only evidence was a subscribe that never answered.
        /// </summary>
        [Fact]
        public void ReportsEveryRejectionToTheDiagnosticSink()
        {
            var lines = new List<string>();

            UplinkDiscovery.Discover(ThisAssembly, lines.Add);

            Assert.Contains(lines, l => l.Contains(nameof(NoParameterlessCtorUplink)) && l.Contains("parameterless constructor"));
            Assert.Contains(lines, l => l.Contains(nameof(ThrowingCtorUplink)));
        }

        /// <summary>
        /// An assembly that loads only some of its types can have lost the Uplink
        /// itself, which then has no other trace: the scan names the assembly and
        /// every reason a type failed, and still keeps the types that loaded.
        /// </summary>
        [Fact]
        public void APartlyLoadedAssemblyIsReportedWithItsLoaderExceptions()
        {
            var lines = new List<string>();
            var partial = new PartlyLoadedAssembly(
                new[] { typeof(NormalDiscoverableUplink), null },
                new Exception?[] { new TypeLoadException("Method 'Health' does not have an implementation."), null });

            var found = UplinkDiscovery.Discover(new System.Reflection.Assembly[] { partial }, lines.Add);

            Assert.Contains(found, d => d.Uplink?.Manifest.Id == "discovery-test-normal");
            var line = Assert.Single(lines, l => l.Contains(PartlyLoadedAssembly.Name));
            Assert.Contains("Method 'Health' does not have an implementation.", line);
        }

        private sealed class PartlyLoadedAssembly : System.Reflection.Assembly
        {
            public const string Name = "PartlyLoadedUplinks, Version=1.0.0.0";

            private readonly Type?[] _types;
            private readonly Exception?[] _reasons;

            public PartlyLoadedAssembly(Type?[] types, Exception?[] reasons)
            {
                _types = types;
                _reasons = reasons;
            }

            public override string FullName => Name;

            public override AssemblyName GetName() => new AssemblyName(Name);

            public override AssemblyName[] GetReferencedAssemblies() =>
                new[] { typeof(ISitrepUplink).Assembly.GetName() };

            public override Type[] GetTypes() => throw new ReflectionTypeLoadException(_types, _reasons);
        }

        /// <summary>
        /// A registered Uplink says so through the engine's diagnostic sink, with its
        /// id and version, so a load that worked is as visible in KSP.log as one that
        /// was refused.
        /// </summary>
        [Fact]
        public void LogsOneLinePerLoadedUplinkWithItsIdAndVersion()
        {
            var lines = new List<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.SetDiagnosticLog(lines.Add);
            var uplink = new LoadedLineUplink();

            engine.RegisterDiscoveredUplinks(new List<UplinkDiscovery.DiscoveredUplink>
            {
                new UplinkDiscovery.DiscoveredUplink(uplink, ContractVersion.Major, ContractVersion.Minor),
            });

            engine.Start();
            try
            {
                Assert.Single(lines, l => l.Contains("\"discovery-test-loaded-line\" 4.5.6 loaded"));
            }
            finally
            {
                engine.Stop();
            }
        }

        public sealed class LoadedLineUplink : ISitrepUplink
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } =
                new UplinkManifest { Id = "discovery-test-loaded-line", Version = "4.5.6" };
            public void Register(IUplinkHost host) { }
        }

        /// <summary>A caller whose sink throws still gets a complete scan: reporting a failure must never become one.</summary>
        [Fact]
        public void SurvivesADiagnosticSinkThatThrows()
        {
            var found = UplinkDiscovery.Discover(
                ThisAssembly,
                _ => throw new InvalidOperationException("broken sink"));

            Assert.Contains(found, d => d.Uplink?.Manifest.Id == "discovery-test-normal");
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
            // some OTHER attribute [...] whose [resolution] can throw", the
            // fix must make GetCustomAttribute's throw here skip only THIS
            // type (log + continue), not abort the whole scan. Asserted by
            // requiring NormalDiscoverableUplink still comes back in the
            // same scan.
            var crashyType = BuildTypeWithDuplicatedSitrepUplinkAttribute();
            var assemblies = ThisAssembly.Append(crashyType.Assembly).ToArray();

            var found = UplinkDiscovery.Discover(assemblies);

            Assert.DoesNotContain(found, d => d.Uplink?.GetType() == crashyType);
            Assert.Contains(found, d => d.Uplink?.Manifest.Id == "discovery-test-normal");
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
            // (UplinkHealth.Healthy): this type is never actually registered (the
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

            var stale = found.Single(d => d.Id == "discovery-test-stale");
            Assert.Equal(0, stale.ContractMajor);
            Assert.Equal(9, stale.ContractMinor);
        }

        /// <summary>
        /// The version check refuses an Uplink built for another major or a newer
        /// minor, so its constructor, with whatever static set-up and event hooks it
        /// carries, must not run inside this core at all.
        /// </summary>
        [Fact]
        public void AnUplinkThisCoreRefusesIsNeverConstructed()
        {
            StaleContractUplink.Constructed = 0;
            NewerMinorUplink.Constructed = 0;

            var found = UplinkDiscovery.Discover(ThisAssembly);

            Assert.Null(found.Single(d => d.Id == "discovery-test-stale").Uplink);
            Assert.Null(found.Single(d => d.Id == "discovery-test-newer-minor").Uplink);
            Assert.Equal(0, StaleContractUplink.Constructed);
            Assert.Equal(0, NewerMinorUplink.Constructed);
        }

        [Fact]
        public void AnUplinkBuiltAgainstANewerMinorIsRefusedWithBothVersions()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");

            engine.RegisterDiscoveredUplinks(UplinkDiscovery.Discover(ThisAssembly));

            var availability = engine.AvailabilityOf("discovery-test-newer-minor");
            Assert.False(availability.IsAvailable);
            Assert.Contains("newer minor", availability.Reason);
            Assert.Contains($"v{ContractVersion.Major}.{ContractVersion.Minor + 1}", availability.Reason);
        }

        [Fact]
        public void AnUplinkBuiltAgainstAnOlderOrTheSameMinorLoads()
        {
            Assert.Null(ChannelEngine.ContractRefusalReason(ContractVersion.Major, ContractVersion.Minor));
            Assert.Null(ChannelEngine.ContractRefusalReason(ContractVersion.Major, 0));
            Assert.NotNull(ChannelEngine.ContractRefusalReason(ContractVersion.Major, ContractVersion.Minor + 1));
            Assert.NotNull(ChannelEngine.ContractRefusalReason(ContractVersion.Major + 1, 0));
        }

        [Fact]
        public void RegisterDiscoveredUplinkFailsSoftOnMajorMismatchWithoutCallingRegister()
        {
            // RegisterUplink/RegisterDiscoveredUplink must run BEFORE
            // Start() (see ChannelEngine.RegisterUplink's own doc comment),
            // so this engine is deliberately never started, Dispose() on an
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
        public void RegisterDiscoveredUplinkSucceedsOnMatchingMajorAndAnOlderMinor()
        {
            // See the no-Start()/no-Dispose() rationale in the sibling test above.
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new NormalDiscoverableUplink();

            engine.RegisterDiscoveredUplink(uplink, contractMajor: ContractVersion.Major, contractMinor: 0);

            Assert.True(uplink.RegisterWasCalled);
            Assert.True(engine.AvailabilityOf(uplink.Manifest.Id).IsAvailable);
        }

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
            public static int Constructed;

            public StaleContractUplink() => Constructed++;

            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "discovery-test-stale" };
            public void Register(IUplinkHost host) { }
        }


        [SitrepUplink("discovery-test-newer-minor", contractMajor: ContractVersion.Major, contractMinor: ContractVersion.Minor + 1)]
        public sealed class NewerMinorUplink : ISitrepUplink
        {
            public static int Constructed;

            public NewerMinorUplink() => Constructed++;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "discovery-test-newer-minor" };
            public void Register(IUplinkHost host) { }
        }
    }
}
