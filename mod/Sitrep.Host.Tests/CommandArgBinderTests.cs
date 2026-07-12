using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for <see cref="ChannelEngine.BindCommandArgs"/> — the generic
    /// wire-args → typed-<c>TArgs</c> binder that closes the confirmed live bug
    /// where the ENTIRE command/write path was dead over the real WebSocket:
    /// <c>EnvelopeCodec</c> deserializes a command's args to a GENERIC shape
    /// (<c>Dictionary&lt;string, object?&gt;</c> / <c>double</c> / <c>bool</c> /
    /// <c>string</c>), and the old <c>(TArgs)args!</c> cast threw
    /// <c>InvalidCastException</c> ("Specified cast is not valid") for every
    /// command taking a typed args record. The existing
    /// <c>VesselCommandProviderTests</c> never caught this because they invoke
    /// handlers with an ALREADY-typed <c>TArgs</c> in-process — they never
    /// exercise the wire-deserialize → dispatch path. These tests feed the exact
    /// generic shape the wire produces and assert the handler would receive the
    /// correctly-typed args.
    ///
    /// <para>Every case here FAILED before the binder (the raw cast threw): a
    /// <c>Dictionary&lt;string, object?&gt;</c> is not a <see cref="SetEnabledArgs"/>,
    /// a boxed <c>double</c> is not a <see cref="SasMode"/>, etc.</para>
    /// </summary>
    public class CommandArgBinderTests
    {
        private static TArgs Bind<TArgs>(object? wire) =>
            (TArgs)ChannelEngine.BindCommandArgs(wire, typeof(TArgs))!;

        // ---- plain scalar-in-object-bag args (case 4) ----

        [Fact]
        public void BindsBoolPropertyFromWireDictionary()
        {
            var args = Bind<SetEnabledArgs>(new Dictionary<string, object?> { ["enabled"] = true });
            Assert.True(args.Enabled);
        }

        [Fact]
        public void BindsDoublePropertyFromWireDictionary()
        {
            var args = Bind<SetThrottleArgs>(new Dictionary<string, object?> { ["value"] = 0.5 });
            Assert.Equal(0.5, args.Value);
        }

        [Fact]
        public void BindsIntAndBoolPropertiesFromWireDictionary()
        {
            // Wire numbers arrive as double — the int Group must narrow.
            var args = Bind<SetActionGroupArgs>(new Dictionary<string, object?>
            {
                ["group"] = 3.0,
                ["state"] = true,
            });
            Assert.Equal(3, args.Group);
            Assert.True(args.State);
        }

        [Fact]
        public void BindsMultipleDoublePropertiesUnscrambled()
        {
            var args = Bind<AddManeuverNodeArgs>(new Dictionary<string, object?>
            {
                ["ut"] = 12345.0,
                ["prograde"] = 100.0,
                ["normal"] = 20.0,
                ["radialOut"] = 3.0,
            });
            Assert.Equal(12345.0, args.Ut);
            Assert.Equal(100.0, args.Prograde);
            Assert.Equal(20.0, args.Normal);
            Assert.Equal(3.0, args.RadialOut);
        }

        [Fact]
        public void BindsStringPropertyFromWireDictionary()
        {
            var args = Bind<RemoveManeuverNodeArgs>(new Dictionary<string, object?> { ["nodeId"] = "node-7" });
            Assert.Equal("node-7", args.NodeId);
        }

        [Fact]
        public void BindsStringListFromWireArray()
        {
            // Wire arrays arrive as List<object?> of boxed strings — the binder
            // must materialise the declared List<string>. LaunchArgs.Crew is the
            // first command-arg list; without list support a populated crew
            // array would throw at bind time and dead-soft the whole launch.
            var args = Bind<LaunchArgs>(new Dictionary<string, object?>
            {
                ["shipName"] = "Kerbal X",
                ["facility"] = "VAB",
                ["site"] = "LaunchPad",
                ["crew"] = new List<object?> { "Jebediah Kerman", "Bill Kerman" },
            });
            Assert.Equal("Kerbal X", args.ShipName);
            Assert.Equal("VAB", args.Facility);
            Assert.Equal("LaunchPad", args.Site);
            Assert.Equal(new[] { "Jebediah Kerman", "Bill Kerman" }, args.Crew);
        }

        [Fact]
        public void BindsAnEmptyCrewListWhenTheWireArrayIsAbsent()
        {
            // Unmanned launch: the crew key never arrives, so the property stays
            // at its default-constructed empty list rather than throwing.
            var args = Bind<LaunchArgs>(new Dictionary<string, object?>
            {
                ["shipName"] = "Kerbal X",
                ["facility"] = "SPH",
            });
            Assert.NotNull(args.Crew);
            Assert.Empty(args.Crew);
        }

        // ---- case 1: numeric ordinal -> enum (client sends the number) ----

        [Fact]
        public void BindsEnumFromNumericOrdinal_NonZeroSoASilentDefaultWouldFail()
        {
            // 1 == SasMode.Prograde. A binder that silently defaulted the enum
            // to 0 (StabilityAssist) would fail this assertion.
            var args = Bind<SetSasModeArgs>(new Dictionary<string, object?> { ["mode"] = 1.0 });
            Assert.Equal(SasMode.Prograde, args.Mode);
        }

        [Fact]
        public void BindsEnumFromStringNameCaseInsensitively()
        {
            var args = Bind<SetSasModeArgs>(new Dictionary<string, object?> { ["mode"] = "retrograde" });
            Assert.Equal(SasMode.Retrograde, args.Mode);
        }

        // ---- case 2: nullable discriminated-union fields ----

        [Fact]
        public void BindsBodyKindUnion_LeavesAbsentVesselIdNull()
        {
            // kind == 1 (TargetKind.Body) as a numeric ordinal; only bodyIndex present.
            var args = Bind<SetTargetArgs>(new Dictionary<string, object?>
            {
                ["kind"] = 1.0,
                ["bodyIndex"] = 2.0,
            });
            Assert.Equal(TargetKind.Body, args.Kind);
            Assert.Equal(2, args.BodyIndex);
            Assert.Null(args.VesselId);
        }

        [Fact]
        public void BindsVesselKindUnion_LeavesAbsentBodyIndexNull()
        {
            var args = Bind<SetTargetArgs>(new Dictionary<string, object?>
            {
                ["kind"] = "Vessel",
                ["vesselId"] = "guid-1",
            });
            Assert.Equal(TargetKind.Vessel, args.Kind);
            Assert.Equal("guid-1", args.VesselId);
            Assert.Null(args.BodyIndex);
        }

        // ---- case 3: null / absent arg bag ----

        [Fact]
        public void NullWireArgsBindsToNullForObjectHandler()
        {
            // vessel.control.stage / vessel.target.clear register as object? and
            // receive null args — must tolerate null, not throw.
            Assert.Null(ChannelEngine.BindCommandArgs(null, typeof(object)));
        }

        [Fact]
        public void EmptyWireDictionaryBindsToADefaultRecord()
        {
            var args = Bind<SetEnabledArgs>(new Dictionary<string, object?>());
            Assert.False(args.Enabled);
        }

        // ---- passthrough & rejection ----

        [Fact]
        public void AlreadyTypedArgsPassStraightThroughWithoutReflection()
        {
            var typed = new SetEnabledArgs { Enabled = true };
            var args = Bind<SetEnabledArgs>(typed);
            Assert.Same(typed, args);
        }

        [Fact]
        public void GenuinelyUnconvertibleValueThrows_SoInvokeCommandHandlerCanFailSoft()
        {
            // A number against a string handler (the CrashyCommandTestUplink
            // shape) and an object bag against a scalar (the
            // ScalarArgCommandTestUplink shape) must still throw — the engine's
            // fail-soft depends on that.
            Assert.ThrowsAny<Exception>(() => ChannelEngine.BindCommandArgs(5.0, typeof(string)));
            Assert.ThrowsAny<Exception>(() =>
                ChannelEngine.BindCommandArgs(new Dictionary<string, object?> { ["x"] = 1.0 }, typeof(double)));
        }

        /// <summary>
        /// Reflection guard mirroring <c>WirePayloadCoverageTests</c> on the
        /// INBOUND side: every <see cref="SitrepContractAttribute"/>-marked
        /// command-arg record (name ends in <c>Args</c>) must be bindable from
        /// the generic wire shape its properties would arrive as. A new command
        /// arg type with a property shape the binder can't handle is therefore a
        /// RED test, not a silent dead command over the real socket.
        /// </summary>
        [Fact]
        public void EveryContractCommandArgTypeIsBindableFromItsWireShape()
        {
            var argTypes = typeof(SetEnabledArgs).Assembly.GetTypes()
                .Where(t => t.IsClass && !t.IsAbstract && t.Name.EndsWith("Args", StringComparison.Ordinal))
                .Where(t => t.IsDefined(typeof(SitrepContractAttribute), false))
                .Where(t => t.GetConstructor(Type.EmptyTypes) != null)
                .ToList();

            Assert.NotEmpty(argTypes);

            var failures = new List<string>();
            foreach (var t in argTypes)
            {
                try
                {
                    var wire = SynthesizeWireShape(t);
                    var bound = ChannelEngine.BindCommandArgs(wire, t);
                    Assert.NotNull(bound);
                    Assert.IsType(t, bound);
                }
                catch (Exception ex)
                {
                    failures.Add($"{t.Name}: {ex.GetType().Name} {ex.Message}");
                }
            }

            Assert.True(failures.Count == 0,
                "These [SitrepContract] command-arg types are not bindable from their wire shape and would be dead commands over the real socket: "
                    + string.Join("; ", failures));
        }

        /// <summary>
        /// Builds the generic wire shape (the double/bool/string/dictionary form
        /// <c>EnvelopeCodec</c> produces) for one command-arg type: numbers and
        /// enum ordinals as <c>double</c>, exactly like the real wire.
        /// </summary>
        private static Dictionary<string, object?> SynthesizeWireShape(Type t)
        {
            var dict = new Dictionary<string, object?>();
            foreach (var prop in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (!prop.CanWrite)
                {
                    continue;
                }
                var pt = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;
                if (pt == typeof(string))
                {
                    dict[prop.Name] = "x";
                }
                else if (pt == typeof(bool))
                {
                    dict[prop.Name] = true;
                }
                else if (pt.IsEnum || pt == typeof(double) || pt == typeof(float) ||
                         pt == typeof(int) || pt == typeof(long) || pt == typeof(short) ||
                         pt == typeof(decimal))
                {
                    dict[prop.Name] = 1.0; // wire numbers (incl. enum ordinals) are double
                }
                // Any other property type is left absent — if the binder can't
                // handle it from a missing key that's fine (stays default);
                // a new required non-primitive would surface via a live gap,
                // but no command arg type has one today.
            }
            return dict;
        }
    }
}
