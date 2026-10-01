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
    rf: "Base station (site RF): lowest latency in range, used at warehouses, pads and ports",
    cell: "Cell network (LTE / 5G): public coverage along roads and around cities",
    sat: "Satellite relay (SATCOM): global coverage at sea, in remote areas and during launch",
  };
  const ORDER = ["rf", "cell", "sat"];
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
  function go(btn) {
    let p;
    try {
      p = JSON.parse(btn.getAttribute("data-go"));
    } catch (e) {
      return;
    }
    const target = document.querySelector("#twin-ui");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    if (typeof window.twinGo === "function") window.twinGo(p);
    else window.__twinPending = p; // applied when the 3D map finishes loading
  }
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
