/* Hypothetical weather downscaling.
   Takes the coarse open-forecast wind at a facility and refines it to a ~3 m grid with a reduced-order model:
   potential flow around obstacles + wake deficits + correlated ABL turbulence.
   Illustrative only; it stands in for a GPU LES/CFD stage and is not validated. */
(function () {
  "use strict";
  window.addEventListener("twin:ready", (e) => init(e.detail));

  function init(api) {
    const { viewer, Cesium: C, SITES, grid, getWx, getHour } = api;
    const $ = (s) => document.querySelector(s);
    const group = $("#res-group");
    const seg = $("#res-mode");
    const note = $("#res-note");
    const overlay = $("#ds-overlay");
    const stats = $("#ds-stats");
    const whatif = $("#whatif");
    const windLayer = document.querySelector('[data-layer="wind"]');
    const wiSpd = $("#wi-spd");
    const wiDir = $("#wi-dir");
    const boxCtl = $("#ds-box");
    const sizeEl = $("#ds-size");
    const threeD = $("#ds-3d");
    const pinBtn = $("#ds-pin");
    if (!group || !seg || !boxCtl) return;

    const N = 200;
    const NU = 120; // raster size for the upper (3D) layers
    const SIZES = [150, 300, 600, 1200, 2400, 5000, 10000, 25000, 50000];
    // Obstacles for known facilities, in metres east/north of each facility's SITES point.
    const OBS = {
      vab: [{ x: 0, y: 0, R: 108, H: 160, hx: 96, hy: 121 }],
      warehouse: [{ x: 0, y: 0, R: 110, H: 12, hx: 80, hy: 79 }],
      lc39a: [{ x: 0, y: 0, R: 6.5, H: 100 }, { x: -36, y: -9, R: 11, H: 100, hx: 6.5, hy: 11 }],
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
    let cur = null; // active box: { lat, lon, L, zs, obs }
    let field = null;
    let U0 = 0;
    let vmax = 10;
    let lastBuild = 0;
    let buildTimer = null;
    let TL = 4; // time-lapse factor for tracer motion (set per build)
    let sizeSel = "auto";
    let pinned = false;
    let show3D = true;
    let valid = false;

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

    /* ---------- coarse forecast at any point (bilinear in the 5x5 grid, whichever region it is pointed at) ---------- */
    function coarseAt(lat, lon, h) {
      const wx = getWx();
      const lat0 = grid[0].lat;
      const lon0 = grid[0].lon;
      const step = grid[1].lon - grid[0].lon;
      const fy = Math.max(0, Math.min(3.999, (lat - lat0) / step));
      const fx = Math.max(0, Math.min(3.999, (lon - lon0) / step));
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
    // Forecast data only exists inside the active 5x5 grid (plus a margin).
    function inRegion(lat, lon) {
      const step = grid[1].lon - grid[0].lon;
      const m = 1.2 * step;
      return lat > grid[0].lat - m && lat < grid[24].lat + m && lon > grid[0].lon - m && lon < grid[24].lon + m;
    }

    /* ---------- reduced-order downscaling model (3D: speed depends on height z) ---------- */
    function makeField(ux, uy, obs) {
      const U = Math.max(0.3, Math.hypot(ux, uy));
      const d = { x: ux / U, y: uy / U };
      const p = { x: -d.y, y: d.x };
      return function (x, y, t, z) {
        z = z || 2;
        const g = Math.pow(Math.max(z, 2) / 10, 0.14); // 10 m forecast wind -> wind at height z (~0.8 at 2 m)
        let vx = ux * g;
        let vy = uy * g;
        let wake = 0;
        let lift = 0;
        for (const o of obs) {
          const rx = x - o.x;
          const ry = y - o.y;
          const inside = o.hx ? Math.abs(rx) < o.hx && Math.abs(ry) < o.hy : rx * rx + ry * ry < o.R * o.R;
          const above = z >= o.H;
          if (inside) {
            if (!above) return null; // inside the structure
            lift += 0.25 * Math.exp(-(z - o.H) / (0.35 * o.H)); // speed-up over the roof
            continue;
          }
          const kk = above ? Math.exp(-(z - o.H) / (0.6 * o.H)) : 1; // building influence fades above its height
          const s = rx * d.x + ry * d.y;
          const tt = rx * p.x + ry * p.y;
          const r2 = Math.max(s * s + tt * tt, o.R * o.R);
          const r4 = r2 * r2;
          const us = -U * g * ((o.R * o.R * (s * s - tt * tt)) / r4) * kk;
          const ut = ((-U * g * o.R * o.R * 2 * s * tt) / r4) * kk;
          vx += us * d.x + ut * p.x;
          vy += us * d.y + ut * p.y;
          if (s > 0) {
            const w = o.R * (1 + (0.15 * s) / o.R);
            wake += 0.75 * kk * Math.exp(-((tt / w) ** 2)) * Math.exp(-s / (8 * o.R));
          }
        }
        const wk = Math.min(0.85, wake);
        vx *= (1 - wk) * (1 + lift);
        vy *= (1 - wk) * (1 + lift);
        const ti = 0.12 + 0.5 * wk + 0.25 * lift;
        let n1 = 0;
        let n2 = 0;
        for (const c of comps) {
          const arg = c.kx * (x - ux * t) + c.ky * (y - uy * t) + c.w * t + z * 0.02;
          n1 += c.a * Math.sin(arg + c.p1);
          n2 += c.a * Math.sin(arg + c.p2);
        }
        vx += ((ti * U * g * n1) / compSum) * 2.2;
        vy += ((ti * U * g * n2) / compSum) * 2.2;
        return { vx, vy, s: Math.hypot(vx, vy), wk };
      };
    }

    /* ---------- scene objects ---------- */
    const MAXZ = 5;
    const slices = [];
    for (let k = 0; k < MAXZ; k++) {
      slices.push({
        rect: viewer.entities.add({
          show: false,
          rectangle: { coordinates: C.Rectangle.fromDegrees(0, 0, 0.0001, 0.0001), material: C.Color.TRANSPARENT, height: 0.6 },
        }),
        label: viewer.entities.add({
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
            horizontalOrigin: C.HorizontalOrigin.LEFT,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      });
    }
    const outlineEnt = viewer.entities.add({
      show: false,
      polyline: { positions: [], width: 2, material: new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString("#41b7e3"), dashLength: 12 }), clampToGround: true },
    });
    const pts = viewer.scene.primitives.add(new C.PointPrimitiveCollection());
    pts.show = false;
    const TR = 180;
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
      tracers.push({ x: 0, y: 0, z: 5, age: 0, life: 6, hist: [], pr, hAcc: 0 });
    }

    const offsetLL = (lat, lon, east, north) => [lat + north / 111320, lon + east / (111320 * Math.cos((lat * Math.PI) / 180))];
    function spawn(tr, scatter) {
      const half = cur.L / 2;
      const U = Math.max(0.3, Math.hypot(field.ux, field.uy));
      const d = { x: field.ux / U, y: field.uy / U };
      const p = { x: -d.y, y: d.x };
      const a = scatter ? (rand() * 2 - 1) * half : -half * 0.98;
      const b = (rand() * 2 - 1) * half;
      tr.x = d.x * a + p.x * b;
      tr.y = d.y * a + p.y * b;
      tr.z = Math.max(4, cur.zs[Math.floor(rand() * cur.zs.length)]);
      tr.age = scatter ? rand() * 12 : 0;
      tr.life = 14 + rand() * 10;
      tr.hist = [];
      tr.hAcc = 0;
    }

    /* ---------- choose the box: auto follows the view; a fixed size or pinned box stays put ---------- */
    const nice = (v) => (v < 20 ? Math.round(v) : v < 200 ? Math.round(v / 5) * 5 : Math.round(v / 50) * 50);
    const getRegion = () => (api.getRegion ? api.getRegion() : "ksc");
    const fmtL = (L) => (L >= 1000 ? L / 1000 + " km" : L + " m");
    function viewCenter() {
      const cam = viewer.camera;
      const sc = viewer.scene;
      const cv = sc.canvas;
      let cart = cam.pickEllipsoid(new C.Cartesian2(cv.clientWidth / 2, cv.clientHeight / 2), sc.globe.ellipsoid);
      let range;
      if (cart) range = C.Cartesian3.distance(cam.positionWC, cart);
      else {
        cart = C.Cartesian3.fromRadians(cam.positionCartographic.longitude, cam.positionCartographic.latitude, 0);
        range = cam.positionCartographic.height;
      }
      const cg = C.Cartographic.fromCartesian(cart);
      return { lat: C.Math.toDegrees(cg.latitude), lon: C.Math.toDegrees(cg.longitude), range };
    }
    function levels(L, obs) {
      if (!show3D) return [2];
      const Hm = obs.reduce((m, o) => Math.max(m, o.H), 0);
      const z = Hm > 0 ? [2, 0.5 * Hm, 1.15 * Hm, 1.8 * Hm] : L <= 600 ? [2, 20, 60] : L <= 2400 ? [2, 50, 150] : [2, L * 0.04, L * 0.12];
      return z.map(nice);
    }
    function obsFor(c, L) {
      const out = [];
      for (const k of Object.keys(OBS)) {
        const S = SITES[k];
        const dx = (S.lon - c.lon) * 111320 * Math.cos((c.lat * Math.PI) / 180);
        const dy = (S.lat - c.lat) * 111320;
        if (Math.abs(dx) < L / 2 + 120 && Math.abs(dy) < L / 2 + 120) OBS[k].forEach((o) => out.push({ ...o, x: o.x + dx, y: o.y + dy }));
      }
      return out;
    }
    function chooseBox() {
      let c;
      let L;
      if (pinned && cur) {
        c = { lat: cur.lat, lon: cur.lon };
        L = sizeSel === "auto" ? cur.L : parseInt(sizeSel, 10);
      } else {
        const v = viewCenter();
        c = { lat: v.lat, lon: v.lon };
        L = sizeSel === "auto" ? SIZES.find((s) => s >= v.range * 0.55) || SIZES[SIZES.length - 1] : parseInt(sizeSel, 10);
        // snap onto a facility so its buildings sit in the middle of the box
        for (const k of Object.keys(OBS)) {
          const S = SITES[k];
          const d = Math.hypot((S.lon - c.lon) * 111320 * Math.cos((c.lat * Math.PI) / 180), (S.lat - c.lat) * 111320);
          if (d < 0.35 * L) {
            c = { lat: S.lat, lon: S.lon };
            break;
          }
        }
      }
      const obs = obsFor(c, L);
      return { lat: c.lat, lon: c.lon, L, obs, zs: levels(L, obs) };
    }
    function placeName(c) {
      if (getRegion() === "hormuz") return "Strait of Hormuz";
      for (const k of Object.keys(OBS)) {
        const S = SITES[k];
        if (Math.hypot((S.lon - c.lon) * 98000, (S.lat - c.lat) * 111000) < c.L * 0.6) return S.name;
      }
      return "Kennedy Space Center area";
    }

    function setShown(v) {
      valid = v;
      const on = v && mode === "fine";
      slices.forEach((sl, k) => {
        const act = on && cur && k < cur.zs.length;
        sl.rect.show = !!act;
        sl.label.show = !!act && cur.zs.length > 1;
      });
      outlineEnt.show = on;
      pts.show = on;
      overlay.hidden = !on;
      stats.hidden = !on;
      whatif.hidden = !on;
    }

    /* ---------- build the downscaled field + rasters for the active box ---------- */
    function build(force) {
      lastBuild = performance.now();
      const wx = getWx();
      if (mode !== "fine" || !wx || (windLayer && !windLayer.checked)) return;
      const box = chooseBox();
      if (!inRegion(box.lat, box.lon)) {
        cur = cur || box;
        setShown(false);
        note.textContent = "No forecast data at this spot: weather covers the Kennedy Space Center area and the Strait of Hormuz. Move the view there to use building-scale weather.";
        return;
      }
      if (!force && cur && valid && box.L === cur.L && Math.hypot((box.lat - cur.lat) * 111320, (box.lon - cur.lon) * 98000) < 0.12 * box.L) return;
      cur = box;
      setNote();
      const h = getHour();
      let cw = coarseAt(cur.lat, cur.lon, h);
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
      const f = makeField(cw.ux, cw.uy, cur.obs);
      field = { f, ux: cw.ux, uy: cw.uy };
      U0 = Math.max(0.3, Math.hypot(cw.ux, cw.uy));
      vmax = Math.max(6, 2.2 * U0 * Math.pow(Math.max(...cur.zs, 10) / 10, 0.14));
      const half = cur.L / 2;
      const [la1, lo1] = offsetLL(cur.lat, cur.lon, -half, -half);
      const [la2, lo2] = offsetLL(cur.lat, cur.lon, half, half);
      const rc = C.Rectangle.fromDegrees(lo1, la1, lo2, la2);
      const levelStats = [];
      let groundMean = 0;
      let peak = 0;
      let sheltered = 0;
      let gcount = 0;
      cur.zs.forEach((z, k) => {
        const n = k === 0 ? N : NU;
        const cell = cur.L / n;
        const canvas = document.createElement("canvas");
        canvas.width = n;
        canvas.height = n;
        const ctx = canvas.getContext("2d");
        const img = ctx.createImageData(n, n);
        const vals = [];
        let sum = 0;
        let count = 0;
        for (let r = 0; r < n; r++) {
          const y = half - (r + 0.5) * cell;
          for (let c = 0; c < n; c++) {
            const x = -half + (c + 0.5) * cell;
            const v = f(x, y, 0, z);
            const o = (r * n + c) * 4;
            if (!v) {
              img.data[o + 3] = 0;
              continue;
            }
            const rgb = ramp(v.s / vmax);
            img.data[o] = rgb[0];
            img.data[o + 1] = rgb[1];
            img.data[o + 2] = rgb[2];
            img.data[o + 3] = k === 0 ? 205 : 120;
            sum += v.s;
            count++;
            if (k === 0) {
              vals.push(v.s);
              if (v.s < 0.5 * U0) sheltered++;
            }
          }
        }
        ctx.putImageData(img, 0, 0);
        const mean = count ? sum / count : 0;
        levelStats.push([z, mean]);
        if (k === 0) {
          vals.sort((a, b) => a - b);
          peak = vals.length ? vals[Math.floor(vals.length * 0.995)] : 0;
          groundMean = mean;
          gcount = count;
        }
        const sl = slices[k];
        sl.rect.rectangle.coordinates = rc;
        sl.rect.rectangle.height = Math.max(z, 0.6);
        sl.rect.rectangle.material = new C.ImageMaterialProperty({ image: canvas, transparent: true });
        sl.label.position = C.Cartesian3.fromDegrees(lo2, la2, Math.max(z, 0.6));
        sl.label.label.text = (z <= 2 ? "ground (2 m)" : "z = " + z + " m") + " · " + cell.toFixed(1) + " m cells";
        sl.label.label.distanceDisplayCondition = new C.DistanceDisplayCondition(0, Math.max(6000, cur.L * 4));
      });
      outlineEnt.polyline.positions = C.Cartesian3.fromDegreesArray([lo1, la1, lo2, la1, lo2, la2, lo1, la2, lo1, la1]);
      TL = Math.max(3, Math.min(80, cur.L / (14 * U0 * 0.8)));
      tracers.forEach((t) => spawn(t, true));
      setShown(true);

      // legend + stats
      const cell0 = cur.L / N;
      $("#ds-min-val").textContent = "0";
      $("#ds-mid").textContent = (vmax / 2).toFixed(0);
      $("#ds-max").textContent = vmax.toFixed(0);
      const dir = Math.round((Math.atan2(-cw.ux, -cw.uy) * 180) / Math.PI + 360) % 360;
      stats.innerHTML =
        '<div class="ds-h">Downscaled &middot; ' + placeName(cur) + "</div>" +
        '<div class="ds-row"><span>' + (whatIf ? "What-if wind" : "Forecast cell") + "</span><b>" + U0.toFixed(1) + " m/s @ " + dir + "&deg;</b></div>" +
        '<div class="ds-row"><span>Local mean (2 m)</span><b>' + groundMean.toFixed(1) + " m/s</b></div>" +
        '<div class="ds-row"><span>Peak local wind (2 m)</span><b>' + peak.toFixed(1) + " m/s</b></div>" +
        (levelStats.length > 1
          ? '<div class="ds-row"><span>Mean by height</span><b>' + levelStats.map(([z, m]) => (z <= 2 ? "2" : z) + " m " + m.toFixed(1)).join(" · ") + "</b></div>"
          : "") +
        '<div class="ds-row"><span>' + (whatIf ? "Assumed gust" : "Forecast gust") + "</span><b>" + cw.gust.toFixed(1) + " m/s</b></div>" +
        '<div class="ds-row"><span>Sheltered area (2 m)</span><b>' + Math.round((100 * sheltered) / Math.max(1, gcount)) + "% of box</b></div>" +
        '<div class="ds-row"><span>Box</span><b>' + fmtL(cur.L) + " @ " + cell0.toFixed(1) + " m cells" + (pinned ? " · pinned" : sizeSel === "auto" ? " · auto" : "") + "</b></div>";
    }
    const scheduleBuild = (force) => {
      clearTimeout(buildTimer);
      buildTimer = setTimeout(() => build(force !== false), Math.max(0, 160 - (performance.now() - lastBuild)));
    };

    /* ---------- mode / visibility ---------- */
    function setNote() {
      note.textContent =
        mode === "fine"
          ? "Hypothetical: the open forecast is refined to a box around the view (auto) or a size you pick, with simplified building flow and wakes. Layers stack from ground level up over buildings."
          : "Open-model forecast on " + (getRegion() === "hormuz" ? "~55" : "~7") + " km cells. Tile color shows wind speed; arrows show direction. Switch to Building-scale for a local box around the view.";
    }
    function apply() {
      group.hidden = false;
      const on = mode === "fine" && !!getWx() && (!windLayer || windLayer.checked);
      boxCtl.hidden = !on;
      seg.querySelectorAll("button").forEach((b) => {
        const act = b.dataset.res === mode;
        b.classList.toggle("is-on", act);
        b.setAttribute("aria-pressed", String(act));
      });
      setNote();
      const gridKey = $("#wx-grid-key");
      if (gridKey) gridKey.hidden = mode !== "coarse";
      if (!on) setShown(false);
      window.dispatchEvent(new CustomEvent("twin:resolution", { detail: mode }));
      if (on) build(true);
    }
    if (windLayer) windLayer.addEventListener("change", apply);
    seg.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-res]");
      if (!b) return;
      mode = b.dataset.res;
      apply();
    });
    if (sizeEl)
      sizeEl.addEventListener("change", () => {
        sizeSel = sizeEl.value;
        if (mode === "fine") build(true);
      });
    if (threeD)
      threeD.addEventListener("change", () => {
        show3D = threeD.checked;
        if (mode === "fine") build(true);
      });
    if (pinBtn)
      pinBtn.addEventListener("click", () => {
        pinned = !pinned;
        pinBtn.setAttribute("aria-pressed", String(pinned));
        pinBtn.textContent = pinned ? "Box pinned: release" : "Pin box here";
        if (mode === "fine") build(true);
      });
    [wiSpd, wiDir].forEach((el) =>
      el.addEventListener("input", () => {
        if (el === wiSpd && parseInt(wiSpd.value, 10) > 0 && wiDir.disabled) {
          const cw0 = cur ? coarseAt(cur.lat, cur.lon, getHour()) : coarseAt(SITES.vab.lat, SITES.vab.lon, getHour());
          const deg = (Math.atan2(-cw0.ux, -cw0.uy) * 180) / Math.PI;
          wiDir.value = String((Math.round(deg / 5) * 5 + 360) % 360);
        }
        if (mode === "fine") scheduleBuild(true);
      })
    );
    window.addEventListener("twin:update", () => {
      if (mode === "fine") scheduleBuild(true);
    });
    window.addEventListener("twin:site", () => {
      if (mode === "fine" && !pinned) scheduleBuild(true);
    });
    window.addEventListener("twin:scenario", () => {
      if (mode === "fine") scheduleBuild(true);
    });
    // the auto box follows the camera once it settles
    viewer.camera.moveEnd.addEventListener(() => {
      if (mode === "fine" && !pinned) scheduleBuild(false);
    });

    /* ---------- tracer animation ---------- */
    let tPrev = performance.now() / 1000;
    viewer.scene.preRender.addEventListener(() => {
      const now = performance.now() / 1000;
      const dt = Math.min(0.1, now - tPrev);
      tPrev = now;
      if (!pts.show || !field || !cur) return;
      const half = cur.L / 2;
      for (const tr of tracers) {
        const v = field.f(tr.x, tr.y, now, tr.z);
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
          const [la, lo] = offsetLL(cur.lat, cur.lon, q[0], q[1]);
          tr.pr[k].position = C.Cartesian3.fromDegrees(lo, la, tr.z);
        }
      }
    });

    const dsMin = $("#ds-min");
    if (dsMin) {
      const set = (on) => {
        overlay.classList.toggle("is-min", on);
        dsMin.setAttribute("aria-expanded", String(!on));
        dsMin.textContent = on ? "+" : "−";
        dsMin.title = on ? "Expand" : "Minimize";
      };
      dsMin.addEventListener("click", () => set(!overlay.classList.contains("is-min")));
      if (window.matchMedia("(max-width: 760px)").matches) set(true);
    }
    apply();
  }
})();
