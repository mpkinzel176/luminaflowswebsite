/* 3D digital twin: CesiumJS globe + Open-Meteo forecast + NOAA radar.
   Loads Cesium lazily when the section approaches the viewport. */
(function () {
  const root = document.querySelector("#twin-ui");
  if (!root) return;

  const CESIUM = "https://cdn.jsdelivr.net/npm/cesium@1.120.0/Build/Cesium/";
  const $ = (s) => document.querySelector(s);
  const box = $("#cesium");
  const loading = $("#cesium-loading");
  const hourInput = $("#hour");
  const hourOut = $("#hour-out");
  const playBtn = $("#play");
  const badge = $("#data-badge");
  const N = 48;

  /* ---------- Sites (approximate public coordinates) ---------- */
  const SITES = {
    all: { name: "Site overview", lat: 28.585, lon: -80.625, range: 38000, heading: 0, pitch: -48 },
    warehouse: { name: "KSC Logistics Facility", lat: 28.577009, lon: -80.652022, range: 850, heading: 10, pitch: -38 },
    vab: { name: "Vehicle Assembly Building", lat: 28.58561, lon: -80.65089, range: 1000, heading: -35, pitch: -28 },
    lc39a: { name: "Launch Complex 39A", lat: 28.60836, lon: -80.6041, range: 1200, heading: 215, pitch: -27 },
    lc39b: { name: "Launch Complex 39B", lat: 28.6272, lon: -80.6208, range: 1200, heading: 140, pitch: -27 },
    slc40: { name: "Space Launch Complex 40", lat: 28.5621, lon: -80.5772, range: 1200, heading: 300, pitch: -27 },
  };
  const CRAWLERWAY = [
    [28.5745, -80.648],
    [28.58, -80.63],
    [28.596, -80.619],
    [28.6084, -80.6043],
    [28.596, -80.619],
    [28.6272, -80.6208],
  ];

  /* ---------- Weather grid ---------- */
  // The 5x5 forecast grid is re-pointed in place per region (KSC / Strait of Hormuz).
  const GRIDS = {
    ksc: { lat0: 28.47, lon0: -80.77, step: 0.07, cellKm: 7 },
    hormuz: { lat0: 25.0, lon0: 55.4, step: 0.5, cellKm: 55 },
  };
  const HORMUZ_POINT = { name: "Strait of Hormuz", lat: 26.0, lon: 56.4 };
  const grid = [];
  let STEP = GRIDS.ksc.step;
  let region = "ksc";
  let scnId = "road";
  const wxStore = {};
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) grid.push({ lat: GRIDS.ksc.lat0 + i * STEP, lon: GRIDS.ksc.lon0 + j * STEP });
  }
  const gridPoints = (d) => {
    const out = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) out.push({ lat: d.lat0 + i * d.step, lon: d.lon0 + j * d.step });
    return out;
  };
  let wx = null; // { pts:[{wind,dir,gust,precip,temp,code,cloud}], start:Date, source }
  let hour = 0;
  let selected = "all";
  let viewer = null;
  let C = null;
  const arrows = [];
  const cells = [];
  const windCells = [];
  const layers = { wind: [], precip: [], cad: [], assets: [], rocket: [] };
  let forecastMode = "coarse";
  let radarLayer = null;

  const nearest = (lat, lon) => {
    let best = 0;
    let bd = Infinity;
    grid.forEach((g, i) => {
      const d = Math.hypot(g.lat - lat, (g.lon - lon) * 0.88);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  async function loadLive(def) {
    const gp = gridPoints(def || GRIDS.ksc);
    const url =
      "https://api.open-meteo.com/v1/forecast?latitude=" +
      gp.map((g) => g.lat.toFixed(3)).join(",") +
      "&longitude=" +
      gp.map((g) => g.lon.toFixed(3)).join(",") +
      "&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,temperature_2m,weather_code,cloud_cover" +
      "&wind_speed_unit=ms&forecast_days=3&timezone=UTC";
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error("HTTP " + r.status);
    let j = await r.json();
    if (!Array.isArray(j)) j = [j];
    const times = j[0].hourly.time.map((s) => Date.parse(s + "Z"));
    let s0 = times.findIndex((t2) => t2 >= Date.now() - 30 * 60 * 1000);
    if (s0 < 0) s0 = 0;
    const cut = (a) => a.slice(s0, s0 + N).map((v) => (v == null ? 0 : v));
    return {
      source: "live",
      start: new Date(times[s0]),
      pts: j.map((loc) => ({
        wind: cut(loc.hourly.wind_speed_10m),
        dir: cut(loc.hourly.wind_direction_10m),
        gust: cut(loc.hourly.wind_gusts_10m),
        precip: cut(loc.hourly.precipitation),
        temp: cut(loc.hourly.temperature_2m),
        code: cut(loc.hourly.weather_code),
        cloud: cut(loc.hourly.cloud_cover),
      })),
    };
  }

  function demo(def) {
    def = def || GRIDS.ksc;
    const start = new Date(Math.floor(Date.now() / 3600000) * 3600000);
    return {
      source: "demo",
      start,
      pts: gridPoints(def).map((g) => {
        const o = { wind: [], dir: [], gust: [], precip: [], temp: [], code: [], cloud: [] };
        for (let h = 0; h < N; h++) {
          const cx = def.lon0 - 2.6 * def.step + h * 0.186 * def.step;
          const cy = def.lat0 - 0.71 * def.step + h * 0.064 * def.step;
          const d = Math.hypot((g.lon - cx) * 98, (g.lat - cy) * 111) * (7 / def.cellKm);
          const near = Math.exp(-((d / 16) ** 2));
          o.precip.push(+(7 * near).toFixed(2));
          o.gust.push(+(7 + 11 * near + 1.5 * Math.sin(h / 5)).toFixed(1));
          o.wind.push(+(4.5 + 4 * near + Math.sin(h / 7)).toFixed(1));
          o.dir.push(100 + 40 * near + h * 2);
          o.temp.push(+(28 - 3 * near - 2 * Math.cos(h / 24 * Math.PI * 2)).toFixed(1));
          o.cloud.push(Math.round(35 + 60 * near));
          o.code.push(near > 0.75 ? 95 : near > 0.3 ? 61 : 1);
        }
        return o;
      }),
    };
  }

  /* ---------- Status logic (illustrative thresholds) ---------- */
  function stateAt(p, h) {
    if (p.code[h] >= 95) return ["hold", "Thunderstorm in forecast"];
    if (p.gust[h] >= 15) return ["hold", "Gusts ≥ 15 m/s"];
    if (p.precip[h] >= 1) return ["hold", "Precipitation ≥ 1 mm/h"];
    if (p.gust[h] >= 10) return ["watch", "Gusts ≥ 10 m/s"];
    if (p.precip[h] >= 0.2) return ["watch", "Precipitation ≥ 0.2 mm/h"];
    return ["go", "Within limits"];
  }

  /* ---------- UI updates ---------- */
  const fmtTime = (h) => {
    const d = new Date(wx.start.getTime() + h * 3600000);
    return d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  };

  // Where the readout and sparklines sample the forecast for the active view.
  function readoutPoint() {
    if (region === "hormuz") return HORMUZ_POINT;
    if (scnId === "launch") return { ...SITES.lc39a, name: "Launch Complex 39A (launch site)" };
    return SITES[selected];
  }

  function sparkline(svgId, key, isBars, max) {
    const svg = $(svgId);
    const rp = readoutPoint();
    const idx = nearest(rp.lat, rp.lon);
    const arr = wx.pts[idx][key];
    const hi = Math.max(max, ...arr);
    const W = 240;
    const H = 52;
    const x = (i) => (i / (N - 1)) * W;
    const y = (v) => H - 4 - (v / hi) * (H - 10);
    let g = '<line x1="0" y1="' + (H - 3) + '" x2="' + W + '" y2="' + (H - 3) + '" stroke="rgba(140,185,220,.3)" />';
    if (isBars) {
      arr.forEach((v, i) => {
        const hh = Math.max(0, H - 4 - y(v));
        g += '<rect x="' + (x(i) - 2) + '" y="' + y(v) + '" width="4" height="' + hh + '" fill="#41b7e3" />';
      });
    } else {
      g +=
        '<path d="' +
        arr.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join("") +
        '" fill="none" stroke="#41b7e3" stroke-width="1.6" vector-effect="non-scaling-stroke" />';
    }
    g += '<line x1="' + x(hour) + '" y1="0" x2="' + x(hour) + '" y2="' + H + '" stroke="#ffdf3c" stroke-width="1.5" vector-effect="non-scaling-stroke" />';
    svg.innerHTML = g;
  }

  function updateReadout() {
    if (!wx) return;
    const site = readoutPoint();
    const p = wx.pts[nearest(site.lat, site.lon)];
    $("#r-site").textContent = site.name;
    $("#r-time").textContent = fmtTime(hour);
    $("#r-wind").textContent = p.wind[hour].toFixed(1) + " m/s @ " + Math.round(p.dir[hour]) + "°";
    $("#r-gust").textContent = p.gust[hour].toFixed(1) + " m/s";
    $("#r-precip").textContent = p.precip[hour].toFixed(1) + " mm/h";
    $("#r-temp").textContent = p.temp[hour].toFixed(0) + " °C";
    sparkline("#sp-gust", "gust", false, 12);
    sparkline("#sp-precip", "precip", true, 2);

    const rows = Object.entries(SITES)
      .filter(([k]) => k !== "all" && region === "ksc")
      .map(([k, s]) => {
        const [st, why] = stateAt(wx.pts[nearest(s.lat, s.lon)], hour);
        return { k, name: s.name, st, why };
      });
    $("#status-list").innerHTML = rows
      .map((r) => '<li class="st-' + r.st + '" title="' + r.why + '"><span>' + r.name + "</span><b>" + r.st.toUpperCase() + "</b></li>")
      .join("");
    const held = rows.filter((r) => r.st === "hold");
    const watch = rows.filter((r) => r.st === "watch");
    $("#retask").textContent = held.length
      ? "Weather standoff at " + held.map((r) => r.name).join(", ") + " (" + held[0].why.toLowerCase() + "). Retasking outdoor work to indoor tasks and holding fuel deliveries."
      : watch.length
        ? "Conditions marginal at " + watch.map((r) => r.name).join(", ") + ". Pre-staging tasks for retasking."
        : region === "hormuz"
          ? "Regional forecast on ~55 km cells (open model). Wind and rain can affect visibility, sea state, and vessel speed in the strait."
          : "";
    hourOut.textContent = hour === 0 ? "Now" : "+" + hour + " h";
  }

  /* ---------- Cesium scene ---------- */
  const speedColor = (v) =>
    v >= 12 ? C.Color.fromCssColorString("#ff6b5b") : v >= 8 ? C.Color.fromCssColorString("#ffdf3c") : v >= 4 ? C.Color.fromCssColorString("#41b7e3") : C.Color.fromCssColorString("#326d96");

  function offset(lat, lon, bearingDeg, meters) {
    const b = (bearingDeg * Math.PI) / 180;
    return [
      lat + (Math.cos(b) * meters) / 111320,
      lon + (Math.sin(b) * meters) / (111320 * Math.cos((lat * Math.PI) / 180)),
    ];
  }

  function updateScene() {
    if (!viewer || !wx) return;
    const precipOn = document.querySelector('[data-layer="precip"]').checked;
    grid.forEach((g, i) => {
      const p = wx.pts[i];
      const sp = p.wind[hour];
      const to = (p.dir[hour] + 180) % 360;
      const len = Math.min(7000, 1200 + sp * 450) * (STEP / GRIDS.ksc.step);
      const [lat2, lon2] = offset(g.lat, g.lon, to, len);
      const a = arrows[i];
      a.polyline.positions = C.Cartesian3.fromDegreesArrayHeights([g.lon, g.lat, 260, lon2, lat2, 260]);
      a.polyline.material = new C.PolylineArrowMaterialProperty(speedColor(sp));
      windCells[i].rectangle.material = speedColor(sp).withAlpha(0.26);
      const pr = p.precip[hour];
      const c = cells[i];
      c.show = precipOn && pr >= 0.05;
      const alpha = Math.min(0.7, 0.18 + pr / 6);
      c.rectangle.material = (pr >= 2.5 ? C.Color.fromCssColorString("#ffdf3c") : C.Color.fromCssColorString("#3fb8ff")).withAlpha(alpha);
    });
    updateReadout();
    window.dispatchEvent(new Event("twin:update"));
  }

  function buildScene() {
    const H = STEP / 2;
    grid.forEach((g) => {
      const arrow = viewer.entities.add({
        polyline: {
          positions: C.Cartesian3.fromDegreesArrayHeights([g.lon, g.lat, 260, g.lon + 0.01, g.lat, 260]),
          width: 11,
          material: new C.PolylineArrowMaterialProperty(C.Color.CYAN),
        },
      });
      arrows.push(arrow);
      layers.wind.push(arrow);
      const windCell = viewer.entities.add({
        rectangle: {
          coordinates: C.Rectangle.fromDegrees(g.lon - H, g.lat - H, g.lon + H, g.lat + H),
          material: speedColor(5).withAlpha(0.26),
          height: 45,
          outline: true,
          outlineColor: C.Color.WHITE.withAlpha(0.18),
        },
      });
      windCells.push(windCell);
      layers.wind.push(windCell);
      const cell = viewer.entities.add({
        show: false,
        rectangle: {
          coordinates: C.Rectangle.fromDegrees(g.lon - H, g.lat - H, g.lon + H, g.lat + H),
          material: C.Color.fromCssColorString("#3fb8ff").withAlpha(0.3),
          height: 60,
        },
      });
      cells.push(cell);
      layers.precip.push(cell);
    });

    const steel = C.Color.fromCssColorString("#5aa9d6");
    const outline = C.Color.fromCssColorString("#bfe6fa");
    const addBox = (lat, lon, lenM, widM, hM, rotDeg, name) => {
      const corners = [
        [-lenM / 2, -widM / 2],
        [lenM / 2, -widM / 2],
        [lenM / 2, widM / 2],
        [-lenM / 2, widM / 2],
      ].map(([dx, dy]) => {
        const r = (rotDeg * Math.PI) / 180;
        const x = dx * Math.cos(r) - dy * Math.sin(r);
        const y = dx * Math.sin(r) + dy * Math.cos(r);
        const [la, lo] = offset(lat, lon, 90, x);
        const [la2, lo2] = offset(la, lo, 0, y);
        return [lo2, la2];
      });
      const e = viewer.entities.add({
        name,
        polygon: {
          hierarchy: C.Cartesian3.fromDegreesArray(corners.flat()),
          height: 0,
          extrudedHeight: hM,
          material: steel.withAlpha(0.78),
          outline: true,
          outlineColor: outline,
        },
      });
      layers.cad.push(e);
      return e;
    };
    const label = (lat, lon, text, h, far) => {
      const e = viewer.entities.add({
        position: C.Cartesian3.fromDegrees(lon, lat, h),
        label: {
          text,
          font: "600 13px Inter, system-ui, sans-serif",
          fillColor: C.Color.WHITE,
          outlineColor: C.Color.fromCssColorString("#06121f"),
          outlineWidth: 4,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new C.Cartesian2(0, -14),
          verticalOrigin: C.VerticalOrigin.BOTTOM,
          distanceDisplayCondition: new C.DistanceDisplayCondition(0, far),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      layers.cad.push(e);
    };

    // Real facility footprints and roads from OpenStreetMap (see ksc-data.js)
    const KS = window.KSC;
    const polyEnt = (poly, h, mat, name) => {
      const e = viewer.entities.add({
        name,
        polygon: {
          hierarchy: C.Cartesian3.fromDegreesArray(poly.flatMap(([la, lo]) => [lo, la])),
          height: 0,
          extrudedHeight: h,
          material: mat,
          outline: true,
          outlineColor: outline,
        },
      });
      layers.cad.push(e);
      return e;
    };
    const polyCenter = (poly) => [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
    polyEnt(KS.vab.poly, KS.vab.h, steel.withAlpha(0.78), "Vehicle Assembly Building");
    label(KS.vab.center[0], KS.vab.center[1], "Vehicle Assembly Building", 175, 90000);
    polyEnt(KS.logistics.poly, 12, steel.withAlpha(0.78), "KSC Logistics Facility");
    label(KS.logistics.center[0], KS.logistics.center[1], "KSC Logistics Facility", 24, 18000);
    polyEnt(KS.lcc.poly, KS.lcc.h, steel.withAlpha(0.7), "Launch Control Center");
    const lccC = polyCenter(KS.lcc.poly);
    label(lccC[0], lccC[1], "Launch Control Center", 40, 5000);
    // Launch pads
    const pad = (s, name, rocket) => {
      const S = SITES[s];
      const p = viewer.entities.add({
        position: C.Cartesian3.fromDegrees(S.lon, S.lat, 0),
        ellipse: { semiMajorAxis: 85, semiMinorAxis: 85, height: 0, extrudedHeight: 3, material: C.Color.fromCssColorString("#8fb2c9").withAlpha(0.85) },
      });
      layers.cad.push(p);
      if (s === "lc39a") polyEnt(KS.fssA.poly, KS.fssA.h, steel.withAlpha(0.9), "LC-39A Fixed Service Structure");
      if (rocket) {
        const body = viewer.entities.add({
          position: C.Cartesian3.fromDegrees(S.lon, S.lat, 3 + 50),
          cylinder: { length: 100, topRadius: 5, bottomRadius: 5, material: C.Color.WHITE },
        });
        const nose = viewer.entities.add({
          position: C.Cartesian3.fromDegrees(S.lon, S.lat, 3 + 100 + 8),
          cylinder: { length: 16, topRadius: 0, bottomRadius: 5, material: C.Color.fromCssColorString("#e8f1f8") },
        });
        layers.cad.push(body, nose);
        layers.rocket.push(body, nose);
      }
      label(S.lat, S.lon, name, 130, 60000);
    };
    pad("lc39a", "LC-39A", true);
    pad("lc39b", "LC-39B", false);
    pad("slc40", "SLC-40", false);

    // Crawlerway (real OSM geometry): VAB -> Pad A, and the branch to Pad B past the fork
    const crawlDash = new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString("#ffdf3c"), dashLength: 18 });
    const crawl = (pts) =>
      layers.cad.push(
        viewer.entities.add({ polyline: { positions: C.Cartesian3.fromDegreesArray(pts.flatMap(([la, lo]) => [lo, la])), width: 5, clampToGround: true, material: crawlDash } })
      );
    crawl(KS.routes.crawler);
    const oth = KS.routes.other;
    let iF = 0;
    let bdF = 1e9;
    oth.forEach((p, i) => {
      const d = Math.hypot(p[0] - KS.points.F[0], p[1] - KS.points.F[1]);
      if (d < bdF) {
        bdF = d;
        iF = i;
      }
    });
    crawl(oth.slice(iF));
    label(KS.points.F[0], KS.points.F[1], "Crawlerway", 20, 30000);

    // Tracked LuminaBox assets (TEU scenarios) are built in lumina-tracking.js
  }

  function fly(key, instant) {
    if (!viewer) return;
    window.dispatchEvent(new Event("twin:prefly"));
    const s = SITES[key];
    const target = C.Cartesian3.fromDegrees(s.lon, s.lat, key === "all" ? 0 : 40);
    viewer.camera.flyToBoundingSphere(new C.BoundingSphere(target, 1), {
      duration: instant ? 0 : 1.8,
      offset: new C.HeadingPitchRange(C.Math.toRadians(s.heading), C.Math.toRadians(s.pitch), s.range),
    });
  }

  async function initViewer() {
    C = window.Cesium;
    const makeViewer = (extra) =>
      new C.Viewer(box, {
        baseLayer: new C.ImageryLayer(new C.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/", maximumLevel: 19 })),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        showRenderLoopErrors: false,
        ...extra,
      });
    // Some GPUs/drivers fail WebGL2 or MSAA setup; retry with progressively safer contexts.
    const attempts = [
      {},
      { msaaSamples: 1 },
      { msaaSamples: 1, contextOptions: { requestWebgl1: true, webgl: { failIfMajorPerformanceCaveat: false } } },
    ];
    let lastErr;
    for (const extra of attempts) {
      try {
        box.querySelectorAll(".cesium-widget-errorPanel, .cesium-viewer").forEach((n) => n.remove());
        viewer = makeViewer(extra);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    const base = viewer.imageryLayers.get(0);
    base.brightness = 0.62;
    base.contrast = 1.15;
    base.saturation = 0.55;
    viewer.scene.globe.baseColor = C.Color.fromCssColorString("#0a1c2f");
    viewer.scene.backgroundColor = C.Color.fromCssColorString("#06121f");
    const ctl = viewer.scene.screenSpaceCameraController;
    ctl.minimumZoomDistance = 25;
    ctl.maximumZoomDistance = 160000;

    // NOAA MRMS radar (latest), toggled by layer switch
    try {
      radarLayer = viewer.imageryLayers.addImageryProvider(
        new C.WebMapServiceImageryProvider({
          url: "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows",
          layers: "conus_bref_qcd",
          parameters: { transparent: true, format: "image/png" },
        })
      );
      radarLayer.alpha = 0.7;
      radarLayer.show = false;
    } catch (e) {
      /* radar is optional */
    }

    buildScene();
    fly("all", true);
    loading.remove();
    applyLayers();
    updateScene();
    window.twinApi = {
      viewer,
      Cesium: C,
      SITES,
      CRAWLERWAY,
      layers,
      getWx: () => wx,
      getHour: () => hour,
      getSelected: () => selected,
      grid,
      nearest,
      getRegion: () => region,
      getGridInfo: () => ({ ...GRIDS[region], region }),
    };
    window.dispatchEvent(new CustomEvent("twin:ready", { detail: window.twinApi }));
  }

  function setBadge() {
    if (!wx) return;
    badge.textContent = wx.source === "live" ? "Live open data" : "Demo data (feed unavailable)";
    badge.classList.toggle("live", wx.source === "live");
  }

  // Re-point the forecast grid at another region and swap in its weather.
  async function setRegion(name) {
    if (name === region || !GRIDS[name]) return;
    region = name;
    const d = GRIDS[name];
    STEP = d.step;
    const H = STEP / 2;
    gridPoints(d).forEach((pt, i) => {
      grid[i].lat = pt.lat;
      grid[i].lon = pt.lon;
      if (windCells[i]) {
        const rc = C.Rectangle.fromDegrees(pt.lon - H, pt.lat - H, pt.lon + H, pt.lat + H);
        windCells[i].rectangle.coordinates = rc;
        cells[i].rectangle.coordinates = rc;
      }
    });
    if (wxStore[name]) wx = wxStore[name];
    else {
      wx = wxStore[name] = demo(d);
      setBadge();
      updateScene();
      loadLive(d)
        .then((live) => {
          wxStore[name] = live;
          if (region === name) {
            wx = live;
            setBadge();
            updateScene();
          }
        })
        .catch(() => {});
    }
    setBadge();
    updateScene();
  }

  window.addEventListener("twin:scenario", (event) => {
    scnId = event.detail;
    if (viewer) setRegion(scnId === "hormuz" ? "hormuz" : "ksc");
    updateReadout();
  });

  function applyLayers() {
    document.querySelectorAll("[data-layer]").forEach((cb) => {
      const on = cb.checked;
      const k = cb.dataset.layer;
      if (k === "radar") {
        if (radarLayer) radarLayer.show = on;
      } else if (k !== "precip" && layers[k]) {
        layers[k].forEach((e) => (e.show = on && !(k === "wind" && forecastMode === "fine")));
      }
    });
  }

  window.addEventListener("twin:resolution", (event) => {
    forecastMode = event.detail;
    applyLayers();
    const key = $("#wx-grid-key");
    if (key) key.hidden = forecastMode !== "coarse";
  });

  /* ---------- Controls ---------- */
  document.querySelectorAll("[data-layer]").forEach((cb) =>
    cb.addEventListener("change", () => {
      if (!viewer) return;
      const k = cb.dataset.layer;
      applyLayers();
      if (k === "precip") updateScene();
    })
  );

  document.querySelectorAll(".fac").forEach((btn) =>
    btn.addEventListener("click", () => {
      selected = btn.dataset.site;
      document.querySelectorAll(".fac").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", String(on));
      });
      $("#stage-site").textContent = SITES[selected].name;
      fly(selected);
      updateReadout();
      window.dispatchEvent(new Event("twin:site"));
    })
  );

  let timer = null;
  function setHour(h) {
    hour = Math.max(0, Math.min(N - 1, h));
    hourInput.value = hour;
    updateScene();
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    playBtn.textContent = "Play";
    playBtn.setAttribute("aria-pressed", "false");
  }
  hourInput.addEventListener("input", () => {
    if (timer) stop();
    setHour(parseInt(hourInput.value, 10));
  });
  playBtn.addEventListener("click", () => {
    if (!wx) return;
    if (timer) return stop();
    if (hour >= N - 1) setHour(0);
    playBtn.textContent = "Pause";
    playBtn.setAttribute("aria-pressed", "true");
    timer = setInterval(() => {
      if (hour >= N - 1) return stop();
      setHour(hour + 1);
    }, 500);
  });
  ["#sp-gust", "#sp-precip"].forEach((id) =>
    $(id).addEventListener("click", (ev) => {
      const r = ev.currentTarget.getBoundingClientRect();
      if (timer) stop();
      setHour(Math.round(((ev.clientX - r.left) / r.width) * (N - 1)));
    })
  );

  /* ---------- Boot (lazy) ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error("script " + src));
      document.head.appendChild(s);
    });
  }

  let booted = false;
  async function boot() {
    if (booted) return;
    booted = true;
    window.CESIUM_BASE_URL = CESIUM;
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = CESIUM + "Widgets/widgets.css";
    document.head.appendChild(css);

    const weather = loadLive().catch(() => null);
    if (location.protocol === "file:") {
      // Browsers block Cesium's tile requests from file:// pages; needs http(s).
      loading.textContent = "The 3D map needs this page served over http(s), for example from your web host or a local server.";
      wx = (await weather) || demo();
      badge.textContent = wx.source === "live" ? "Live open data" : "Demo data";
      updateReadout();
      return;
    }
    try {
      await loadScript(CESIUM + "Cesium.js");
    } catch (e) {
      loading.textContent = "3D map could not load (network unavailable).";
      badge.textContent = "Offline";
      wx = demo();
      updateReadout();
      return;
    }
    wx = wxStore.ksc = (await weather) || demo();
    setBadge();
    hourInput.max = N - 1;
    try {
      await initViewer();
    } catch (e) {
      box.querySelectorAll(".cesium-widget-errorPanel, .cesium-viewer").forEach((n) => n.remove());
      box.appendChild(loading);
      console.error("Cesium viewer init failed", e);
      loading.textContent = "3D view could not start. Enable hardware acceleration in your browser settings, update your graphics drivers, or try another browser." + (e && e.message ? " (" + String(e.message).split("\n")[0] + ")" : "");
      updateReadout();
    }
  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (es) => {
        if (es[0].isIntersecting) {
          io.disconnect();
          boot();
        }
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(root);
  } else {
    boot();
  }
})();
