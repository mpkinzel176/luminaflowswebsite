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
