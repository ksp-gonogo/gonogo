using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Modes
{
    /// <summary>
    /// <c>system.modes</c> and <c>mode.state</c> as the wire carries them: one
    /// flattener per contract type, named for the type it stands for, so the
    /// producer parity scan holds each to every field.
    /// </summary>
    internal static class ModeWire
    {
        internal static Dictionary<string, object?> BuildModesModel(ModesModel model)
        {
            var modes = new List<object?>();
            foreach (var listing in model.Modes)
            {
                modes.Add(BuildModeListing(listing));
            }
            return new Dictionary<string, object?> { ["modes"] = modes };
        }

        internal static Dictionary<string, object?> BuildModeListing(ModeListing listing) =>
            new Dictionary<string, object?>
            {
                ["declaration"] = BuildModeDeclaration(listing.Declaration),
                ["owner"] = listing.Owner,
                ["eligible"] = listing.Eligible,
            };

        internal static Dictionary<string, object?> BuildModeDeclaration(ModeDeclaration declaration)
        {
            var scenes = new List<object?>();
            foreach (var scene in declaration.Scenes)
            {
                scenes.Add(scene);
            }
            return new Dictionary<string, object?>
            {
                ["id"] = declaration.Id,
                ["name"] = declaration.Name,
                ["order"] = declaration.Order,
                ["activation"] = declaration.Activation,
                ["scenes"] = scenes,
                ["answers"] = declaration.Answers,
                ["modelled"] = declaration.Modelled,
                ["timeline"] = declaration.Timeline,
            };
        }

        internal static Dictionary<string, object?> BuildModeStateModel(ModeStateModel state)
        {
            var inputs = new List<object?>();
            foreach (var input in state.Inputs)
            {
                inputs.Add(BuildModeInput(input));
            }
            return new Dictionary<string, object?>
            {
                ["mode"] = state.Mode,
                ["name"] = state.Name,
                ["answers"] = state.Answers,
                ["modelled"] = state.Modelled,
                ["inputs"] = inputs,
                ["timeline"] = state.Timeline == null ? null : BuildModeTimelineState(state.Timeline),
                ["noTimeline"] = state.NoTimeline,
                ["entry"] = state.Entry,
            };
        }

        internal static Dictionary<string, object?> BuildModeInput(ModeInput input) =>
            new Dictionary<string, object?>
            {
                ["key"] = input.Key,
                ["value"] = input.Value,
            };

        internal static Dictionary<string, object?> BuildModeTimelineState(ModeTimelineState timeline)
        {
            var rates = new List<object?>();
            foreach (var rate in timeline.Rates)
            {
                rates.Add(rate);
            }
            var marks = new List<object?>();
            foreach (var mark in timeline.Marks)
            {
                marks.Add(BuildModeMark(mark));
            }
            return new Dictionary<string, object?>
            {
                ["startUt"] = timeline.StartUt,
                ["endUt"] = timeline.EndUt,
                ["atUt"] = timeline.AtUt,
                ["playing"] = timeline.Playing,
                ["rate"] = timeline.Rate,
                ["rates"] = rates,
                ["marks"] = marks,
                ["launchUt"] = timeline.LaunchUt,
            };
        }

        internal static Dictionary<string, object?> BuildModeMark(ModeMark mark) =>
            new Dictionary<string, object?>
            {
                ["ut"] = mark.Ut,
                ["label"] = mark.Label,
            };

    }
}
