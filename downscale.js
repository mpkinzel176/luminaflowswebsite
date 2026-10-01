/* Hypothetical weather downscaling.
   Takes the coarse open-forecast wind at a facility and refines it to a ~3 m grid with a reduced-order model:
   potential flow around obstacles + wake deficits + correlated ABL turbulence.
   Illustrative only; it stands in for a GPU LES/CFD stage and is not validated. */
(function () {
  "use strict";
  window.addEventListener("twin:ready", (e) => init(e.detail));

  function init(api) {
    const { viewer, Cesium: C, SITES, grid, getWx, getHour, getSelected } = api;
    const $ = (s) => document.querySelector(s);
    const group = $("#res-group");
    const seg = $("#res-mode");
    const note = $("#res-note");
    const overlay = $("#ds-overlay");
    const stats = $("#ds-stats");
    const whatif = $("#whatif");
    const wiSpd = $("#wi-spd");
    const wiDir = $("#wi-dir");
    if (!group || !seg) return;

    const N = 200;
    const DOMAINS = {
      vab: { L: 560, obs: [{ x: 0, y: 0, R: 94, H: 160, hx: 109, hy: 79 }] },
      lc39a: { L: 300, obs: [{ x: 0, y: 0, R: 6.5, H: 100 }, { x: 88, y: 44, R: 11, H: 100, hx: 9, hy: 9 }] },
      lc39b: { L: 300, obs: [{ x: 88, y: 44, R: 11, H: 100, hx: 9, hy: 9 }] },
      slc40: { L: 300, obs: [{ x: 88, y: 44, R: 11, H: 100, hx: 9, hy: 9 }] },
    };
    const STOPS = [
      [0, [11, 31, 51]],
      [0.25, [27, 95, 140]],
      [0.5, [65, 183, 227]],
      [0.75, [255, 223, 60]],
      [1, [255, 107, 91]],
    ];
    const ramp = (v) => {
      const t = Math.max(0, Math.min(1, v));
      for (let i = 1; i < STOPS.length; i++) {
        if (t <= STOPS[i][0]) {
          const [t0, c0] = STOPS[i - 1];
          const [t1, c1] = STOPS[i];
          const k = (t - t0) / (t1 - t0);
          return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
        }
      }
      return STOPS[STOPS.length - 1][1];
    };

    let mode = "coarse";
    let scn = "road";
    let site = null; // active domain key
    let field = null;
    let U0 = 0;
    let vmax = 10;
    let lastBuild = 0;
    let buildTimer = null;
    let TL = 4; // time-lapse factor for tracer motion (set per build)

    /* ---------- seeded turbulence components ---------- */
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const comps = [];
    for (let i = 0; i < 8; i++) {
      const lam = 22 + rand() * 120;
      const ang = (rand() - 0.5) * 1.6;
      comps.push({ kx: ((2 * Math.PI) / lam) * Math.cos(ang), ky: ((2 * Math.PI) / lam) * Math.sin(ang), w: 0.4 + rand() * 1.2, p1: rand() * 6.28, p2: rand() * 6.28, a: 0.5 + rand() * 0.5 });
    }
    const compSum = comps.reduce((a, c) => a + c.a, 0);

    /* ---------- coarse forecast at a site (bilinear in the 5x5 grid) ---------- */
    function coarseAt(key, h) {
      const wx = getWx();
      const s = SITES[key];
      const lat0 = grid[0].lat;
      const lon0 = grid[0].lon;
      const step = grid[1].lon - grid[0].lon;
      const fy = Math.max(0, Math.min(3.999, (s.lat - lat0) / step));
      const fx = Math.max(0, Math.min(3.999, (s.lon - lon0) / step));
      const i = Math.floor(fy);
      const j = Math.floor(fx);
      const ty = fy - i;
      const tx = fx - j;
      const at = (ii, jj) => {
        const p = wx.pts[ii * 5 + jj];
        const d = (p.dir[h] * Math.PI) / 180;
        return { e: -p.wind[h] * Math.sin(d), n: -p.wind[h] * Math.cos(d), g: p.gust[h] };
      };
      const mix = (k) => {
        const a = at(i, j)[k] * (1 - tx) + at(i, j + 1)[k] * tx;
        const b = at(i + 1, j)[k] * (1 - tx) + at(i + 1, j + 1)[k] * tx;
        return a * (1 - ty) + b * ty;
      };
      return { ux: mix("e"), uy: mix("n"), gust: mix("g") };
    }

    /* ---------- reduced-order downscaling model ---------- */
    function makeField(ux, uy, obs) {
      const U = Math.max(0.3, Math.hypot(ux, uy));
      const d = { x: ux / U, y: uy / U };
      const p = { x: -d.y, y: d.x };
      const ground = 0.8; // 10 m forecast wind -> ~2 m above ground
      return function (x, y, t) {
        let vx = ux * ground;
        let vy = uy * ground;
        let wake = 0;
        for (const o of obs) {
          const rx = x - o.x;
          const ry = y - o.y;
          if (o.hx ? Math.abs(rx) < o.hx && Math.abs(ry) < o.hy : rx * rx + ry * ry < o.R * o.R) return null;
          const s = rx * d.x + ry * d.y;
          const tt = rx * p.x + ry * p.y;
          const r2 = Math.max(s * s + tt * tt, o.R * o.R);
          const r4 = r2 * r2;
          const us = -U * ground * ((o.R * o.R * (s * s - tt * tt)) / r4);
          const ut = (-U * ground * o.R * o.R * 2 * s * tt) / r4;
          vx += us * d.x + ut * p.x;
          vy += us * d.y + ut * p.y;
          if (s > 0) {
            const w = o.R * (1 + (0.15 * s) / o.R);
            wake += 0.75 * Math.exp(-((tt / w) ** 2)) * Math.exp(-s / (8 * o.R));
          }
        }
        const wk = Math.min(0.85, wake);
        vx *= 1 - wk;
        vy *= 1 - wk;
        const ti = 0.12 + 0.5 * wk;
        let n1 = 0;
        let n2 = 0;
        for (const c of comps) {
          const arg = c.kx * (x - ux * t) + c.ky * (y - uy * t) + c.w * t;
          n1 += c.a * Math.sin(arg + c.p1);
          n2 += c.a * Math.sin(arg + c.p2);
        }
        vx += (ti * U * ground * n1) / compSum * 2.2;
        vy += (ti * U * ground * n2) / compSum * 2.2;
        return { vx, vy, s: Math.hypot(vx, vy), wk };
      };
    }

    /* ---------- scene objects ---------- */
    const rectEnt = viewer.entities.add({
      show: false,
      rectangle: { coordinates: C.Rectangle.fromDegrees(0, 0, 0.0001, 0.0001), material: C.Color.TRANSPARENT, height: 0.6 },
    });
    const outlineEnt = viewer.entities.add({
      show: false,
      polyline: { positions: [], width: 2, material: new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString("#41b7e3"), dashLength: 12 }), clampToGround: true },
    });
    const labelEnt = viewer.entities.add({
      show: false,
      position: C.Cartesian3.fromDegrees(0, 0, 0),
      label: {
        text: "",
        font: "600 11px ui-monospace, Consolas, monospace",
        fillColor: C.Color.WHITE,
        showBackground: true,
        backgroundColor: C.Color.fromCssColorString("#06121f").withAlpha(0.82),
        backgroundPadding: new C.Cartesian2(7, 4),
        verticalOrigin: C.VerticalOrigin.BOTTOM,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 6000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    const pts = viewer.scene.primitives.add(new C.PointPrimitiveCollection());
    pts.show = false;
    const TR = 140;
    const TRAIL = 4;
    const tracers = [];
    for (let i = 0; i < TR; i++) {
      const pr = [];
      for (let k = 0; k < TRAIL; k++) {
        pr.push(
          pts.add({
            position: C.Cartesian3.fromDegrees(0, 0, 0),
            pixelSize: [4.5, 3.8, 3, 2.2][k],
            color: C.Color.WHITE.withAlpha([0.95, 0.65, 0.4, 0.2][k]),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          })
        );
      }
      tracers.push({ x: 0, y: 0, age: 0, life: 6, hist: [], pr, hAcc: 0 });
    }

    const offsetLL = (lat, lon, east, north) => [lat + north / 111320, lon + east / (111320 * Math.cos((lat * Math.PI) / 180))];
    function spawn(tr, scatter) {
      const dom = DOMAINS[site];
      const half = dom.L / 2;
      const U = Math.max(0.3, Math.hypot(field.ux, field.uy));
      const d = { x: field.ux / U, y: field.uy / U };
      const p = { x: -d.y, y: d.x };
      const a = scatter ? (rand() * 2 - 1) * half : -half * 0.98;
      const b = (rand() * 2 - 1) * half;
      tr.x = d.x * a + p.x * b;
      tr.y = d.y * a + p.y * b;
      tr.age = scatter ? rand() * 12 : 0;
      tr.life = 14 + rand() * 10;
      tr.hist = [];
      tr.hAcc = 0;
    }

    /* ---------- build the downscaled field + raster for the active site ---------- */
    function build() {
      lastBuild = performance.now();
      const wx = getWx();
      if (!wx || !site) return;
      const key = site;
      const dom = DOMAINS[key];
      const S = SITES[key];
      const h = getHour();
      let cw = coarseAt(key, h);
      const forecastDir = Math.round((Math.atan2(-cw.ux, -cw.uy) * 180) / Math.PI + 360) % 360;
      const spdOv = parseInt(wiSpd.value, 10);
      const whatIf = spdOv > 0;
      if (whatIf) {
        const dr = (parseInt(wiDir.value, 10) * Math.PI) / 180;
        cw = { ux: -spdOv * Math.sin(dr), uy: -spdOv * Math.cos(dr), gust: spdOv * 1.5 };
      }
      $("#wi-spd-out").textContent = whatIf ? spdOv + " m/s" : "forecast";
      $("#wi-dir-out").textContent = whatIf ? wiDir.value + "°" : "forecast (" + forecastDir + "°)";
      wiDir.disabled = !whatIf;
      const f = makeField(cw.ux, cw.uy, dom.obs);
      field = { f, ux: cw.ux, uy: cw.uy };
      U0 = Math.max(0.3, Math.hypot(cw.ux, cw.uy));
      vmax = Math.max(6, 2.0 * U0);
      const half = dom.L / 2;
      const cell = dom.L / N;
      const canvas = document.createElement("canvas");
      canvas.width = N;
      canvas.height = N;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(N, N);
      const vals = [];
      let sheltered = 0;
      let count = 0;
      let sum = 0;
      for (let r = 0; r < N; r++) {
        const y = half - (r + 0.5) * cell;
        for (let c = 0; c < N; c++) {
          const x = -half + (c + 0.5) * cell;
          const v = f(x, y, 0);
          const o = (r * N + c) * 4;
          if (!v) {
            img.data[o + 3] = 0;
            continue;
          }
          const rgb = ramp(v.s / vmax);
          img.data[o] = rgb[0];
          img.data[o + 1] = rgb[1];
          img.data[o + 2] = rgb[2];
          img.data[o + 3] = 205;
          vals.push(v.s);
          sum += v.s;
          count++;
          if (v.s < 0.5 * U0) sheltered++;
        }
      }
      ctx.putImageData(img, 0, 0);
      vals.sort((a, b) => a - b);
      const peak = vals.length ? vals[Math.floor(vals.length * 0.995)] : 0;
      const mean = count ? sum / count : 0;
      const [la1, lo1] = offsetLL(S.lat, S.lon, -half, -half);
      const [la2, lo2] = offsetLL(S.lat, S.lon, half, half);
      rectEnt.rectangle.coordinates = C.Rectangle.fromDegrees(lo1, la1, lo2, la2);
      rectEnt.rectangle.material = new C.ImageMaterialProperty({ image: canvas, transparent: true });
      outlineEnt.polyline.positions = C.Cartesian3.fromDegreesArray([lo1, la1, lo2, la1, lo2, la2, lo1, la2, lo1, la1]);
      labelEnt.position = C.Cartesian3.fromDegrees(lo1, la2, 4);
      labelEnt.label.text = "Downscaled domain " + dom.L + " m · " + cell.toFixed(1) + " m cells";
      TL = Math.max(3, Math.min(80, dom.L / (14 * U0 * 0.8)));
      tracers.forEach((t) => spawn(t, true));

      // legend + stats
      $("#ds-min").textContent = "0";
      $("#ds-mid").textContent = (vmax / 2).toFixed(0);
      $("#ds-max").textContent = vmax.toFixed(0);
      const dir = Math.round((Math.atan2(-cw.ux, -cw.uy) * 180) / Math.PI + 360) % 360;
      stats.innerHTML =
        '<div class="ds-h">Downscaled &middot; ' + SITES[key].name + "</div>" +
        '<div class="ds-row"><span>' + (whatIf ? "What-if wind" : "Forecast cell") + "</span><b>" + U0.toFixed(1) + " m/s @ " + dir + "&deg;</b></div>" +
        '<div class="ds-row"><span>Local mean (2 m)</span><b>' + mean.toFixed(1) + " m/s</b></div>" +
        '<div class="ds-row"><span>Peak local wind</span><b>' + peak.toFixed(1) + " m/s</b></div>" +
        '<div class="ds-row"><span>' + (whatIf ? "Assumed gust" : "Forecast gust") + "</span><b>" + cw.gust.toFixed(1) + " m/s</b></div>" +
        '<div class="ds-row"><span>Sheltered area</span><b>' + Math.round((100 * sheltered) / Math.max(1, count)) + "% of domain</b></div>" +
        '<div class="ds-row"><span>Resolution</span><b>' + dom.L + " m @ " + cell.toFixed(1) + " m (target 1 ft)</b></div>";
    }
    const scheduleBuild = () => {
      clearTimeout(buildTimer);
      buildTimer = setTimeout(build, Math.max(0, 140 - (performance.now() - lastBuild)));
    };

    /* ---------- mode / visibility ---------- */
    function pickSite() {
      const sel = getSelected();
      site = DOMAINS[sel] ? sel : "vab";
    }
    function apply() {
      const weatherTab = scn === "road" || scn === "warehouse";
      group.hidden = !weatherTab;
      const on = mode === "fine" && weatherTab && !!getWx();
      rectEnt.show = on;
      outlineEnt.show = on;
      labelEnt.show = on;
      pts.show = on;
      overlay.hidden = !on;
      stats.hidden = !on;
      whatif.hidden = !on;
      seg.querySelectorAll("button").forEach((b) => {
        const act = b.dataset.res === mode;
        b.classList.toggle("is-on", act);
        b.setAttribute("aria-pressed", String(act));
      });
      note.textContent =
        mode === "fine"
          ? "Hypothetical: the forecast is refined to ~3 m cells around the facility (concept target: 1 ft), with flow around buildings, wakes, and turbulence."
          : "Open-model forecast cells, several km across. Winds are uniform across a facility.";
      if (on) {
        pickSite();
        build();
      }
    }
    seg.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-res]");
      if (!b) return;
      mode = b.dataset.res;
      if (mode === "fine" && getSelected() === "all") {
        const vabBtn = document.querySelector('.fac[data-site="vab"]');
        if (vabBtn) vabBtn.click();
      }
      apply();
    });
    [wiSpd, wiDir].forEach((el) =>
      el.addEventListener("input", () => {
        if (el === wiSpd && parseInt(wiSpd.value, 10) > 0 && wiDir.disabled) {
          const cw0 = coarseAt(site || "vab", getHour());
          wiDir.value = String(Math.round((Math.atan2(-cw0.ux, -cw0.uy) * 180) / Math.PI / 5) * 5 + (Math.atan2(-cw0.ux, -cw0.uy) < 0 ? 360 : 0)).replace(/^-/, "");
        }
        if (mode === "fine") scheduleBuild();
      })
    );
    window.addEventListener("twin:update", () => {
      if (mode === "fine" && (scn === "road" || scn === "warehouse")) {
        pickSite();
        scheduleBuild();
      }
    });
    window.addEventListener("twin:site", () => {
      if (mode === "fine") {
        pickSite();
        scheduleBuild();
      }
    });
    window.addEventListener("twin:scenario", (e) => {
      scn = e.detail;
      apply();
    });

    /* ---------- tracer animation ---------- */
    let tPrev = performance.now() / 1000;
    viewer.scene.preRender.addEventListener(() => {
      const now = performance.now() / 1000;
      const dt = Math.min(0.1, now - tPrev);
      tPrev = now;
      if (!pts.show || !field || !site) return;
      const dom = DOMAINS[site];
      const half = dom.L / 2;
      const S = SITES[site];
      for (const tr of tracers) {
        const v = field.f(tr.x, tr.y, now);
        tr.age += dt;
        if (!v || tr.age > tr.life || Math.abs(tr.x) > half || Math.abs(tr.y) > half) {
          spawn(tr, false);
          continue;
        }
        tr.x += v.vx * dt * TL;
        tr.y += v.vy * dt * TL;
        tr.hAcc += dt;
        if (tr.hAcc > 0.09) {
          tr.hAcc = 0;
          tr.hist.unshift([tr.x, tr.y]);
          if (tr.hist.length > TRAIL) tr.hist.pop();
        }
        for (let k = 0; k < TRAIL; k++) {
          const q = k === 0 ? [tr.x, tr.y] : tr.hist[k] || tr.hist[tr.hist.length - 1] || [tr.x, tr.y];
          const [la, lo] = offsetLL(S.lat, S.lon, q[0], q[1]);
          tr.pr[k].position = C.Cartesian3.fromDegrees(lo, la, 5);
        }
      }
    });

    apply();
  }
})();
