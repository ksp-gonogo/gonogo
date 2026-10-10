const SHARED_OPTIONS = `  --root <dir>           the Uplink client package (default: cwd)
  --entry <file>         the client entry to bundle (default: src/index.ts,
                         then src/index.tsx, then package.json "main")
  --uplink <id>          which declared client, when the bundle has several
  --engine <e>           chromium | firefox | webkit
  --with <module>        also bundle this module's registrations, on top of
                         package.json's "gonogo.renderWith". A path, or an
                         installed package (@ksp-gonogo/uplink-tools/widgets
                         for the app's own widgets). For a one-off run;
                         declare the ones a fixture needs every time. Repeatable`;

const RENDER_USAGE = `uplink-tools render [options]

  Render every fixture to ./renders/, for a person to look at.

${SHARED_OPTIONS}
  --scene <name>         one fixture only
  --out <dir>            render output (default: renders/)
  --frames               keep the numbered PNGs of a motion scene
`;

const DOCS_USAGE = `uplink-tools docs [options]

  Write README.md, gonogo-uplink.json, docs/widgets.json and docs/assets/.

${SHARED_OPTIONS}
  --check                regenerate in memory and fail on any difference.
                         The pictures' shapes are compared only on CI
                         (CI or GITHUB_ACTIONS set); elsewhere the README,
                         the manifest, docs/widgets.json and the asset names are
  --no-assets            write README.md, gonogo-uplink.json and
                         docs/widgets.json only, and leave docs/assets/ as it
                         is. For a change that moves the prose (a scene added
                         or removed) on a machine whose renders are not the ones
                         committed
  --assets <dir>         docs asset output (default: docs/assets)
  --bundle <file>        the file you distribute, hashed into integrity
`;

export const usageOf = (verb: string): string =>
  verb === "docs" ? DOCS_USAGE : RENDER_USAGE;
