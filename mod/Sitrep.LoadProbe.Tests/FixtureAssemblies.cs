using System;
using System.IO;
using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.Loader;

namespace Sitrep.LoadProbe.Tests
{
    /// <summary>
    /// Writes the smallest reproduction of a stale Uplink to disk: two builds of
    /// one contract assembly with the same name and version, and a plugin
    /// compiled against the first. Version 1 declares <c>Backend.Repair()</c>;
    /// version 2 changes it to <c>Repair(object)</c>, so the plugin's override
    /// no longer implements the abstract member once version 2 sits beside it.
    /// </summary>
    internal sealed class FixtureAssemblies : IDisposable
    {
        public const string ContractName = "Fixture.Contract";
        public const string PluginName = "Fixture.Plugin";

        public string Root { get; }
        public string ContractV1Dir { get; }
        public string ContractV2Dir { get; }
        public string PluginDir { get; }
        public string PluginPath => Path.Combine(PluginDir, PluginName + ".dll");

        public FixtureAssemblies()
        {
            Root = Path.Combine(Path.GetTempPath(), "sitrep-load-probe-" + Guid.NewGuid().ToString("N"));
            ContractV1Dir = Directory.CreateDirectory(Path.Combine(Root, "v1", "Plugins")).FullName;
            ContractV2Dir = Directory.CreateDirectory(Path.Combine(Root, "v2", "Plugins")).FullName;
            PluginDir = Directory.CreateDirectory(Path.Combine(Root, "plugin", "Plugins")).FullName;

            var v1 = Path.Combine(ContractV1Dir, ContractName + ".dll");
            WriteContract(v1, Type.EmptyTypes);
            WriteContract(Path.Combine(ContractV2Dir, ContractName + ".dll"), new[] { typeof(object) });
            WritePlugin(v1, PluginPath);
        }

        private static void WriteContract(string path, Type[] repairParameters)
        {
            var builder = new PersistedAssemblyBuilder(new AssemblyName(ContractName) { Version = new Version(1, 0, 0, 0) }, typeof(object).Assembly);
            var module = builder.DefineDynamicModule(ContractName);
            var backend = module.DefineType("Fixture.Backend", TypeAttributes.Public | TypeAttributes.Abstract | TypeAttributes.Class);
            backend.DefineDefaultConstructor(MethodAttributes.Family);
            backend.DefineMethod(
                "Repair",
                MethodAttributes.Public | MethodAttributes.Abstract | MethodAttributes.Virtual | MethodAttributes.HideBySig | MethodAttributes.NewSlot,
                typeof(void),
                repairParameters);
            backend.CreateType();
            builder.Save(path);
        }

        private static void WritePlugin(string contractPath, string path)
        {
            var context = new AssemblyLoadContext("fixture-contract", isCollectible: true);
            try
            {
                var backend = context.LoadFromAssemblyPath(contractPath).GetType("Fixture.Backend", throwOnError: true)!;
                var builder = new PersistedAssemblyBuilder(new AssemblyName(PluginName), typeof(object).Assembly);
                var module = builder.DefineDynamicModule(PluginName);
                var plugin = module.DefineType("Fixture.PluginBackend", TypeAttributes.Public | TypeAttributes.Class, backend);

                var baseCtor = backend.GetConstructor(BindingFlags.Instance | BindingFlags.NonPublic, Type.EmptyTypes)!;
                var ctor = plugin.DefineConstructor(MethodAttributes.Public, CallingConventions.Standard, Type.EmptyTypes);
                var ctorIl = ctor.GetILGenerator();
                ctorIl.Emit(OpCodes.Ldarg_0);
                ctorIl.Emit(OpCodes.Call, baseCtor);
                ctorIl.Emit(OpCodes.Ret);

                var repair = plugin.DefineMethod(
                    "Repair",
                    MethodAttributes.Public | MethodAttributes.Virtual | MethodAttributes.HideBySig,
                    typeof(void),
                    Type.EmptyTypes);
                repair.GetILGenerator().Emit(OpCodes.Ret);

                plugin.CreateType();
                builder.Save(path);
            }
            finally
            {
                context.Unload();
            }
        }

        public void Dispose()
        {
            try
            {
                Directory.Delete(Root, recursive: true);
            }
            catch (IOException)
            {
            }
        }
    }
}
