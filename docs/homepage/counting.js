/**
 * Page and click counts for the landing page, sent to a hosted GoatCounter site.
 * No cookies and no stored identifier. The site code arrives in the script tag's
 * `data-site`, filled in when the page is composed; a missing or placeholder code
 * sends nothing, as does a local file, a local address or an automated browser.
 */
(function (root) {
  "use strict";

  function usable(site) {
    return (
      typeof site === "string" &&
      site !== "REPLACE_WITH_GOATCOUNTER_SITE_CODE" &&
      /^[a-z0-9][a-z0-9-]*$/.test(site)
    );
  }

  var COPY_EVENTS = {
    "ckan-filter": "install-ckan-copy",
    "run-command": "install-docker-copy",
  };

  var LINK_EVENTS = [
    [/^https:\/\/github\.com\/KSP-CKAN\//, "install-ckan"],
    [/^https:\/\/spacedock\.info\//, "install-download-spacedock"],
    [/^https:\/\/github\.com\/ksp-gonogo\/gonogo\/releases/, "install-download-mod"],
    [/KSP-SETUP\.md/, "install-setup-guide"],
    [/^https:\/\/www\.docker\.com\//, "install-docker"],
    [/^https:\/\/podman\.io\//, "install-podman"],
    [/NETWORKING\.md/, "install-networking-guide"],
    [/^http:\/\/localhost:8080/, "install-open-local-app"],
  ];

  function linkEvent(url) {
    var path = url.pathname;
    if (path === "/app" || path.indexOf("/app/") === 0) return "open-app-app";
    if (path === "/rc" || path.indexOf("/rc/") === 0) return "open-app-rc";
    for (var k = 0; k < LINK_EVENTS.length; k++) {
      if (LINK_EVENTS[k][0].test(url.href)) return LINK_EVENTS[k][1];
    }
    return null;
  }

  function start(env) {
    if (!usable(env.site) || !env.enabled) return;
    var sent = {};
    function hit(path, isEvent) {
      if (sent[path]) return;
      sent[path] = true;
      var query = "p=" + encodeURIComponent(path) + "&t=" + encodeURIComponent(env.title);
      if (isEvent) query += "&e=true";
      env.send("https://" + env.site + ".goatcounter.com/count?" + query);
    }
    hit("/", false);
    env.document.addEventListener("click", function (click) {
      var target = click.target;
      if (!target || !target.closest) return;
      var summary = target.closest("ol.steps summary");
      if (summary) {
        var step = summary.closest("ol.steps > li");
        hit("install-step-" + (Array.prototype.indexOf.call(step.parentNode.children, step) + 1), true);
      }
      var copy = target.closest("button[data-copy]");
      if (copy) {
        var copied = COPY_EVENTS[copy.getAttribute("data-copy")];
        if (copied) hit(copied, true);
      }
      var link = target.closest("a[href]");
      if (!link) return;
      var url;
      try {
        url = new URL(link.href, env.document.baseURI);
      } catch (error) {
        return;
      }
      var name = linkEvent(url);
      if (name) hit(name, true);
    });
  }

  root.GonogoLandingCounting = { start: start };

  if (typeof document !== "undefined" && document.currentScript) {
    var host = location.hostname;
    var local =
      location.protocol === "file:" ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      /^(0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
    start({
      site: document.currentScript.getAttribute("data-site"),
      enabled: !local && navigator.webdriver !== true,
      title: document.title,
      document: document,
      send: function (url) {
        new Image().src = url;
      },
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
