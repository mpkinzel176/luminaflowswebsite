/* Platform visuals: compare slider, resolution grid, road-health trace */
(function () {
  const NS = "http://www.w3.org/2000/svg";

  // Traffic scenario compare slider
  const cmp = document.querySelector("#cmp");
  if (cmp) {
    const top = document.querySelector("#compare .top");
    const handle = document.querySelector("#compare .handle");
    cmp.addEventListener("input", () => {
      top.style.clipPath = "inset(0 " + (100 - cmp.value) + "% 0 0)";
      handle.style.left = cmp.value + "%";
    });
  }

  // Fine-resolution wind field (deterministic pseudo-noise)
  const fine = document.querySelector("#fine");
  if (fine) {
    const n = 20;
    const size = 192 / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v =
          0.5 +
          0.28 * Math.sin(i * 0.7 + j * 0.3) * Math.cos(j * 0.55 - i * 0.2) +
          0.22 * Math.sin(i * 1.9) * Math.sin(j * 1.3 + 1);
        const r = document.createElementNS(NS, "rect");
        r.setAttribute("x", 4 + i * size);
        r.setAttribute("y", 4 + j * size);
        r.setAttribute("width", size);
        r.setAttribute("height", size);
        r.setAttribute("fill", "hsl(" + (205 - v * 60) + " 75% " + (28 + v * 32) + "%)");
        fine.appendChild(r);
      }
    }
  }

  // Road-health acceleration trace (illustrative)
  const path = document.querySelector("#trace-path");
  if (!path) return;
  const flag = document.querySelector("#trace-flag");
  const status = document.querySelector("#trace-status");
  const btn = document.querySelector("#trace-replay");
  const X = (t) => 44 + (t / 8) * 466;
  const Y = (a) => 190 - ((a - 6) / 9) * 170;
  const pts = [];
  for (let t = 0; t <= 8.001; t += 0.05) {
    let a = 9.8 + 0.25 * Math.sin(t * 9) + 0.15 * Math.sin(t * 23);
    const d = t - 4.2;
    a += 2.6 * Math.exp(-(d * d) / 0.02) + 1.0 * Math.exp(-(d * d) / 0.012) * Math.cos(d * 22);
    pts.push([X(t), Y(a), t, a]);
  }
  path.setAttribute("d", pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(""));
  const peak = pts.reduce((m, p) => (p[3] > m[3] ? p : m));
  flag.setAttribute("transform", "translate(" + peak[0] + " " + peak[1] + ")");
  const len = path.getTotalLength();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DUR = 4500;
  let timers = [];

  function finish() {
    flag.setAttribute("opacity", "1");
    path.style.strokeDashoffset = 0;
    status.textContent = "Peak " + peak[3].toFixed(1) + " m/s² · reported to command center";
  }

  function run() {
    timers.forEach(clearTimeout);
    flag.setAttribute("opacity", "0");
    status.textContent = "Monitoring…";
    if (reduced) return finish();
    path.style.transition = "none";
    path.style.strokeDasharray = len;
    path.style.strokeDashoffset = len;
    path.getBoundingClientRect();
    path.style.transition = "stroke-dashoffset " + DUR + "ms linear";
    path.style.strokeDashoffset = 0;
    timers = [setTimeout(finish, (peak[2] / 8) * DUR + 150)];
  }

  btn.addEventListener("click", run);
  const io = new IntersectionObserver((es) => {
    if (es[0].isIntersecting) {
      run();
      io.disconnect();
    }
  });
  io.observe(document.querySelector("#trace"));
})();

/* Rocket CFD video: play when visible, respect reduced motion */
(function () {
  const v = document.querySelector("#rocket-video");
  const b = document.querySelector("#rocket-toggle");
  if (!v || !b) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let userPaused = reduced;
  const sync = () => {
    b.textContent = v.paused ? "Play" : "Pause";
    b.setAttribute("aria-pressed", String(!v.paused));
  };
  b.addEventListener("click", () => {
    if (v.paused) {
      userPaused = false;
      v.play().catch(() => {});
    } else {
      userPaused = true;
      v.pause();
    }
    sync();
  });
  v.addEventListener("play", sync);
  v.addEventListener("pause", sync);
  new IntersectionObserver((es) => {
    if (es[0].isIntersecting) {
      if (!userPaused) v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, { threshold: 0.35 }).observe(v);
  sync();
})();

/* ---------- Architecture: connectivity paths (auto failover demo) ---------- */
(function () {
  const svg = document.querySelector("#arch-svg");
  if (!svg) return;
  const tabs = document.querySelectorAll(".at");
  const out = document.querySelector("#arch-now-text");
  const NAMES = {
    cell: "Cell network (NB-IoT): used where there is cellular coverage, such as roads, cities and ports",
    sat: "Satellite relay (SATCOM): used at sea, in remote areas and during launch",
  };
  const ORDER = ["cell", "sat"];
  let mode = "auto";
  let idx = 0;
  let timer = null;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function show(path) {
    svg.dataset.active = path;
    out.textContent = (mode === "auto" ? "Auto failover → " : "") + NAMES[path];
  }
  function stop() {
    clearInterval(timer);
    timer = null;
  }
  function select(m) {
    mode = m;
    tabs.forEach((t) => t.classList.toggle("is-on", t.dataset.path === m));
    stop();
    if (m === "auto") {
      idx = 0;
      show(ORDER[0]);
      if (!reduced)
        timer = setInterval(() => {
          idx = (idx + 1) % ORDER.length;
          show(ORDER[idx]);
        }, 3600);
    } else show(m);
  }
  tabs.forEach((t) => t.addEventListener("click", () => select(t.dataset.path)));
  svg.querySelectorAll(".lnode").forEach((n) => {
    const m = n.classList.contains("lnode-rf") ? "rf" : n.classList.contains("lnode-cell") ? "cell" : "sat";
    n.addEventListener("mouseenter", () => {
      if (mode === "auto") {
        stop();
        show(m);
      }
    });
    n.addEventListener("mouseleave", () => {
      if (mode === "auto") select("auto");
    });
  });
  select("auto");
})();

/* ---------- Adaptive work tasking explainer ---------- */
(function () {
  const body = document.querySelector("#task-body");
  if (!body) return;
  const result = document.querySelector("#task-result");
  const CREW = [
    { who: "John", clear: { t: "Move active payload to launch pad", w: "Pad", out: true }, storm: { t: "Move stored pending payload to testing area", w: "Hangar", out: false, why: "Lightning within 5 nm: pad work on hold. Payload move rescheduled to 15:30." } },
    { who: "Jane", clear: { t: "Environmental inspection around launch pad", w: "Pad perimeter", out: true }, storm: { t: "Finish report for previous inspection", w: "Office", out: false, why: "Outdoor inspection paused. Report work keeps the day productive." } },
    { who: "Ana", clear: { t: "Fuel-line walkdown at the pad", w: "Pad", out: true }, storm: { t: "Review procedure checklist with the team", w: "Control room", out: false, why: "Fuel work near lightning is not permitted." } },
    { who: "Raj", clear: { t: "Check crane and ground equipment", w: "Pad", out: true }, storm: { t: "Calibrate sensors and LuminaBox units", w: "Lab", out: false, why: "Indoor task that needs doing anyway." } },
  ];
  let mode = "clear";
  function chip(cls, txt) {
    return '<span class="st-chip ' + cls + '">' + txt + "</span>";
  }
  function render(changed) {
    body.innerHTML = CREW.map((c) => {
      const s = c[mode];
      const old = c.clear;
      return (
        "<tr" + (changed ? ' class="changed"' : "") + "><td>" + c.who + "</td><td>" +
        (mode === "storm" ? '<span class="t-old">' + old.t + "</span>" : "") +
        s.t +
        (mode === "storm" ? '<span class="t-why">' + s.why + "</span>" : "") +
        '</td><td><span class="where ' + (s.out ? "out" : "in") + '">' + (s.out ? "OUTDOORS" : "INDOORS") + "</span> " + s.w + "</td><td>" +
        (mode === "storm" ? chip("moved", "REASSIGNED") : chip("ok", "ON SCHEDULE")) + "</td></tr>"
      );
    }).join("");
    result.className = "task-result" + (mode === "storm" ? " storm" : "");
    result.innerHTML =
      mode === "storm"
        ? "<b>Result:</b> 4 of 4 crew stay productive, 0 idle hours, 0 people outdoors during the lightning window. Pad work resumes after it clears."
        : "<b>Result:</b> 4 of 4 tasks on schedule. No weather impact in the forecast, so no changes are needed.";
  }
  document.querySelectorAll(".task-control [data-fc]").forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.fc;
      document.querySelectorAll(".task-control [data-fc]").forEach((x) => x.classList.toggle("is-on", x === b));
      render(true);
    })
  );
  render(false);
})();

/* ---------- Links from page technologies into the 3D model ---------- */
(function () {
  const frame = document.querySelector("#twin-frame");
  const query = (p) => {
    const q = new URLSearchParams();
    Object.keys(p).forEach((k) => q.set(k, p[k]));
    return q.toString();
  };
  if (frame) frame.addEventListener("load", () => (frame.dataset.ready = "1"));
  function go(btn) {
    let p;
    try {
      p = JSON.parse(btn.getAttribute("data-go"));
    } catch (e) {
      return;
    }
    // phones: the model opens as its own page
    if (!frame) {
      // other pages: go to the standalone model with this view
      location.href = "twin.html?" + query(p);
      return;
    }
    if (window.innerWidth < 760) {
      window.open("twin.html?" + query(p), "_blank");
      return;
    }
    const target = document.querySelector("#twin");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    const w = frame.contentWindow;
    if (frame.dataset.ready === "1" && w) {
      if (typeof w.twinGo === "function") w.twinGo(p);
      else w.__twinPending = p; // map still loading: applied as soon as it is ready
    } else {
      frame.src = "twin.html?embed=1&" + query(p);
    }
  }
  const open = document.querySelector("#twin-open");
  const copy = document.querySelector("#twin-copy");
  const note = document.querySelector("#twin-copied");
  const currentUrl = () => {
    const w = frame && frame.contentWindow;
    return w && typeof w.twinUrl === "function" ? w.twinUrl() : new URL("twin.html", location.href).toString();
  };
  if (open)
    open.addEventListener("click", (ev) => {
      ev.preventDefault();
      window.open(currentUrl(), "_blank", "noopener");
    });
  if (copy)
    copy.addEventListener("click", async () => {
      const url = currentUrl();
      try {
        await navigator.clipboard.writeText(url);
        if (note) {
          note.textContent = "Link copied";
          setTimeout(() => (note.textContent = ""), 2200);
        }
      } catch (e) {
        window.prompt("Copy this link:", url);
      }
    });
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-go]");
    if (b) go(b);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const b = ev.target.closest && ev.target.closest("[data-go][role='button']");
    if (b) {
      ev.preventDefault();
      go(b);
    }
  });
})();

/* Hero video: respect reduced motion, and stop playing when it is off screen */
(function () {
  const v = document.querySelector("#hero-video");
  if (!v) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    v.removeAttribute("autoplay");
    v.pause();
    return;
  }
  new IntersectionObserver((es) => {
    if (es[0].isIntersecting) v.play().catch(() => {});
    else v.pause();
  }, { threshold: 0.2 }).observe(v);
})();


/* ---------- What the data can tell you (concept) ---------- */
(function () {
  const out = document.querySelector("#ins-out");
  if (!out) return;
  const DATA = {
    acc: [
      ["Handling shocks", "How hard a container was dropped, bumped or slammed, and when."],
      ["Road damage", "Several boxes jolting at the same spot point to a pothole or broken pavement."],
      ["Vibration signature", "Truck, ship or rail transport has a different feel, and rough rides show up."],
      ["Tilt and orientation", "Whether a unit was tipped over or stored on its side."],
    ],
    gps: [
      ["Route and dwell time", "Where it went, how long it waited, and how far it is from where it should be."],
      ["Arrival estimates", "ETAs from real speeds instead of timetable guesses."],
      ["Geofences", "Alerts when a box enters or leaves a site."],
      ["Fewer GPS fixes", "The inertial sensor fills in between fixes so the GPS can sleep and the battery lasts longer."],
    ],
    env: [
      ["Temperature history", "A record of the temperatures the cargo actually saw, checked against its limits."],
      ["Humidity and condensation", "Combined readings show when moisture could form on sensitive hardware."],
      ["Weather exposure", "Pair with the forecast to see which boxes are about to meet bad conditions."],
      ["Storage conditions", "Compare one warehouse bay, trailer or ship hold with another."],
    ],
  };
  const btns = document.querySelectorAll(".ins-btn");
  function show(k) {
    btns.forEach((b) => {
      const on = b.dataset.ins === k;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", String(on));
    });
    out.innerHTML = DATA[k].map(([t, d]) => "<div class=\"ins-card\"><b>" + t + "</b><span>" + d + "</span></div>").join("");
  }
  btns.forEach((b) => b.addEventListener("click", () => show(b.dataset.ins)));
  show("acc");
})();
