// Render-time setup for this Uplink's own scenes.
//
// RP-1 ships on Real Solar System, so every duration in an RP-1 career is
// measured on a real calendar: a 365-day year of 24-hour days. The kit's
// duration ladder gets that from the running game, over `time.calendar`, and
// applies it through an app-side observer no widget subscribes to. The render
// harness mounts widgets rather than the app, so without this the ladder stays
// on its stock Kerbin default and a seven-year Program renders as "24y 3d",
// which is the same duration on a calendar RP-1 is never running.
//
// Pinned here rather than emitted from a fixture on purpose: it is a property of
// the install every one of these scenes assumes, not of any one scene, and a
// fixture emitting it would be dropped anyway because the widget does not
// subscribe to the topic that carries it.
import { setKspCalendar } from "@ksp-gonogo/sitrep-sdk";

setKspCalendar({
  minute: 60,
  hour: 3_600,
  day: 86_400,
  year: 365 * 86_400,
});
