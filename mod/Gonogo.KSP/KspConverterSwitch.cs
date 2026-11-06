using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// Switches a drill, ISRU unit or fuel cell on the active vessel through the
    /// shared converter actuator. A part's converters are the resource
    /// converters and harvesters on it, in module order, named by the same
    /// <c>ConverterName</c> the <c>isru.*</c> entries publish.
    /// </summary>
    internal sealed class KspConverterSwitch : IConverterSwitch
    {
        public CommandResult Switch(string partId, string? converterName, bool on)
        {
            if (!KspScienceActuator.TryResolvePart(partId, out var part, out var error))
            {
                return CommandResult.Fail(error!);
            }

            var converters = new List<BaseConverter>();
            var names = new List<string>();
            foreach (var module in part!.Modules)
            {
                if (module is ModuleResourceConverter || module is ModuleResourceHarvester)
                {
                    var converter = (BaseConverter)module;
                    converters.Add(converter);
                    names.Add(converter.ConverterName ?? "");
                }
            }

            var index = ConverterPick.Of(names, converterName, out var refusal);
            if (index < 0)
            {
                return CommandResult.Fail(refusal!.Value.Code, refusal.Value.Detail);
            }

            return KspConverterActuator.Set(converters[index], on);
        }
    }
}
