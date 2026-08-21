using System;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The half of the session that needs the game, kept apart so the protocol is
    /// testable without it.
    ///
    /// <para>Finding the plugin handle means finding Principia's addon in the
    /// scene, which means Unity, which is the one dependency the rest of this layer
    /// does not have. Omitting this file (the headless test project does) leaves
    /// the session, the frame and every gate intact and drivable against a double.
    /// That is the same split <c>PrincipiaUplink.Observer.cs</c> makes, and it is
    /// what keeps the part of this worth testing testable.</para>
    /// </summary>
    public sealed partial class PrincipiaSession
    {
        /// <summary>
        /// Binds against the running game, or fails closed with a reason.
        ///
        /// <para>No Principia assembly is referenced; the forwarder and the addon
        /// are both reached by name, so a build with the mod absent is the ordinary
        /// case rather than a special one.</para>
        /// </summary>
        public static bool TryBindLive(out PrincipiaSession? session, out string reason)
        {
            session = null;
            if (!ReflectedPrincipiaPlugin.TryBind(out var plugin, out reason))
            {
                return false;
            }
            return TryBind(plugin!, new AdapterFieldHandle(), out session, out reason);
        }

        /// <summary>
        /// Reads the plugin handle off Principia's addon on every single access.
        ///
        /// <para>The addon instance is cached; the HANDLE never is. Principia
        /// replaces the pointer on deserialise and on a plugin reset, so a cached
        /// copy would be a dangling pointer that still looks like a perfectly
        /// ordinary <c>IntPtr</c>, and the first call made through it would take
        /// the player's game down with no diagnostic at all.</para>
        ///
        /// <para>The field is read rather than the addon's <c>Plugin()</c>
        /// accessor called, on <see cref="ReflectedMembers"/>'s rule: a field read
        /// cannot run the producer's code, and on this producer several
        /// getter-shaped members reach a fatal log.</para>
        /// </summary>
        private sealed class AdapterFieldHandle : IPrincipiaPluginHandle
        {
            private const string AdapterTypeName = "principia.ksp_plugin_adapter.PrincipiaPluginAdapter";
            private const string PluginField = "plugin_";

            private static readonly ReflectedMembers Members = new ReflectedMembers();

            private object? _adapter;

            public IntPtr Current()
            {
                var adapter = Adapter();
                if (adapter == null)
                {
                    return IntPtr.Zero;
                }
                return Members.Value(adapter, PluginField) is IntPtr handle ? handle : IntPtr.Zero;
            }

            /// <summary>
            /// Principia's addon, found once and kept.
            ///
            /// <para>Caching the ADDON is safe where caching the handle is not: it
            /// is a scene object that outlives the plugin resets, and when it does
            /// go away the field read simply misses and answers zero, which the
            /// session treats as "no plugin" rather than as an error.</para>
            /// </summary>
            private object? Adapter()
            {
                if (_adapter != null)
                {
                    return _adapter;
                }
                var adapterType = HarmonyLib.AccessTools.TypeByName(AdapterTypeName);
                if (adapterType == null)
                {
                    return null;
                }
                _adapter = UnityEngine.Object.FindObjectOfType(adapterType);
                return _adapter;
            }
        }
    }
}
