import { createGlobalStyle } from "styled-components";

/**
 * Design-token custom properties as a styled-components global sheet.
 *
 * Mirrors `tokens.css` exactly — the same `:root` variable block and the
 * coarse-pointer font-size override. Hosts that build their global styles
 * through styled-components (rather than importing `@ksp-gonogo/theme/tokens.css`)
 * render `<GonogoTokens />` once near the tree root.
 *
 * Not auto-mounted: injecting a stylesheet is a side effect, and this package
 * stays side-effect-free so it tree-shakes cleanly. The host opts in
 * explicitly.
 *
 * Keep this block and `tokens.css` in sync — they are two hand-maintained
 * copies of the same source of truth.
 */
export const GonogoTokens = createGlobalStyle`
  :root {
    --font-family-mono:
      "JetBrains Mono", ui-monospace, "IBM Plex Mono", Menlo, Consolas, monospace;
    --font-size-xs: 11px;
    --font-size-sm: 12px;
    --font-size-base: 14px;
    --font-size-lg: 16px;

    --color-text-primary: #ccc;
    --color-text-muted: #888;
    --color-text-dim: #808080;
    --color-text-faint: #7a7a7a;
    --color-text-inverse: #050505;

    --color-surface-app: #050505;
    --color-surface-panel: #0d0d0d;
    --color-surface-raised: #1a1a1a;
    --color-surface-sunken: #0a0a0a;

    --color-border-subtle: #2a2a2a;
    --color-border-strong: #333;

    --color-accent-fg: #00ff88;
    --color-accent-bg: #00ff88;

    --color-status-go-fg: #cfe;
    --color-status-go-bg: #2e5a2e;
    --color-status-nogo-fg: #ffdede;
    --color-status-nogo-bg: #ff4d4d;
    --color-status-warning-fg: #1a1a1a;
    --color-status-warning-bg: #ff8c00;
    --color-status-info-fg: #7cf;
    --color-status-info-bg: #0d0d0d;

    --color-status-alert-muted: #4a0e0e;
    --color-status-warning-bg-muted: #3a2a0a;
    --color-status-warning-fg-muted: #ffd68a;
    --color-status-warning-border-muted: #8a6a28;

    --color-tag-blue-fg: #4488ff;
    --color-tag-blue-bg: #0a0a1a;
    --color-tag-blue-border: #1a1a3a;
    --color-tag-purple-fg: #cc44cc;
    --color-tag-purple-bg: #1a0a1a;
    --color-tag-purple-border: #6a3a9a;
    --color-tag-yellow-fg: #ffeb3b;
    --color-tag-yellow-bg: #3a2800;
    --color-tag-yellow-border: #6a5a2a;
    --color-tag-dark-brown-bg: #1a1000;
    --color-tag-dark-brown-border: #3a2800;
    --color-tag-cyan-fg: #00cccc;
    --color-tag-orange-fg: #ff6633;
    --color-tag-red-fg: #ff4466;

    --color-data-1: #6cb4ff;
    --color-data-2: #ff7e7e;
    --color-data-3: #d987ff;
    --color-data-4: #ffb87a;
    --color-data-5: #4fe6ff;
    --color-data-6: #ffd866;
    --color-data-7: #ff8eb8;
    --color-data-8: #7d8eff;
    --color-data-9: #88dd55;
    --color-data-10: #44dddd;
    --color-data-11: #c87fff;
    --color-data-12: #ff5cad;
    --color-data-13: #5fc97a;
    --color-data-14: #e89c5b;
    --color-data-15: #aa9cff;
    --color-data-16: #c2db4a;
    --color-data-17: #6fc2e5;
    --color-data-18: #db8b6f;
    --color-data-19: #b6f7d6;
    --color-data-20: #ffa3d6;
    --color-data-21: #87a6ff;
    --color-data-22: #ffc88e;
    --color-data-23: #c8a6e3;
    --color-data-24: #f5e07c;

    --color-focus: #00ff88;
  }

  @media (pointer: coarse) {
    :root {
      --font-size-xs: 12px;
      --font-size-sm: 13px;
      --font-size-base: 15px;
      --font-size-lg: 17px;
    }
  }
`;
