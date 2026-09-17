# @ksp-gonogo/render-hosts

The app's own widgets, registered, so an Uplink's docs page can draw an augment
or a contribution inside its **real host**.

This exists for the docs page and for nothing else.

## Using it

Install it as a **devDependency** and name it in your client `package.json`:

```json
{
  "devDependencies": {
    "@ksp-gonogo/render-hosts": "^0.1.0"
  },
  "gonogo": {
    "renderWith": ["@ksp-gonogo/render-hosts"]
  }
}
```

A fixture can then name the widget it extends:

```json
{ "_scene": { "host": "strategies" } }
```

There is nothing to `import`. The package exports no symbols: importing it runs
the app widgets' own registrations, which is all the render harness needs to
resolve a scene's `_scene.host`.

## Why it is its own package

From the ruling that created it (#221):

> "typically pulling the widgets into the UI kit is only for the docs page,
> right? It's not for anything else. So I think we should try and make sure
> that's a separate named export path."

`@ksp-gonogo/ui-kit` is a runtime dependency of an Uplink, so a subpath of the
kit would put the app's widgets inside a package every Uplink already imports,
and the docs-only intent would live in a doc comment. Here it is a fact about
the dependency graph instead, and `uplink-isolation.test.ts` fails the build if
this package appears in an Uplink's `dependencies` or in any `import` in its
client source.

## Why a stand-in host is not enough

The render harness already synthesises a host for a scene that names none, and
it covers more than you would expect: an augment mounts in that stand-in's
`Panel`, and `Panel` draws every host's `<id>.badges` itself, so a badge
contribution lands there exactly as it lands in the real widget.

Every **other** contribution slot is drawn by the host widget's own body, and a
stand-in's body draws nothing. `strategies.screens`,
`space-center-status.facilities` and `astronaut-complex.readouts` are each read
by a `useContributions(...)` inside the widget. Standing in for those produces a
blank frame that reports success. A real host body is the only thing that draws
them, which is what this package is for.
