using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The windows that a part's menu has opened on the game's screen, each read as a
/// tree of controls. A window is listed from the moment it is seen open until it
/// closes.
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.gameWindows")]
public class GameWindows
{
    /// <summary>Every window currently open. Empty when none is.</summary>
    public List<GameWindow> Windows { get; set; } = new();
}

/// <summary>One window a part's menu opened on the game's screen.</summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class GameWindow
{
    /// <summary>The window's id, passed back as <see cref="PressGameWindowControlArgs.WindowId"/>. Valid only while the window stays open.</summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>How the game draws the window: <c>imgui</c> for an immediate-mode window, <c>ugui</c> for a retained dialog.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string Technology { get; set; } = "";

    /// <summary>The window's own title, or a dialog's first label.</summary>
    [SitrepUnit(Units.Text)]
    public string Title { get; set; } = "";

    /// <summary>The part menu button that opened the window.</summary>
    public GameWindowOpener OpenedBy { get; set; } = new();

    /// <summary>The window's controls, as a tree whose root is a group.</summary>
    public GameWindowNode Root { get; set; } = new();
}

/// <summary>The part menu button that opened a <see cref="GameWindow"/>.</summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class GameWindowOpener
{
    /// <summary>The part's flight id, as a string.</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>The module that owns the button, or <c>null</c> for a button on the part itself.</summary>
    [SitrepUnit(Units.Text)]
    public string? Module { get; set; }

    /// <summary>The button's event name.</summary>
    [SitrepUnit(Units.Text)]
    public string Event { get; set; } = "";

    /// <summary>The button's label as the game shows it.</summary>
    [SitrepUnit(Units.Text)]
    public string Label { get; set; } = "";
}

/// <summary>
/// One element of a <see cref="GameWindow"/>. <see cref="Kind"/> says which of the
/// other fields apply: <c>group</c> and <c>scroll</c> hold <see cref="Children"/>,
/// laid out as <see cref="Dir"/> says; <c>label</c> and <c>box</c> show
/// <see cref="Text"/>; <c>button</c> shows <see cref="Text"/>; <c>toggle</c> and
/// <c>radio</c> hold <see cref="Bool"/>; <c>textfield</c> and <c>textarea</c> hold <see cref="Text"/>; <c>slider</c>
/// holds <see cref="Num"/> between <see cref="Min"/> and <see cref="Max"/>;
/// <c>grid</c> holds the selected index in <see cref="Num"/> and its
/// <see cref="Options"/>.
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class GameWindowNode
{
    /// <summary>The element's id within its window, passed back as <see cref="PressGameWindowControlArgs.ControlId"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>What the element is: <c>group</c>, <c>scroll</c>, <c>label</c>, <c>box</c>, <c>button</c>, <c>toggle</c>, <c>radio</c>, <c>textfield</c>, <c>textarea</c>, <c>slider</c> or <c>grid</c>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string Kind { get; set; } = "";

    /// <summary>The element's text, or <c>null</c> where it has none.</summary>
    [SitrepUnit(Units.Text)]
    public string? Text { get; set; }

    /// <summary>Whether a <c>toggle</c> is on.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Bool { get; set; }

    /// <summary>A <c>slider</c>'s value, or a <c>grid</c>'s selected index.</summary>
    [SitrepUnit(Units.NotApplicable)]
    public double? Num { get; set; }

    /// <summary>A <c>slider</c>'s lowest value.</summary>
    [SitrepUnit(Units.NotApplicable)]
    public double? Min { get; set; }

    /// <summary>A <c>slider</c>'s highest value.</summary>
    [SitrepUnit(Units.NotApplicable)]
    public double? Max { get; set; }

    /// <summary>How a group lays out its children: <c>h</c> or <c>v</c>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string? Dir { get; set; }

    /// <summary><c>false</c> when the game shows the control greyed out and will not take a press. Omitted otherwise.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Enabled { get; set; }

    /// <summary>The element's tooltip in the game, or <c>null</c> where it has none.</summary>
    [SitrepUnit(Units.Text)]
    public string? Tooltip { get; set; }

    /// <summary>The state the game's colouring gives the element: <c>go</c>, <c>nogo</c> or <c>warn</c>. Omitted when the game draws it uncoloured.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string? Tone { get; set; }

    /// <summary>How a <c>toggle</c> is drawn: <c>button</c> when the game draws it as a button. Omitted for a plain toggle.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string? Variant { get; set; }

    /// <summary>How many columns a <c>grid</c> or a grid-laid <c>group</c> draws, or <c>null</c> for a group that is not a grid.</summary>
    [SitrepUnit(Units.NotApplicable)]
    public int? Columns { get; set; }

    /// <summary>The name of the picture a <c>button</c>, <c>toggle</c> or <c>label</c> shows, or <c>null</c> where it has none.</summary>
    [SitrepUnit(Units.Text)]
    public string? Image { get; set; }

    /// <summary>A <c>grid</c>'s choices.</summary>
    [SitrepUnit(Units.Text)]
    public List<string>? Options { get; set; }

    /// <summary>A group's elements, in the order the window draws them.</summary>
    public List<GameWindowNode>? Children { get; set; }
}

/// <summary>
/// Presses one control of a <see cref="GameWindow"/>. A press rides the signal delay
/// as any command does, and acts on the window as it is when the press arrives. It
/// fails with <see cref="CommandErrorCode.NotFound"/>, naming the reason in its
/// detail, when the window has closed, the control is no longer in it, or the game
/// has the control greyed out.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.gameWindow.press")]
public class PressGameWindowControlArgs
{
    /// <summary>The <see cref="GameWindow.Id"/> of the window.</summary>
    [SitrepUnit(Units.Id)]
    public string WindowId { get; set; } = "";

    /// <summary>The <see cref="GameWindowNode.Id"/> of the control.</summary>
    [SitrepUnit(Units.Id)]
    public string ControlId { get; set; } = "";

    /// <summary>The state to set a <c>toggle</c> to.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Bool { get; set; }

    /// <summary>The value for a <c>slider</c>, or the index for a <c>grid</c>.</summary>
    [SitrepUnit(Units.NotApplicable)]
    public double? Num { get; set; }

    /// <summary>The text for a <c>textfield</c>.</summary>
    [SitrepUnit(Units.Text)]
    public string? Text { get; set; }
}
