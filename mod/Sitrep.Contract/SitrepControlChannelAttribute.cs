using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Declares a wire-payload read property to be one half of a BIDIRECTIONAL
    /// control channel, pairing it with the write command that actuates the same
    /// control. Placed on the READ property of a <see cref="SitrepTopicAttribute"/>
    /// payload (e.g. <c>VesselControl.Throttle</c>); the attribute's constructor
    /// carries the WRITE half (the command name, its typed args, and the field of
    /// those args that carries the value). Codegen (<c>RtConfig.EmitChannelMap</c>,
    /// invoked from <c>mod/codegen.sh</c>) reflects over these and emits
    /// <c>mod/sitrep-sdk/src/__generated__/control-channels.ts</c>, which the SDK
    /// wraps into ONE handle per channel (see <c>control-channels.ts</c>).
    ///
    /// <para><b>Bidirectionality is required by the type.</b> There is no
    /// parameterless or read-only overload: declaring the attribute at all forces
    /// a write command + args + value field, and the read half is the property it
    /// sits on. A control axis cannot be declared one-way, the same discipline as
    /// a mandatory interface member. It also gives the write side a real
    /// contract-declared type instead of the bare command string it was before.</para>
    ///
    /// <para>Lives IN <c>Sitrep.Contract</c> and is compiled into BOTH target
    /// frameworks, the same rule <see cref="SitrepTopicAttribute"/> and
    /// <see cref="SitrepUnitAttribute"/> follow and for the same reason: anything
    /// reflecting over it (codegen, the coverage gate) must never have to resolve
    /// an external assembly. It is metadata only and does NOT touch the wire: the
    /// read topic field and the write command stay two separate wire keys, exactly
    /// as before, and only the SDK unifies them.</para>
    /// </summary>
    [AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepControlChannelAttribute : Attribute
    {
        /// <summary>The channel id, e.g. <c>"vessel.control.throttle"</c>. Unique across all declared channels.</summary>
        public string ChannelId { get; }

        /// <summary>The write command the value is dispatched on, e.g. <c>"vessel.control.setThrottle"</c>.</summary>
        public string WriteCommand { get; }

        /// <summary>The typed args class the write command takes, e.g. <c>typeof(SetThrottleArgs)</c>.</summary>
        public Type Args { get; }

        /// <summary>The C# property name on <see cref="Args"/> that carries the value, e.g. <c>nameof(SetThrottleArgs.Value)</c>.</summary>
        public string ValueField { get; }

        public SitrepControlChannelAttribute(string channelId, string writeCommand, Type args, string valueField)
        {
            ChannelId = channelId;
            WriteCommand = writeCommand;
            Args = args;
            ValueField = valueField;
        }
    }
}
