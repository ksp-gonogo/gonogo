/*
 * The page's behaviour: one view at a time, the contents drawer, the theme
 * switch, and the request console. The console opens the same socket the app
 * does, `ws://<host>:<port>` with no path, and reads frames the same way:
 * binary WebSocket messages whose first byte tells a JSON frame (`{`) from a
 * binary-lane one (0x9E, then a lane byte, a two-byte big-endian header length
 * and a JSON header).
 */
(() => {
  const ADDRESS_KEY = "gonogo.api.address";
  const THEME_KEY = "gonogo.api.theme";
  const LOG_LIMIT = 400;
  const SUBSCRIBE_WAIT_MS = 5000;
  const BINARY_LANE_MAGIC = 0x9e;
  const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const store = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage is a convenience: the page works without it */
      }
    },
  };

  const themeButton = $("theme-toggle");
  const prefersLight = matchMedia("(prefers-color-scheme: light)");
  let theme = "dark";
  function applyTheme(chosen) {
    if (chosen === "light" || chosen === "dark") root.dataset.theme = chosen;
    else delete root.dataset.theme;
    theme = root.dataset.theme ?? (prefersLight.matches ? "light" : "dark");
    themeButton.textContent = theme === "light" ? "Dark" : "Light";
    themeButton.setAttribute(
      "aria-label",
      theme === "light"
        ? "Switch to the dark theme"
        : "Switch to the light theme",
    );
  }
  applyTheme(store.get(THEME_KEY));
  prefersLight.addEventListener("change", () =>
    applyTheme(store.get(THEME_KEY)),
  );
  themeButton.addEventListener("click", () => {
    const next = theme === "light" ? "dark" : "light";
    store.set(THEME_KEY, next);
    applyTheme(next);
  });

  /*
   * Drawers on a narrow screen: a scrim behind the open one closes it, as does
   * Escape, and focus moves into the drawer and back to its button.
   */
  const scrim = $("scrim");
  const drawers = [
    {
      button: $("nav-toggle"),
      panel: $("sidebar"),
      focus: () => $("nav-filter"),
    },
    {
      button: $("console-toggle"),
      panel: $("console"),
      focus: () => $("address"),
    },
  ];
  const isDrawer = (panel) => getComputedStyle(panel).position === "fixed";
  function setOpen(drawer, open, { restoreFocus = true } = {}) {
    drawer.button.setAttribute("aria-expanded", String(open));
    drawer.panel.classList.toggle("open", open);
    if (open) {
      for (const other of drawers)
        if (other !== drawer) setOpen(other, false, { restoreFocus: false });
      drawer.focus().focus();
    }
    if (!open && restoreFocus && drawer.panel.contains(document.activeElement))
      drawer.button.focus();
    scrim.hidden = !drawers.some(
      (each) => each.panel.classList.contains("open") && isDrawer(each.panel),
    );
  }
  for (const drawer of drawers)
    drawer.button.addEventListener("click", () =>
      setOpen(drawer, drawer.button.getAttribute("aria-expanded") !== "true"),
    );
  const closeDrawers = () => {
    for (const drawer of drawers)
      if (drawer.panel.classList.contains("open")) setOpen(drawer, false);
  };
  scrim.addEventListener("click", closeDrawers);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawers();
  });
  $("sidebar").addEventListener("click", (event) => {
    if (event.target.closest("a") && isDrawer($("sidebar")))
      setOpen(drawers[0], false, { restoreFocus: false });
  });

  /*
   * One view at a time. The view is the section holding the element the hash
   * names, so every link on the page keeps working; a closed block around the
   * target is opened.
   */
  const views = [...document.querySelectorAll("main > .view")];
  root.classList.add("paged");
  function show(hash, scroll) {
    const id = decodeURIComponent(hash.replace(/^#/, ""));
    const target = id ? document.getElementById(id) : null;
    const view = target?.closest(".view") ?? views[0];
    for (const each of views) each.hidden = each !== view;
    for (let at = target?.parentElement; at; at = at.parentElement)
      if (at.tagName === "DETAILS") at.open = true;
    if (target?.tagName === "DETAILS") target.open = true;
    markCurrent(view, target);
    const heading = view?.querySelector("h1, h2")?.textContent?.trim();
    document.title =
      heading && view !== views[0] ? `${heading} | Gonogo API` : "Gonogo API";
    $("hash-missing").hidden = !(id && !target);
    if (!scroll) return;
    if (target && target !== view) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }

  const navLinks = [...document.querySelectorAll("#sidebar a[href^='#']")];
  function markCurrent(view, target) {
    const viewName = view?.dataset.view;
    for (const group of document.querySelectorAll("#sidebar .nav-group")) {
      const current = group.dataset.view === viewName;
      group.classList.toggle("current", current);
      const details = group.querySelector("details");
      if (current) details?.setAttribute("open", "");
      if (!current && !$("nav-filter").value) details?.removeAttribute("open");
    }
    highlight(target?.closest(".card")?.id ?? target?.id);
  }
  function highlight(id) {
    for (const link of navLinks) {
      if (link.getAttribute("href") === `#${id}`) {
        link.setAttribute("aria-current", "location");
        link.scrollIntoView({ block: "nearest" });
      } else link.removeAttribute("aria-current");
    }
  }
  if ("IntersectionObserver" in window) {
    const watcher = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length) highlight(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    for (const card of document.querySelectorAll(
      "main .card[id], main h2[id], main h3[id]",
    ))
      watcher.observe(card);
  }
  window.addEventListener("hashchange", () => show(location.hash, true));
  show(location.hash, Boolean(location.hash));

  const filter = $("nav-filter");
  filter.addEventListener("input", () => {
    const needle = filter.value.trim().toLowerCase();
    for (const group of document.querySelectorAll("#sidebar .nav-group")) {
      let shown = 0;
      for (const item of group.querySelectorAll("li[data-name]")) {
        const match =
          !needle || item.dataset.name.toLowerCase().includes(needle);
        item.hidden = !match;
        if (match) shown++;
      }
      group.hidden = shown === 0 && Boolean(needle);
      if (needle && shown > 0)
        group.querySelector("details")?.setAttribute("open", "");
    }
  });

  const operations = JSON.parse($("operations").textContent);
  const byId = new Map(
    operations.map((operation) => [operation.id, operation]),
  );
  const pick = $("frame-pick");
  const body = $("frame-body");
  const frameError = $("console-error");
  const sendButton = $("send");
  const requestIdHint = $("request-id-hint");
  const placeholderHint = $("placeholder-hint");
  let armed = false;

  /*
   * A command acts on the save, so the first press of Send on one only arms
   * it and says so; the second press sends. Any edit or new choice disarms.
   */
  function disarm() {
    armed = false;
    sendButton.textContent = "Send";
  }
  function updateHints() {
    placeholderHint.hidden = !/"<[^"]*>"/.test(body.value);
    disarm();
  }

  function fitEditor() {
    body.rows = Math.min(8, Math.max(4, body.value.split("\n").length));
  }
  function choose(id) {
    const operation = byId.get(id);
    if (!operation) return;
    pick.value = id;
    body.value = JSON.stringify(operation.frame, null, 2);
    requestIdHint.hidden = operation.frame?.type !== "command-request";
    frameError.textContent = "";
    fitEditor();
    updateHints();
  }
  pick.addEventListener("change", () => choose(pick.value));
  body.addEventListener("input", () => {
    fitEditor();
    updateHints();
  });
  $("reset").addEventListener("click", () => choose(pick.value));
  choose(
    byId.has("channel:vessel.flight")
      ? "channel:vessel.flight"
      : operations[0]?.id,
  );

  for (const button of document.querySelectorAll("button.try")) {
    button.addEventListener("click", () => {
      choose(button.dataset.op);
      if (isDrawer($("console"))) setOpen(drawers[1], true);
      body.focus();
    });
  }

  const addressInput = $("address");
  const connectButton = $("connect");
  const status = $("status");
  const mixedNote = $("mixed-note");
  const hint = $("console-hint");
  const sendHint = $("send-hint");
  addressInput.value = store.get(ADDRESS_KEY) ?? addressInput.value;

  function socketUrl(address) {
    const trimmed = address.trim();
    return /^wss?:\/\//.test(trimmed) ? trimmed : `ws://${trimmed}`;
  }

  /** Whether the browser will refuse the socket because this page came over https and the address is not this computer. */
  function blockedAsMixedContent(url) {
    if (location.protocol !== "https:") return false;
    try {
      const target = new URL(url);
      return target.protocol === "ws:" && !LOOPBACK.has(target.hostname);
    } catch {
      return false;
    }
  }

  function updateMixedNote() {
    mixedNote.hidden = !blockedAsMixedContent(socketUrl(addressInput.value));
  }
  addressInput.addEventListener("input", updateMixedNote);
  updateMixedNote();

  let socket = null;
  const subscriptions = new Map();
  const commandsByRequest = new Map();

  function setStatus(text, state) {
    status.textContent = text;
    status.dataset.state = state;
    connectButton.textContent =
      state === "disconnected" ? "Connect" : "Disconnect";
    sendButton.disabled = state !== "connected";
    sendHint.hidden = state === "connected";
    hint.hidden = state === "connected";
  }
  setStatus("Not connected", "disconnected");

  $("connect-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (socket) {
      socket.close();
      return;
    }
    const address = addressInput.value.trim();
    const url = socketUrl(address);
    store.set(ADDRESS_KEY, address);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      setStatus(`Could not open ${url}: ${error.message}`, "disconnected");
      return;
    }
    socket = ws;
    let opened = false;
    ws.binaryType = "arraybuffer";
    setStatus(`Connecting to ${address}`, "connecting");
    note(`Connecting to ${address}`);
    ws.addEventListener("open", () => {
      if (socket !== ws) return;
      opened = true;
      setStatus(`Connected to ${address}`, "connected");
      note(`Connected to ${address}`);
    });
    ws.addEventListener("message", (event) => {
      if (socket === ws) receive(event.data);
    });
    ws.addEventListener("close", () => {
      if (socket !== ws) return;
      socket = null;
      for (const entry of subscriptions.values()) clearTimeout(entry.timer);
      subscriptions.clear();
      renderSubscriptions();
      note(
        opened
          ? `Disconnected from ${address}`
          : `No game answered at ${address}`,
      );
      setStatus(closedStatus(address, url, opened), "disconnected");
    });
  });

  /** What the status line says when the socket closes, by whether it ever opened and why. */
  function closedStatus(address, url, opened) {
    if (opened) return `Disconnected from ${address}`;
    if (blockedAsMixedContent(url))
      return `The browser blocked the connection to ${address}: see the note below.`;
    return `No game answered at ${address}. Start KSP with the Gonogo mod installed, then connect again.`;
  }

  let requestCount = 0;
  function sendFrame(frame) {
    socket.send(JSON.stringify(frame));
    log("out", frame);
  }

  sendButton.addEventListener("click", () => {
    let frame;
    try {
      frame = JSON.parse(body.value);
    } catch (error) {
      frameError.textContent = `The payload is not valid JSON: ${error.message}`;
      return;
    }
    frameError.textContent = "";
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (frame?.type === "command-request" && !armed) {
      armed = true;
      sendButton.textContent = `Send ${frame.command ?? "the command"} to the game`;
      frameError.textContent =
        "This command acts on the save in the game. Press again to send it.";
      return;
    }
    disarm();
    if (frame?.type === "command-request") {
      if (!frame.requestId) {
        requestCount += 1;
        frame.requestId = `api-page-${Date.now().toString(36)}-${requestCount}`;
      }
      commandsByRequest.set(frame.requestId, frame.command);
    }
    sendFrame(frame);
    if (frame?.type === "subscribe" && typeof frame.topic === "string")
      watchSubscription(frame.topic);
    if (frame?.type === "unsubscribe") dropSubscription(frame.topic);
  });

  /*
   * A subscription is listed as waiting until the mod answers: an `event`
   * named `subscribed`, or an `error` naming the topic for a channel nothing
   * declares. The timeout covers an answer that never comes.
   */
  function watchSubscription(topic) {
    dropSubscription(topic);
    const entry = { state: "waiting", timer: 0 };
    entry.timer = setTimeout(() => {
      if (entry.state !== "waiting") return;
      entry.state = "silent";
      renderSubscriptions();
    }, SUBSCRIBE_WAIT_MS);
    subscriptions.set(topic, entry);
    renderSubscriptions();
  }
  function dropSubscription(topic) {
    const entry = subscriptions.get(topic);
    if (entry) clearTimeout(entry.timer);
    subscriptions.delete(topic);
    renderSubscriptions();
  }

  const subsList = $("subs");
  const SUB_STATE = {
    waiting: "waiting for the mod",
    subscribed: "subscribed",
    silent: "no reply yet",
    unknown: "no such channel",
  };
  function renderSubscriptions() {
    subsList.replaceChildren();
    $("subs-section").hidden = subscriptions.size === 0;
    for (const [topic, entry] of subscriptions) {
      const item = document.createElement("li");
      item.dataset.state = entry.state;
      const name = document.createElement("code");
      name.textContent = topic;
      const state = document.createElement("span");
      state.className = "sub-state";
      state.textContent = SUB_STATE[entry.state];
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "Unsubscribe";
      close.setAttribute("aria-label", `Unsubscribe from ${topic}`);
      close.addEventListener("click", () => {
        if (socket?.readyState === WebSocket.OPEN)
          sendFrame({ type: "unsubscribe", topic });
        dropSubscription(topic);
      });
      item.append(name, state, close);
      subsList.append(item);
    }
  }
  renderSubscriptions();

  const decoder = new TextDecoder("utf-8");
  function receive(data) {
    if (typeof data === "string") return logText(data);
    const bytes = new Uint8Array(data);
    if (bytes[0] !== BINARY_LANE_MAGIC) return logText(decoder.decode(bytes));
    const headerLength = (bytes[2] << 8) | bytes[3];
    let header;
    try {
      header = JSON.parse(decoder.decode(bytes.subarray(4, 4 + headerLength)));
    } catch {
      header = { type: "stream-binary", unreadable: true };
    }
    log("in", header, `${bytes.length - 4 - headerLength} payload bytes`);
  }

  /** A line in the log about the connection itself, not a frame. */
  function note(text) {
    const entry = document.createElement("li");
    entry.className = "log-note";
    entry.dataset.search = text.toLowerCase();
    const time = document.createElement("time");
    time.textContent = new Date().toLocaleTimeString([], { hour12: false });
    entry.append(time, ` ${text}`);
    logEmpty.hidden = true;
    logList.prepend(entry);
  }

  function logText(text) {
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      return log("in", { type: "unreadable" }, text);
    }
    const answered =
      frame?.type === "event" && frame.name === "subscribed"
        ? "subscribed"
        : frame?.type === "error" && frame.topic
          ? "unknown"
          : null;
    const entry = answered ? subscriptions.get(frame.topic) : undefined;
    if (entry && entry.state !== "subscribed") {
      clearTimeout(entry.timer);
      entry.state = answered;
      renderSubscriptions();
    }
    log("in", frame);
  }

  const logList = $("log");
  const logEmpty = $("log-empty");
  const logFilter = $("log-filter");
  const pause = $("pause");
  let held = 0;

  function matchesFilter(entry) {
    const needle = logFilter.value.trim().toLowerCase();
    if (entry === logEmpty) return logEmpty.hidden === false;
    return !needle || (entry.dataset.search ?? "").includes(needle);
  }

  /** What a frame is about: its channel, its command, or for an answer the command it answers. */
  function subjectOf(frame) {
    if (frame?.topic) return frame.topic;
    if (frame?.command) return frame.command;
    if (frame?.requestId)
      return commandsByRequest.get(frame.requestId) ?? frame.requestId;
    return "";
  }

  function log(direction, frame, note) {
    if (pause.checked && direction === "in") {
      held += 1;
      $("held").textContent = `${held} not shown while paused`;
      return;
    }
    const subject = subjectOf(frame);
    const entry = document.createElement("li");
    entry.className = `frame frame-${direction}`;
    entry.dataset.type = frame?.type ?? "";
    entry.dataset.search = `${frame?.type ?? ""} ${subject}`.toLowerCase();
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const arrow = document.createElement("span");
    arrow.className = "frame-dir";
    arrow.textContent = direction === "out" ? "Sent" : "Received";
    const time = document.createElement("time");
    time.textContent = new Date().toLocaleTimeString([], { hour12: false });
    const type = document.createElement("span");
    type.className = "frame-type";
    type.textContent = frame?.type ?? "frame";
    const topic = document.createElement("code");
    topic.textContent = subject;
    summary.append(arrow, time, type, topic);
    const pre = document.createElement("pre");
    pre.textContent =
      JSON.stringify(frame, null, 2) + (note ? `\n\n${note}` : "");
    details.append(summary, pre);
    entry.append(details);
    entry.hidden = !matchesFilter(entry);
    logList.prepend(entry);
    logEmpty.hidden = true;
    while (logList.children.length > LOG_LIMIT)
      logList.lastElementChild.remove();
  }

  logFilter.addEventListener("input", () => {
    for (const entry of logList.children) entry.hidden = !matchesFilter(entry);
  });
  pause.addEventListener("change", () => {
    if (!pause.checked) {
      held = 0;
      $("held").textContent = "";
    }
  });
  $("clear").addEventListener("click", () => {
    logList.replaceChildren(logEmpty);
    logEmpty.hidden = false;
  });
})();
