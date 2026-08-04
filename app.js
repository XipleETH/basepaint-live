document.documentElement.classList.add("js");

const START_TIMESTAMP = 1691599315;
const LIVE_STATUS_URL = "/api/livekit-status";
const BASEPAINT_URL = "https://basepaint.xyz";

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

function currentDay() {
  return Math.floor((Date.now() / 1000 - START_TIMESTAMP) / 86400) + 1;
}

function shortAddress(address) {
  const value = String(address || "");
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function initials(value) {
  const clean = String(value || "BP")
    .replace(/\.(?:base\.)?eth$/i, "")
    .replace(/^0x/i, "")
    .replace(/[^a-z0-9]/gi, "");
  return (clean.slice(0, 2) || "BP").toUpperCase();
}

function plural(count, singular, pluralValue = `${singular}s`) {
  return Number(count) === 1 ? singular : pluralValue;
}

function setupNavigation() {
  const toggle = $("#nav-toggle");
  const links = $("#nav-links");
  if (!toggle || !links) return;

  toggle.addEventListener("click", () => {
    const open = !links.classList.contains("is-open");
    links.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "CLOSE" : "MENU";
  });

  links.addEventListener("click", (event) => {
    if (!event.target.closest("a")) return;
    links.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "MENU";
  });
}

function setupReveals() {
  const elements = $$(".reveal");
  if (!("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8%", threshold: 0.08 });

  elements.forEach((element) => observer.observe(element));
}

function setupModeSwitch() {
  const demo = $("#product-demo");
  const caption = $("#mode-caption");
  const buttons = $$("[data-demo-mode]");
  if (!demo || !caption || !buttons.length) return;

  const captions = {
    viewer: "Viewer sees the live window over the canvas.",
    creator: "Streamer keeps a clear canvas and a small preview.",
  };

  buttons.forEach((button) => button.addEventListener("click", () => {
    const mode = button.dataset.demoMode === "creator" ? "creator" : "viewer";
    demo.dataset.mode = mode;
    buttons.forEach((item) => item.classList.toggle("mode-button-active", item === button));
    caption.textContent = captions[mode];
  }));
}

function drawDemoCanvas() {
  const canvas = $("#demo-canvas");
  const context = canvas?.getContext("2d");
  if (!context) return;

  const colors = {
    background: "#06101c",
    gridA: "#071725",
    gridB: "#081c2b",
    blue: "#0a4acb",
    blueBright: "#1688ff",
    green: "#39e96b",
    greenDark: "#139947",
    yellow: "#ffe24a",
    white: "#fffdf4",
  };

  const pixel = (x, y, color, width = 1, height = 1) => {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  };

  context.imageSmoothingEnabled = false;
  context.fillStyle = colors.background;
  context.fillRect(0, 0, 64, 64);

  for (let y = 0; y < 64; y += 2) {
    for (let x = 0; x < 64; x += 2) {
      pixel(x, y, (x + y) % 4 === 0 ? colors.gridA : colors.gridB);
    }
  }

  const bluePixels = [
    [7, 37, 3, 3], [10, 31, 4, 4], [13, 25, 4, 4], [17, 20, 5, 5], [22, 16, 5, 4],
    [27, 14, 6, 4], [33, 16, 5, 4], [38, 20, 5, 4], [43, 25, 5, 5], [48, 31, 4, 4],
    [51, 37, 3, 3], [12, 43, 4, 3], [17, 47, 5, 3], [23, 50, 5, 3], [30, 52, 6, 3],
    [37, 50, 5, 3], [43, 47, 5, 3], [49, 43, 4, 3],
  ];
  bluePixels.forEach(([x, y, w, h], index) => pixel(x, y, index % 3 === 0 ? colors.blueBright : colors.blue, w, h));

  const leafPixels = [
    [18, 38, 4, 5], [20, 33, 4, 5], [22, 28, 5, 5], [25, 24, 5, 5], [29, 21, 5, 5],
    [34, 24, 5, 5], [38, 28, 5, 5], [42, 33, 4, 5], [44, 38, 4, 5],
    [25, 42, 5, 5], [29, 46, 5, 5], [34, 43, 5, 5], [38, 40, 5, 5],
  ];
  leafPixels.forEach(([x, y, w, h], index) => pixel(x, y, index % 4 === 0 ? colors.greenDark : colors.green, w, h));

  pixel(25, 31, colors.yellow, 15, 13);
  pixel(28, 28, colors.yellow, 9, 4);
  pixel(29, 34, "#ffc61c", 7, 7);
  pixel(31, 35, colors.background, 4, 4);

  [[4, 12], [9, 7], [15, 12], [47, 10], [54, 16], [58, 8], [8, 53], [53, 51]].forEach(([x, y], index) => {
    pixel(x, y, index % 3 === 0 ? colors.yellow : colors.white, 1 + (index % 2), 1 + (index % 2));
  });

  const paintTrail = [
    [14, 43], [16, 41], [18, 39], [20, 37], [22, 35], [24, 33], [26, 31], [28, 29],
    [38, 38], [40, 36], [42, 34], [44, 32], [46, 30], [48, 28],
  ];
  let trailIndex = 0;
  window.setInterval(() => {
    const [x, y] = paintTrail[trailIndex % paintTrail.length];
    pixel(x, y, trailIndex % 4 === 0 ? colors.yellow : colors.green, 2, 2);
    trailIndex += 1;
  }, 280);
}

async function loadTheme(day) {
  const title = $(".canvas-title strong");
  if (!title) return;
  try {
    const response = await fetch(`${BASEPAINT_URL}/api/theme/${day}`, { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const payload = await response.json();
    const theme = String(payload?.theme || payload?.name || "").trim();
    if (theme) title.textContent = theme.slice(0, 34).toUpperCase();
  } catch {}
}

function signalChip(label, active) {
  const chip = document.createElement("span");
  chip.textContent = label;
  if (active) chip.classList.add("signal-on");
  return chip;
}

function roomCard(artist) {
  const article = document.createElement("article");
  article.className = "room-card";

  const avatar = document.createElement("span");
  avatar.className = "room-avatar";
  avatar.textContent = initials(artist.displayName || artist.address);

  const copy = document.createElement("div");
  const kicker = document.createElement("small");
  kicker.textContent = `LIVE · ${Number(artist.observerCount || 0)} ${plural(artist.observerCount || 0, "VIEWER")}`;
  const name = document.createElement("h3");
  name.textContent = String(artist.displayName || shortAddress(artist.address) || "BasePaint artist");
  const address = document.createElement("p");
  address.textContent = `${shortAddress(artist.address)} · DAY ${Number(artist.day || currentDay())}`;
  copy.append(kicker, name, address);

  const signals = document.createElement("div");
  signals.className = "room-signals";
  signals.append(
    signalChip("SCREEN", artist.screenPublished),
    signalChip("CAMERA", artist.cameraPublished),
    signalChip("MIC", artist.microphonePublished),
    signalChip("BRUSH ✓", true),
  );

  article.append(avatar, copy, signals);
  return article;
}

function emptyRoomCard() {
  const article = document.createElement("article");
  article.className = "room-card room-card-empty";
  const avatar = document.createElement("span");
  avatar.className = "room-avatar";
  avatar.textContent = "+";
  const copy = document.createElement("div");
  const kicker = document.createElement("small");
  kicker.textContent = "THE STAGE IS OPEN";
  const title = document.createElement("h3");
  title.textContent = "Be the first artist live";
  const note = document.createElement("p");
  note.textContent = "Open BasePaint, choose Streaming, connect the canvas wallet, and start a verified room.";
  copy.append(kicker, title, note);
  article.append(avatar, copy);
  return article;
}

function updateGlobalStatus(artists, failed = false) {
  const status = $("#global-status");
  if (!status) return;
  status.classList.toggle("is-error", failed);
  status.classList.toggle("is-idle", !failed && artists.length === 0);
  const label = $("span", status);
  if (failed) label.textContent = "Signal unavailable";
  else if (!artists.length) label.textContent = "Stage is open";
  else label.textContent = `${artists.length} ${plural(artists.length, "artist")} live`;
}

async function refreshLiveStatus() {
  const button = $("#refresh-live");
  const grid = $("#live-room-grid");
  const count = $("#live-count");
  const label = $("#live-label");
  const viewers = $("#live-viewers");
  if (!grid || !count || !label || !viewers) return;

  button?.classList.add("is-loading");
  if (button) button.textContent = "READING SIGNAL...";

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(`${LIVE_STATUS_URL}?day=${currentDay()}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Live status ${response.status}`);
    const payload = await response.json();
    const artists = Array.isArray(payload?.liveArtists) ? payload.liveArtists : [];
    const observerCount = artists.reduce((total, artist) => total + Number(artist.observerCount || 0), 0);

    count.textContent = String(artists.length);
    label.textContent = artists.length
      ? `${artists.length} verified ${plural(artists.length, "artist")} live`
      : "No artists live right now";
    viewers.textContent = artists.length
      ? `${observerCount} ${plural(observerCount, "viewer")} across active rooms`
      : "The next verified broadcast will appear here automatically.";

    grid.replaceChildren(...(artists.length ? artists.slice(0, 6).map(roomCard) : [emptyRoomCard()]));
    updateGlobalStatus(artists);
  } catch {
    count.textContent = "!";
    label.textContent = "Live signal is taking a moment";
    viewers.textContent = "The extension and BasePaint remain available while status reconnects.";
    grid.replaceChildren(emptyRoomCard());
    updateGlobalStatus([], true);
  } finally {
    window.clearTimeout(timeout);
    button?.classList.remove("is-loading");
    if (button) button.textContent = "REFRESH SIGNAL ↻";
  }
}

function init() {
  const day = currentDay();
  const dayLabel = $("#demo-day");
  if (dayLabel) dayLabel.textContent = String(day);
  const year = $("#year");
  if (year) year.textContent = String(new Date().getFullYear());

  setupNavigation();
  setupReveals();
  setupModeSwitch();
  drawDemoCanvas();
  loadTheme(day);
  refreshLiveStatus();

  $("#refresh-live")?.addEventListener("click", refreshLiveStatus);
  window.setInterval(refreshLiveStatus, 30000);
}

init();
