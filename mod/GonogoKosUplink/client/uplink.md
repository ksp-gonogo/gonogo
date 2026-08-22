Puts a [kOS](https://github.com/KSP-KOS/KOS) CPU's terminal on the mission-control
dashboard, streamed in process over the Uplink with no proxy to run.

The terminal is the real one: kOS draws its screen as VT bytes and this renders them
with xterm, so what you see is byte-for-byte what the in-game window shows. Keystrokes
go back the other way as commands, which means they are subject to the same signal
delay as everything else, and that is the point rather than a limitation.

## Install

Install kOS through CKAN, then the Gonogo kOS Uplink alongside it. With no kOS CPU in
range the widget says so; it never becomes a hard startup requirement for the app.

## widget:kos-terminal

Attach a terminal to a CPU by its kOS tagname. With exactly one CPU present it
attaches on its own; with several and no tagname it offers a picker rather than
guessing.

Line mode is the setting worth understanding. With it off, every keystroke is its own
command, so under light-time delay a ten-character command is ten round trips and you
watch your own typing arrive minutes later. With it on, the line is composed locally
with instant echo in the bar under the screen and sent as ONE command on Enter. The
composition never touches the terminal screen, so a keyframe repaint arriving
mid-sentence does not eat what you were typing.

Read-only mode forwards nothing at all: a passive downlink view of what the CPU is
doing, for a station screen that should not be able to fly the craft.
