using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Declares a Topic payload property to be the read half of a two-way
    /// control channel, and names the command that writes the same control.
    /// Placed on the read property (e.g. <c>VesselControl.Throttle</c>); the
    /// constructor carries the write half: the command name, its typed args
    /// class, and the property of those args that carries the value. The SDK
    /// exposes each declared channel as one handle that reads the property and
    /// writes through the command.
    ///
    /// <para>There is no read-only form: declaring the attribute requires a
    /// write command, args type and value field. It is metadata only. On the
    /// wire the read field and the write command stay two separate keys.</para>
    /// <internal>
    /// RtConfig.EmitChannelMap (run from mod/codegen.sh) reflects over these and
    /// emits mod/sitrep-sdk/src/__generated__/control-channels.ts, which
    /// control-channels.ts wraps into one handle per channel. Lives in
    /// Sitrep.Contract and is compiled into both target frameworks, like
    /// SitrepTopicAttribute and SitrepUnitAttribute, so codegen and the
    /// coverage gate never have to resolve an external assembly.
    /// </internal>
    /// </summary>
    /// <category>Channels and emission</category>
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

        /// <summary>Declares the property this sits on as the read half of the control channel <paramref name="channelId"/>.</summary>
        /// <param name="channelId">The channel id, unique across all declared channels.</param>
        /// <param name="writeCommand">The command that writes the control.</param>
        /// <param name="args">The typed args class <paramref name="writeCommand"/> takes.</param>
        /// <param name="valueField">The C# property name on <paramref name="args"/> that carries the value.</param>
        public SitrepControlChannelAttribute(string channelId, string writeCommand, Type args, string valueField)
        {
            ChannelId = channelId;
            WriteCommand = writeCommand;
            Args = args;
            ValueField = valueField;
        }
    }
}
