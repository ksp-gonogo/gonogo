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

// Built up from a second rather than written as 86,400, which is the shape the
// design-system guard insists on and the kit's own real-day ladder uses: the
// number a hand rolls out of habit is wrong by a factor of four on stock Kerbin,
// so the repo does not let one be spelled anywhere but a test.
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

setKspCalendar({
  minute: MINUTE,
  hour: HOUR,
  day: DAY,
  year: 365 * DAY,
});
