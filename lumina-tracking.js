/* LuminaBox tracking scenarios on the 3D twin (simulated telemetry):
   road transit, warehouse inventory, and a notional rocket-cargo delivery to Japan.
   All tracked assets are 20 ft (TEU) containers carrying a LuminaBox. */
(function () {
  "use strict";
  window.addEventListener("twin:ready", (e) => init(e.detail));

  function init(api) {
    const { viewer, Cesium: C, layers, CRAWLERWAY, SITES } = api;
    const $ = (s) => document.querySelector(s);
    const CP = (fn) => new C.CallbackProperty(fn, false);
    const INF = Number.POSITIVE_INFINITY;
    const css = (h, a) => C.Color.fromCssColorString(h).withAlpha(a == null ? 1 : a);
    const SKY = css("#41b7e3");
    const YEL = css("#ffdf3c");
    const RED = css("#ff6b5b");
    const GRN = css("#5fd08a");
    const AMB = css("#ffb347");
    const WHITE = C.Color.WHITE;
    const DARK = css("#06121f");
    const DRED = css("#6b211a");
    const EDGE = css("#06121f", 0.7);
    const TEU = new C.Cartesian3(6.058, 2.438, 2.591); // 20 ft ISO container, metres
    const PALETTE = ["#2d6cdf", "#d65a2e", "#d9dee3", "#2f9e6b", "#c9a227", "#7a8794", "#8e5bd1"].map((h) => css(h));
    const MONO = "600 12px ui-monospace, Consolas, monospace";

    let T = performance.now() / 1000;
    let active = "road";
    let assetsOn = true;
    const groups = { road: [], warehouse: [], launch: [] };
    const reg = (scn, e, cond) => {
      e._scn = scn;
      e._cond = cond;
      groups[scn].push(e);
      return e;
    };
    const add = (scn, opts, cond) => reg(scn, viewer.entities.add(opts), cond);
    function applyVisibility() {
      Object.keys(groups).forEach((k) =>
        groups[k].forEach((e) => {
          e.show = assetsOn && k === active && (!e._cond || e._cond());
        })
      );
    }

    /* ---------- geometry helpers ---------- */
    const cart = (lat, lon, h) => C.Cartesian3.fromDegrees(lon, lat, h);
    const offsetLL = (lat, lon, east, north) => [
      lat + north / 111320,
      lon + east / (111320 * Math.cos((lat * Math.PI) / 180)),
    ];
    const hprQ = (pos, headingDeg) =>
      C.Transforms.headingPitchRollQuaternion(pos, new C.HeadingPitchRoll(C.Math.toRadians(headingDeg), 0, 0));
    const groundOf = (p) => {
      const c = C.Cartographic.fromCartesian(p);
      return C.Cartesian3.fromRadians(c.longitude, c.latitude, 0);
    };
    const upVec = (p) => C.Cartesian3.normalize(p, new C.Cartesian3());
    const upBy = (p, h) => C.Cartesian3.add(p, C.Cartesian3.multiplyByScalar(upVec(p), h, new C.Cartesian3()), new C.Cartesian3());
    const enu = (p) => {
      const m = C.Transforms.eastNorthUpToFixedFrame(p);
      const col = (i) => {
        const v = C.Matrix4.getColumn(m, i, new C.Cartesian4());
        return new C.Cartesian3(v.x, v.y, v.z);
      };
      return { e: col(0), n: col(1), u: col(2) };
    };
    const lin = (a, b, k) => C.Cartesian3.lerp(a, b, k, new C.Cartesian3());
    const madd = (p, v, s) => C.Cartesian3.add(p, C.Cartesian3.multiplyByScalar(v, s, new C.Cartesian3()), new C.Cartesian3());
    const ss = (x) => {
      const t = Math.max(0, Math.min(1, x));
      return t * t * (3 - 2 * t);
    };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rnd = (a, b) => a + Math.random() * (b - a);
    const f1 = (v) => v.toFixed(1);
    const mmss = (s) => {
      const m = Math.floor(s / 60);
      return String(m).padStart(2, "0") + ":" + String(Math.floor(s % 60)).padStart(2, "0");
    };

    /* ---------- shared builders ---------- */
    function baseStation(scn, lat, lon, name, cond) {
      const top = cart(lat, lon, 32);
      add(scn, { position: cart(lat, lon, 16), cylinder: { length: 32, topRadius: 0.5, bottomRadius: 1.3, material: css("#9fb6c8") } }, cond);
      add(
        scn,
        {
          position: top,
          point: { pixelSize: 10, color: CP(() => (Math.floor(T * 1.5) % 2 ? RED : DRED)), outlineColor: WHITE, outlineWidth: 1, disableDepthTestDistance: INF },
          label: {
            text: name,
            font: MONO,
            fillColor: WHITE,
            outlineColor: DARK,
            outlineWidth: 4,
            style: C.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new C.Cartesian2(0, -14),
            verticalOrigin: C.VerticalOrigin.BOTTOM,
            distanceDisplayCondition: new C.DistanceDisplayCondition(0, 30000),
            disableDepthTestDistance: INF,
          },
        },
        cond
      );
      return top;
    }

    function uplink(scn, aFn, bFn, cond) {
      add(scn, { polyline: { positions: CP(() => [aFn(), bFn()]), width: 2, material: new C.PolylineDashMaterialProperty({ color: SKY, dashLength: 14 }) } }, cond);
      [0, 0.5].forEach((k) =>
        add(
          scn,
          {
            position: CP(() => lin(aFn(), bFn(), (T / 1.4 + k) % 1)),
            point: { pixelSize: 5, color: WHITE, disableDepthTestDistance: INF },
          },
          cond
        )
      );
    }

    // The "tracked by LuminaBox" indicator: state-coloured marker, pulsing ground ring, optional beacon column.
    function indicator(scn, posFn, o) {
      o = o || {};
      const ph0 = Math.random();
      const col = o.color || (() => SKY);
      const ph = () => (T / 1.8 + ph0) % 1;
      add(
        scn,
        {
          position: CP(posFn),
          point: {
            pixelSize: CP(() => (o.size ? o.size() : o.big ? 13 : 8)),
            color: CP(() => col()),
            outlineColor: WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: INF,
            distanceDisplayCondition: o.dist ? new C.DistanceDisplayCondition(0, o.dist) : undefined,
          },
        },
        o.cond
      );
      if (o.ring !== false) {
        const r = () => (o.rBase || 9) + (o.rGrow || 14) * ph();
        add(
          scn,
          {
            position: CP(() => groundOf(posFn())),
            ellipse: {
              semiMajorAxis: CP(r),
              semiMinorAxis: CP(r),
              height: 0.5,
              material: new C.ColorMaterialProperty(CP(() => col().withAlpha(0.45 * (1 - ph())))),
            },
          },
          o.ringCond || o.cond
        );
      }
      if (o.beacon) {
        add(
          scn,
          {
            polyline: {
              positions: CP(() => {
                const p = posFn();
                return [groundOf(p), upBy(p, o.beacon)];
              }),
              width: 5,
              material: new C.PolylineGlowMaterialProperty({ glowPower: 0.25, color: SKY }),
            },
          },
          o.cond
        );
      }
    }

    function teuBox(scn, o) {
      const e = add(
        scn,
        {
          position: o.pos,
          orientation: o.orient,
          box: {
            dimensions: TEU,
            material: o.color,
            outline: true,
            outlineColor: o.outline || EDGE,
          },
        },
        o.cond
      );
      e._lb = o.tag;
      return e;
    }

    const feedLog = { road: [], warehouse: [], launch: [] };
    const log = (scn, msg) => {
      feedLog[scn].unshift({ t: new Date(), msg });
      feedLog[scn].length = Math.min(feedLog[scn].length, 6);
    };
    const logHTML = (scn) =>
      feedLog[scn].length
        ? '<ul class="lb-log">' +
          feedLog[scn]
            .map((l) => "<li><time>" + l.t.toLocaleTimeString("en-US", { hour12: false }) + "</time>" + l.msg + "</li>")
            .join("") +
          "</ul>"
        : "";
    const kv = (k, v, cls) => '<div class="kv' + (cls ? " " + cls : "") + '"><span>' + k + "</span><b>" + v + "</b></div>";

    /* =====================================================================
       (a) ROAD TRANSIT
       ===================================================================== */
    const rp = CRAWLERWAY.slice(0, 4);
    const rc = rp.map(([la, lo]) => cart(la, lo, 0));
    const rcum = [0];
    for (let i = 1; i < rc.length; i++) rcum.push(rcum[i - 1] + C.Cartesian3.distance(rc[i - 1], rc[i]));
    const rTotal = rcum[rcum.length - 1];
    function roadAt(f) {
      const d = f * rTotal;
      let i = 1;
      while (i < rcum.length - 1 && d > rcum[i]) i++;
      const k = (d - rcum[i - 1]) / (rcum[i] - rcum[i - 1]);
      const la = rp[i - 1][0] + (rp[i][0] - rp[i - 1][0]) * k;
      const lo = rp[i - 1][1] + (rp[i][1] - rp[i - 1][1]) * k;
      const brg = (Math.atan2((rp[i][1] - rp[i - 1][1]) * Math.cos((la * Math.PI) / 180), rp[i][0] - rp[i - 1][0]) * 180) / Math.PI;
      return { la, lo, brg };
    }
    const ROAD_PERIOD = 70; // s per one-way run (time-lapse 10x)
    const BUMPS = [0.31, 0.66];
    const road = {
      f: 0, dir: 1, speed: 0, vib: 0.05, shock: 0, shockUntil: 0, temp: 27, rh: 55,
      hit: [false, false], flagged: [false, false], pFlat: null, pTeu: null, pTop: null, q: null, dist: 0,
    };
    const bs1 = baseStation("road", 28.5758, -80.6462, "BS-1 · Base station");
    const bs1f = () => bs1;

    function tickRoad() {
      const x = (T / ROAD_PERIOD) % 2;
      const t = x < 1 ? x : 2 - x;
      road.dir = x < 1 ? 1 : -1;
      road.f = 0.5 - 0.5 * Math.cos(Math.PI * t);
      road.speed = 38 * Math.sin(Math.PI * t);
      const p = roadAt(road.f);
      const brg = road.dir > 0 ? p.brg : p.brg + 180;
      road.pFlat = cart(p.la, p.lo, 0.35);
      road.pTeu = cart(p.la, p.lo, 0.7 + TEU.z / 2);
      road.pTop = cart(p.la, p.lo, 0.7 + TEU.z + 0.4);
      road.q = hprQ(road.pTeu, brg - 90);
      road.hdg = brg;
      BUMPS.forEach((b, i) => {
        const d = Math.abs(road.f - b);
        if (d < 0.006 && !road.hit[i]) {
          road.hit[i] = true;
          road.shock = rnd(2.8, 4.1);
          road.shockUntil = T + 2.5;
          if (!road.flagged[i]) log("road", "Shock " + f1(road.shock) + " g · road segment R-" + (14 + i * 9) + " flagged");
          road.flagged[i] = true;
        }
        if (d > 0.03) road.hit[i] = false;
      });
      const shockNow = road.shock * Math.max(0, (road.shockUntil - T) / 2.5);
      road.shockNow = shockNow;
      road.vib = 0.04 + 0.004 * road.speed + rnd(0, 0.03) + shockNow * 0.3;
      const wx = api.getWx();
      const base = wx ? wx.pts[api.nearest(p.la, p.lo)].temp[api.getHour()] : 27;
      road.temp = base + 1.5;
      road.rh = 55 + 8 * Math.sin(T / 9);
      road.dist = C.Cartesian3.distance(road.pTop, bs1) / 1000;
    }
    tickRoad();

    const roadTeu = teuBox("road", {
      pos: CP(() => road.pTeu),
      orient: CP(() => road.q),
      color: PALETTE[0],
      tag: { scn: "road" },
    });
    add("road", {
      position: CP(() => road.pFlat),
      orientation: CP(() => road.q),
      box: { dimensions: new C.Cartesian3(7.6, 2.7, 0.7), material: css("#26384a"), outline: true, outlineColor: EDGE },
    });
    add("road", {
      position: CP(() => upBy(road.pTop, 0.0)),
      orientation: CP(() => road.q),
      box: { dimensions: new C.Cartesian3(0.9, 0.6, 0.4), material: SKY, outline: true, outlineColor: WHITE },
    });
    indicator("road", () => road.pTop, {
      big: true,
      beacon: 70,
      color: () => (road.shockNow > 0.2 ? RED : SKY),
      rBase: 10,
      rGrow: 16,
    });
    add("road", {
      position: CP(() => upBy(road.pTop, 95)),
      label: {
        text: CP(() => "● TRACKED · LuminaBox LB-207\n" + road.speed.toFixed(0) + " km/h · " + road.vib.toFixed(2) + " g rms · " + road.temp.toFixed(0) + " °C"),
        font: MONO,
        fillColor: WHITE,
        showBackground: true,
        backgroundColor: DARK.withAlpha(0.82),
        backgroundPadding: new C.Cartesian2(8, 5),
        verticalOrigin: C.VerticalOrigin.BOTTOM,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 22000),
        disableDepthTestDistance: INF,
      },
    });
    uplink("road", () => road.pTop, bs1f);
    BUMPS.forEach((b, i) => {
      const p = roadAt(b);
      const g = cart(p.la, p.lo, 0);
      add(
        "road",
        {
          position: g,
          ellipse: { semiMajorAxis: 16, semiMinorAxis: 16, height: 0.5, material: RED.withAlpha(0.45) },
        },
        () => road.flagged[i]
      );
      add(
        "road",
        {
          position: cart(p.la, p.lo, 12),
          point: { pixelSize: 9, color: RED, outlineColor: WHITE, outlineWidth: 2, disableDepthTestDistance: INF },
          label: {
            text: "⚠ Road damage flagged",
            font: MONO,
            fillColor: WHITE,
            outlineColor: DARK,
            outlineWidth: 4,
            style: C.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new C.Cartesian2(0, -12),
            verticalOrigin: C.VerticalOrigin.BOTTOM,
            distanceDisplayCondition: new C.DistanceDisplayCondition(0, 14000),
            disableDepthTestDistance: INF,
          },
        },
        () => road.flagged[i]
      );
    });

    function feedRoad() {
      const age = ((T % 2) / 1).toFixed(1);
      return (
        '<div class="lb-asset"><span class="lb-badge ok">TRACKING</span><b>LB-207</b><small>1 × TEU on transporter</small></div>' +
        '<div class="kvs">' +
        kv("Speed", road.speed.toFixed(0) + " km/h") +
        kv("Vibration", road.vib.toFixed(2) + " g rms", road.shockNow > 0.2 ? "alert" : "") +
        kv("Shock (peak)", road.shockNow > 0.2 ? f1(road.shockNow) + " g" : "–", road.shockNow > 0.2 ? "alert" : "") +
        kv("Temp", road.temp.toFixed(0) + " °C") +
        kv("Humidity", road.rh.toFixed(0) + " %RH") +
        kv("Link", "BS-1 · " + f1(road.dist) + " km") +
        kv("Last packet", age + " s ago") +
        kv("Battery", "94 %") +
        "</div>" +
        logHTML("road")
      );
    }

    /* =====================================================================
       (b) WAREHOUSE
       ===================================================================== */
    const WH = { lat: 28.5655, lon: -80.6555, L: 96, W: 54 };
    const whCenter = cart(WH.lat, WH.lon, 0);
    const rectCorners = (lat, lon, L, W) =>
      [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]].flatMap(([dx, dy]) => {
        const [la, lo] = offsetLL(lat, lon, dx, dy);
        return [lo, la];
      });
    add("warehouse", {
      polygon: { hierarchy: C.Cartesian3.fromDegreesArray(rectCorners(WH.lat, WH.lon, WH.L, WH.W)), height: 0, extrudedHeight: 0.3, material: css("#16293b", 0.95) },
    });
    add("warehouse", {
      polygon: {
        hierarchy: C.Cartesian3.fromDegreesArray(rectCorners(WH.lat, WH.lon, WH.L, WH.W)),
        height: 0,
        extrudedHeight: 11,
        material: SKY.withAlpha(0.06),
        outline: true,
        outlineColor: css("#9fd8f2", 0.85),
      },
    });
    const dockC = offsetLL(WH.lat, WH.lon, 64, 0);
    add("warehouse", {
      polygon: { hierarchy: C.Cartesian3.fromDegreesArray(rectCorners(dockC[0], dockC[1], 28, 40)), height: 0, extrudedHeight: 0.2, material: css("#1d3246", 0.95) },
    });
    const whLbl = offsetLL(WH.lat, WH.lon, 0, 0);
    add("warehouse", {
      position: cart(whLbl[0], whLbl[1], 30),
      label: {
        text: "Staging warehouse (illustrative)\n● 36 TEUs tracked by LuminaBox",
        font: MONO,
        fillColor: WHITE,
        showBackground: true,
        backgroundColor: DARK.withAlpha(0.82),
        backgroundPadding: new C.Cartesian2(8, 5),
        verticalOrigin: C.VerticalOrigin.BOTTOM,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 24000),
        disableDepthTestDistance: INF,
      },
    });
    const dl = offsetLL(WH.lat, WH.lon, 64, 26);
    add("warehouse", {
      position: cart(dl[0], dl[1], 4),
      label: { text: "Outbound dock", font: MONO, fillColor: WHITE, outlineColor: DARK, outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 1500), disableDepthTestDistance: INF },
    });
    const bsWpos = offsetLL(WH.lat, WH.lon, 52, -34);
    const bsW = baseStation("warehouse", bsWpos[0], bsWpos[1], "BS-W · Base station");
    uplink("warehouse", () => cart(WH.lat, WH.lon, 13), () => bsW);

    const CONTENTS = ["Avionics racks", "Payload adapters", "Ground support eq.", "Optical instruments", "Spares pallets", "Fairing hardware", "Test fixtures", "Cabling & harness"];
    const whBox = [];
    let n = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 10; c++) {
        const tiers = r === 1 && c >= 2 && c <= 7 ? 2 : 1;
        for (let t = 0; t < tiers; t++) {
          const east = -38 + 8.5 * c;
          const north = (r - 1) * 14;
          const [la, lo] = offsetLL(WH.lat, WH.lon, east, north);
          const h = TEU.z / 2 + 0.3 + t * TEU.z;
          whBox.push({
            i: n,
            id: "LB-" + (101 + n),
            east, north, tier: t, h,
            pos: cart(la, lo, h),
            color: PALETTE[(n * 5 + r * 3 + c) % PALETTE.length],
            status: "ok", until: 0,
            temp: rnd(19, 25), rh: rnd(40, 55),
            contents: CONTENTS[(n * 3 + r) % CONTENTS.length],
            dynamic: false,
          });
          n++;
        }
      }
    }
    const transfer = whBox.find((b) => b.tier === 0 && b.east === -38 + 8.5 * 6 && b.north === 14);
    transfer.dynamic = true;
    const tHome = { east: transfer.east, north: transfer.north };
    const tPath = [[tHome.east, 14], [tHome.east, 7], [52, 7], [64, 0]];
    let selected = transfer;

    const whq = hprQ(whCenter, 0);
    const STATE_COL = { ok: SKY, temp: AMB, shock: RED, door: AMB, moving: WHITE };
    whBox.forEach((b) => {
      const pos = b.dynamic ? CP(() => b.pos) : b.pos;
      teuBox("warehouse", {
        pos,
        orient: b.dynamic ? CP(() => hprQ(b.pos, 0)) : hprQ(b.pos, 0),
        color: b.color,
        outline: undefined,
        tag: { scn: "warehouse", b },
      });
      indicator("warehouse", () => upBy(b.pos, TEU.z / 2 + 0.6), {
        color: () => STATE_COL[b.status] || SKY,
        size: () => (selected === b ? 14 : 7),
        ring: true,
        ringCond: () => b.status !== "ok" || selected === b,
        rBase: 4,
        rGrow: 7,
        dist: 1800,
      });
    });

    function tPos(f) {
      // piecewise path, f 0..1
      const segs = [];
      let tot = 0;
      for (let i = 1; i < tPath.length; i++) {
        const d = Math.hypot(tPath[i][0] - tPath[i - 1][0], tPath[i][1] - tPath[i - 1][1]);
        segs.push(d);
        tot += d;
      }
      let d = f * tot;
      for (let i = 0; i < segs.length; i++) {
        if (d <= segs[i]) {
          const k = d / segs[i];
          return [tPath[i][0] + (tPath[i + 1][0] - tPath[i][0]) * k, tPath[i][1] + (tPath[i + 1][1] - tPath[i][1]) * k];
        }
        d -= segs[i];
      }
      return tPath[tPath.length - 1];
    }
    let whNext = T + 2;
    let whScan = T + 8;
    let lastTransferPhase = "";
    const whLoc = (b) => offsetLL(WH.lat, WH.lon, b.east, b.north);
    function tickWarehouse() {
      const c = (T % 40);
      let f = 0;
      let phase = "hold";
      if (c >= 6 && c < 17) { f = ss((c - 6) / 11); phase = "out"; }
      else if (c >= 17 && c < 23) { f = 1; phase = "dock"; }
      else if (c >= 23 && c < 34) { f = 1 - ss((c - 23) / 11); phase = "back"; }
      const [e, nn] = tPos(f);
      const [la, lo] = offsetLL(WH.lat, WH.lon, e, nn);
      transfer.pos = cart(la, lo, transfer.h);
      transfer.east = e;
      transfer.north = nn;
      transfer.status = phase === "out" || phase === "back" ? "moving" : "ok";
      if (phase !== lastTransferPhase) {
        if (phase === "out") log("warehouse", transfer.id + " picked · moving to outbound dock");
        if (phase === "dock") log("warehouse", transfer.id + " at outbound dock · scan OK");
        if (phase === "back") log("warehouse", transfer.id + " returning to bay");
        lastTransferPhase = phase;
      }
      whBox.forEach((b) => {
        if (b.status !== "ok" && b.status !== "moving" && T > b.until) b.status = "ok";
        b.temp += (b.status === "temp" ? 0.25 : -0.08) * (b.temp > (b.status === "temp" ? 34 : 21) ? 0 : 1) + rnd(-0.03, 0.03);
        b.temp = clamp(b.temp, 18, 36);
      });
      if (T >= whNext) {
        const cand = whBox.filter((b) => b.status === "ok" && !b.dynamic);
        const b = cand[Math.floor(Math.random() * cand.length)];
        const k = Math.random();
        if (k < 0.45) {
          b.status = "temp";
          b.until = T + 8;
          b.temp = 31 + rnd(0, 3);
          log("warehouse", b.id + " temperature excursion " + f1(b.temp) + " °C");
        } else if (k < 0.75) {
          b.status = "door";
          b.until = T + 6;
          log("warehouse", b.id + " door-open event");
        } else {
          b.status = "shock";
          b.until = T + 5;
          log("warehouse", b.id + " handling shock " + f1(rnd(1.6, 2.9)) + " g");
        }
        whNext = T + rnd(2.2, 4);
      }
      if (T >= whScan) {
        log("warehouse", "Inventory scan complete · " + whBox.length + "/" + whBox.length + " TEUs reporting");
        whScan = T + 12;
      }
    }
    tickWarehouse();

    function feedWarehouse() {
      const alerts = whBox.filter((b) => b.status !== "ok" && b.status !== "moving");
      const s = selected;
      const sel = s
        ? '<div class="lb-asset"><span class="lb-badge ' + (s.status === "ok" || s.status === "moving" ? "ok" : "alert") + '">' +
          (s.status === "ok" ? "TRACKING" : s.status === "moving" ? "MOVING" : s.status.toUpperCase()) +
          "</span><b>" + s.id + "</b><small>" + s.contents + "</small></div>" +
          '<div class="kvs">' +
          kv("Location", s.tier ? "Bay tier 2" : s.dynamic && s.east > 50 ? "Outbound dock" : "Bay tier 1") +
          kv("Temp", f1(s.temp) + " °C", s.status === "temp" ? "alert" : "") +
          kv("Humidity", s.rh.toFixed(0) + " %RH") +
          kv("Link", "BS-W · gateway") +
          "</div>"
        : "";
      return (
        '<div class="lb-summary"><span><b>' + whBox.length + "/" + whBox.length + "</b> reporting</span><span class=\"" + (alerts.length ? "alert" : "") + '"><b>' + alerts.length + "</b> alerts</span></div>" +
        sel +
        '<p class="lb-hint">Click any container to inspect its LuminaBox.</p>' +
        logHTML("warehouse")
      );
    }

    /* =====================================================================
       (c) LAUNCH -> JAPAN (notional rocket-cargo delivery)
       ===================================================================== */
    const PAD = SITES.lc39a;
    const JP = { lat: 30.4, lon: 130.97 };
    const MISSION_S = 3300;
    const PLAY_S = 50; // wall-clock seconds for a full run
    const H_APO = 1000e3;
    const geo = new C.EllipsoidGeodesic(C.Cartographic.fromDegrees(PAD.lon, PAD.lat), C.Cartographic.fromDegrees(JP.lon, JP.lat));
    const PHASES = [
      { name: "Stage & load", u0: 0, u1: 0.1 },
      { name: "Launch & ascent", u0: 0.1, u1: 0.22 },
      { name: "Coast", u0: 0.22, u1: 0.7 },
      { name: "Re-entry", u0: 0.7, u1: 0.82 },
      { name: "Landing", u0: 0.82, u1: 0.92 },
      { name: "Offload & sync", u0: 0.92, u1: 1.0 },
    ];
    const sOfU = (u) => {
      if (u < 0.1) return 0;
      if (u < 0.22) return 0.05 * Math.pow((u - 0.1) / 0.12, 1.8);
      if (u < 0.7) return 0.05 + 0.88 * ((u - 0.22) / 0.48);
      if (u < 0.82) return 0.93 + 0.055 * (1 - Math.pow(1 - (u - 0.7) / 0.12, 1.5));
      if (u < 0.92) return 0.985 + 0.015 * (1 - Math.pow(1 - (u - 0.82) / 0.1, 2));
      return 1;
    };
    const gfOf = (s) => {
      const a = ss(s / 0.012);
      const b = ss((1 - s) / 0.012);
      return s * a * b + (1 - b);
    };
    const altOf = (s) => H_APO * Math.sin(Math.PI * s);
    const baseH = (s) => 58 + (53.5 - 58) * s;
    const posOfS = (s) => {
      const g = geo.interpolateUsingFraction(gfOf(s));
      return C.Cartesian3.fromRadians(g.longitude, g.latitude, altOf(s) + baseH(s));
    };

    const veh = { u: 0, s: 0, pos: posOfS(0), x: null, y: null, z: null, q: null, qIn: null, speed: 0, alt: 0, g: 1, vib: 0.03, temp: 21, link: "BS-1", linkOk: true };
    const mission = { u: 0, playing: false, last: T };
    const slots = [];
    for (let k = 0; k < 6; k++) {
      const [la, lo] = offsetLL(JP.lat, JP.lon, 75 + (k % 3) * 8.6, -3 + Math.floor(k / 3) * 4.4);
      slots.push(cart(la, lo, TEU.z / 2 + 0.05));
    }
    const slotsMid = lin(slots[1], slots[4], 0.5);
    const teuIn = [
      [-1.35, -6.7], [1.35, -6.7], [-1.35, 0], [1.35, 0], [-1.35, 6.7], [1.35, 6.7],
    ];
    const tv = teuIn.map(() => ({ pos: null, q: null }));
    const groundQ = slots.map((p) => hprQ(p, 0));

    function updateVehicle(u) {
      const s = sOfU(u);
      const pos = posOfS(s);
      const e = 1e-4;
      const a = posOfS(Math.max(0, s - e));
      const b = posOfS(Math.min(1, s + e));
      let dir = C.Cartesian3.normalize(C.Cartesian3.subtract(b, a, new C.Cartesian3()), new C.Cartesian3());
      if (!isFinite(dir.x) || C.Cartesian3.magnitude(C.Cartesian3.subtract(b, a, new C.Cartesian3())) < 1e-6) dir = upVec(pos);
      const up = upVec(pos);
      const w = ss((s - 0.9) / 0.05);
      const ax = C.Cartesian3.normalize(lin(dir, up, w), new C.Cartesian3());
      const en = enu(pos);
      let xh = C.Cartesian3.cross(ax, en.n, new C.Cartesian3());
      if (C.Cartesian3.magnitude(xh) < 1e-6) xh = en.e;
      xh = C.Cartesian3.normalize(xh, new C.Cartesian3());
      const yh = C.Cartesian3.cross(ax, xh, new C.Cartesian3());
      const mat = (c0, c1, c2) => new C.Matrix3(c0.x, c1.x, c2.x, c0.y, c1.y, c2.y, c0.z, c1.z, c2.z);
      veh.q = C.Quaternion.fromRotationMatrix(mat(xh, yh, ax));
      veh.qIn = C.Quaternion.fromRotationMatrix(mat(ax, xh, yh));
      veh.pos = pos;
      veh.x = xh;
      veh.y = yh;
      veh.z = ax;
      veh.s = s;
      veh.u = u;
      veh.alt = altOf(s) / 1000;
      // speed from notional mission time
      const d = 0.0008;
      const pa = posOfS(sOfU(Math.max(0, u - d)));
      const pb = posOfS(sOfU(Math.min(1, u + d)));
      veh.speed = C.Cartesian3.distance(pa, pb) / (2 * d * MISSION_S) / 1000; // km/s
      const bump = (c, w2) => Math.exp(-(((u - c) / w2) ** 2));
      veh.g = u < 0.1 ? 1 : u < 0.22 ? 1.4 + 2.8 * ((u - 0.1) / 0.12) : u < 0.7 ? 0.02 : u < 0.82 ? 0.3 + 3.2 * bump(0.76, 0.03) : u < 0.92 ? 1.1 + 0.6 * bump(0.9, 0.012) : 1;
      veh.vib = u < 0.1 ? 0.03 : u < 0.22 ? 1.2 + 1.8 * ((u - 0.1) / 0.12) : u < 0.7 ? 0.03 : u < 0.82 ? 0.4 + 1.6 * bump(0.76, 0.03) : u < 0.92 ? 0.3 + 0.8 * bump(0.9, 0.012) : 0.03;
      veh.vib += rnd(0, 0.05);
      veh.g += rnd(-0.04, 0.04);
      veh.temp = 21 + 6 * bump(0.77, 0.04) + 1.2 * ss((u - 0.1) / 0.12);
      if (u < 0.22) { veh.link = "BS-1 (RF)"; veh.linkOk = true; }
      else if (u < 0.86) { veh.link = "Logging · store-and-forward"; veh.linkOk = false; }
      else { veh.link = "BS-J (RF)"; veh.linkOk = true; }
      // TEU transforms
      const wOff = ss((u - 0.925) / 0.05);
      teuIn.forEach(([lx, lz], k) => {
        let p = madd(madd(pos, xh, lx), ax, lz);
        let q = veh.qIn;
        if (wOff > 0) {
          p = lin(p, slots[k], wOff);
          p = upBy(p, 16 * Math.sin(Math.PI * wOff));
          q = C.Quaternion.slerp(veh.qIn, groundQ[k], wOff, new C.Quaternion());
        }
        tv[k].pos = p;
        tv[k].q = q;
      });
    }
    updateVehicle(0);

    const teuInPos = (k) => tv[k].pos;
    const launchOn = () => active === "launch";
    // vehicle parts
    const part = (zc, len, rTop, rBot, mat, extra) =>
      add("launch", {
        position: CP(() => madd(veh.pos, veh.z, zc)),
        orientation: CP(() => veh.q),
        cylinder: Object.assign({ length: len, topRadius: rTop, bottomRadius: rBot, material: mat }, extra || {}),
      });
    part(-32, 40, 6.5, 6.5, WHITE);
    part(0, 24, 6.5, 6.5, SKY.withAlpha(0.12), { outline: true, outlineColor: css("#bfe6fa", 0.6) });
    part(20, 16, 0.4, 6.5, css("#e8f1f8"));
    // engine flame during ascent
    add(
      "launch",
      {
        position: CP(() => madd(veh.pos, veh.z, -52 - 22)),
        orientation: CP(() => veh.q),
        cylinder: { length: 44, topRadius: 5.5, bottomRadius: 0.3, material: css("#ffb347", 0.75) },
      },
      () => veh.u > 0.098 && veh.u < 0.23 && Math.floor(T * 14) % 2 === 0
    );
    // TEUs in the payload bay, then offloaded at the Japan landing zone
    tv.forEach((_, k) => {
      const tag = { scn: "launch", k };
      teuBox("launch", { pos: CP(() => tv[k].pos), orient: CP(() => tv[k].q), color: PALETTE[(k * 2 + 1) % PALETTE.length], tag });
      indicator("launch", () => upBy(tv[k].pos, 3), {
        dist: 6000,
        ring: true,
        ringCond: () => veh.u > 0.97,
        rBase: 5,
        rGrow: 8,
        size: () => 8,
      });
    });
    // fleet-level indicator (visible from far away)
    indicator("launch", () => veh.pos, { big: true, ring: false, size: () => 14 });
    add("launch", {
      position: CP(() => upBy(veh.pos, 14)),
      label: {
        text: CP(() => "● TRACKED · 6 × TEU\nLuminaBox LB-301–306 · " + (veh.linkOk ? "LINK" : "LOGGING")),
        font: MONO,
        fillColor: WHITE,
        showBackground: true,
        backgroundColor: DARK.withAlpha(0.82),
        backgroundPadding: new C.Cartesian2(8, 5),
        pixelOffset: new C.Cartesian2(0, -16),
        verticalOrigin: C.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: INF,
      },
    });
    // base stations + uplinks
    const bsP = offsetLL(PAD.lat, PAD.lon, -380, -260);
    const bsPad = baseStation("launch", bsP[0], bsP[1], "BS-1 · LC-39A");
    const bsJp = offsetLL(JP.lat, JP.lon, 40, -60);
    const bsJ = baseStation("launch", bsJp[0], bsJp[1], "BS-J · Japan");
    uplink("launch", () => veh.pos, () => bsPad, () => veh.u < 0.22);
    uplink("launch", () => veh.pos, () => bsJ, () => veh.u > 0.86);
    // Japan landing zone
    add("launch", {
      position: cart(JP.lat, JP.lon, 0),
      ellipse: { semiMajorAxis: 60, semiMinorAxis: 60, height: 0, extrudedHeight: 1.5, material: css("#8fb2c9", 0.85) },
    });
    add("launch", {
      position: cart(JP.lat, JP.lon, 40),
      label: {
        text: "Japan · landing zone (notional)",
        font: MONO,
        fillColor: WHITE,
        outlineColor: DARK,
        outlineWidth: 4,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new C.Cartesian2(0, -10),
        verticalOrigin: C.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: INF,
      },
    });
    // trajectory arc (full + travelled)
    const N_ARC = 240;
    const arcS = [];
    for (let i = 0; i <= N_ARC; i++) arcS.push(0.5 - 0.5 * Math.cos((Math.PI * i) / N_ARC));
    const arc = arcS.map((s) => posOfS(s));
    add("launch", { polyline: { positions: arc, width: 2, material: new C.PolylineDashMaterialProperty({ color: css("#9fd8f2", 0.7), dashLength: 18 }) } });
    add("launch", {
      polyline: {
        positions: CP(() => {
          let k = 0;
          while (k < arcS.length && arcS[k] <= veh.s) k++;
          const pts = arc.slice(0, Math.max(1, k));
          pts.push(veh.pos);
          return pts.length >= 2 ? pts : [veh.pos, upBy(veh.pos, 1)];
        }),
        width: 5,
        material: new C.PolylineGlowMaterialProperty({ glowPower: 0.3, color: YEL }),
      },
    });

    // chase / director cameras (scroll adjusts zoom while active)
    const cam = { director: true, ready: false, zoom: 1, roadFollow: false };
    function directorCamera() {
      const u = veh.u;
      const mid = cart((PAD.lat + JP.lat) / 2, (PAD.lon + JP.lon) / 2 + 0, 0);
      const arcMid = (() => {
        const g = geo.interpolateUsingFraction(0.5);
        return C.Cartesian3.fromRadians(g.longitude, g.latitude, 0);
      })();
      void mid;
      const wide = ss((u - 0.17) / 0.14) * (1 - ss((u - 0.72) / 0.12));
      const closeRange = u < 0.92 ? Math.max(125, 2.4 * veh.alt * 1000 + 110) : 105;
      const range = Math.exp((1 - wide) * Math.log(Math.min(closeRange, 4e6)) + wide * Math.log(1.05e7)) * cam.zoom;
      let target = veh.pos;
      if (wide > 0) target = lin(veh.pos, arcMid, wide);
      if (u > 0.92) target = lin(veh.pos, slotsMid, ss((u - 0.92) / 0.05));
      const az = (geo.startHeading * 180) / Math.PI;
      const heading = C.Math.toRadians(wide > 0.05 ? az : u > 0.8 ? 200 : 215 + 20 * ss((u - 0.1) / 0.1));
      const pitch = C.Math.toRadians(-18 - 52 * wide);
      viewer.camera.lookAt(target, new C.HeadingPitchRange(heading, pitch, range));
    }
    function releaseCamera() {
      viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    }

    let lastPhase = -1;
    function tickLaunch() {
      const dt = clamp(T - mission.last, 0, 0.2);
      mission.last = T;
      if (mission.playing) {
        mission.u = Math.min(1, mission.u + dt / PLAY_S);
        if (mission.u >= 1) setPlaying(false);
        $("#mission-t").value = Math.round(mission.u * 1000);
      }
      updateVehicle(mission.u);
      const ph = PHASES.findIndex((p, i) => mission.u >= p.u0 && (mission.u < p.u1 || i === PHASES.length - 1));
      if (ph !== lastPhase) {
        if (ph >= 0 && lastPhase >= 0 && ph > lastPhase) {
          const msg = ["", "Liftoff · vibration rising", "Main engine cutoff · coast", "Re-entry interface · logging continues", "Landing burn · link re-acquired", "Landed · offloading TEUs"][ph];
          if (msg) log("launch", msg);
        }
        lastPhase = ph;
        document.querySelectorAll("#phase-row li").forEach((li, i) => li.classList.toggle("is-on", i === ph));
      }
      if (veh.u >= 0.99 && !mission.synced) {
        mission.synced = true;
        log("launch", "TEUs delivered · data synced · 6/6 nominal");
      }
      if (veh.u < 0.5) mission.synced = false;
      $("#mission-out").textContent = "T+" + mmss(veh.u * MISSION_S);
      if (cam.director && cam.ready) directorCamera();
    }

    function feedLaunch() {
      const ph = PHASES[Math.max(0, PHASES.findIndex((p, i) => veh.u >= p.u0 && (veh.u < p.u1 || i === PHASES.length - 1)))];
      const delivered = veh.u >= 0.99;
      return (
        '<div class="lb-asset"><span class="lb-badge ' + (veh.linkOk ? "ok" : "log") + '">' + (veh.linkOk ? "TRACKING" : "LOGGING") + "</span><b>LB-301–306</b><small>6 × TEU · " + ph.name + "</small></div>" +
        '<div class="kvs">' +
        kv("Mission time", "T+" + mmss(veh.u * MISSION_S)) +
        kv("Altitude", veh.alt < 1 ? "0 km" : veh.alt.toFixed(veh.alt < 100 ? 1 : 0) + " km") +
        kv("Speed", veh.speed < 0.05 ? "0 km/s" : veh.speed.toFixed(2) + " km/s") +
        kv("Accel", veh.g.toFixed(1) + " g", veh.g > 2.5 ? "alert" : "") +
        kv("Vibration", veh.vib.toFixed(2) + " g rms", veh.vib > 1.5 ? "alert" : "") +
        kv("Temp", veh.temp.toFixed(0) + " °C") +
        kv("Link", veh.link) +
        kv("TEUs reporting", delivered ? "6/6 · synced" : "6/6") +
        "</div>" +
        logHTML("launch")
      );
    }

    /* =====================================================================
       UI wiring
       ===================================================================== */
    const overlay = $("#lb-overlay");
    const followBtn = $("#lb-follow");
    const tabs = document.querySelectorAll(".stab");
    const META = {
      road: { title: "LuminaBox LB-207", sub: "Tracking 1 TEU · road transit", chip: "Time-lapse 10× · simulated telemetry", follow: "Follow asset (scroll to zoom)" },
      warehouse: { title: "LuminaBox inventory", sub: "Tracking 36 TEUs · staging warehouse", chip: "Simulated inventory feed · click a container", follow: null },
      launch: { title: "LuminaBox LB-301–306", sub: "Tracking 6 TEUs · Cape → Japan", chip: "Notional trajectory · simulated", follow: "Director camera (scroll to zoom)" },
    };
    const ctlForecast = $("#ctl-forecast");
    const ctlMission = $("#ctl-mission");
    const phaseRow = $("#phase-row");
    const wxReadout = $("#wx-readout");

    phaseRow.innerHTML = PHASES.map((p, i) => '<li><button type="button" data-ph="' + i + '">' + (i + 1) + ". " + p.name + "</button></li>").join("");

    function setPlaying(on) {
      mission.playing = on;
      $("#mission-play").textContent = on ? "Pause" : mission.u >= 1 ? "Replay" : "Play";
      $("#mission-play").setAttribute("aria-pressed", String(on));
    }

    function setScenario(id, opts) {
      opts = opts || {};
      if (id === active && !opts.force) return;
      const prev = active;
      if (prev === "launch") {
        cam.ready = false;
        releaseCamera();
        viewer.scene.screenSpaceCameraController.maximumZoomDistance = 160000;
        setPlaying(false);
      }
      if (prev === "road" && cam.roadFollow) {
        cam.roadFollow = false;
        releaseCamera();
      }
      cam.zoom = 1;
      active = id;
      tabs.forEach((t) => {
        const on = t.dataset.scn === id;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", String(on));
      });
      const m = META[id];
      $("#lb-title").textContent = m.title;
      $("#lb-sub").textContent = m.sub;
      $("#lb-chip").textContent = m.chip;
      followBtn.hidden = !m.follow;
      followBtn.textContent = m.follow || "";
      followBtn.setAttribute("aria-pressed", id === "launch" ? "true" : "false");
      ctlForecast.hidden = id !== "road";
      ctlMission.hidden = id !== "launch";
      phaseRow.hidden = id !== "launch";
      wxReadout.hidden = id === "launch";
      // weather overlays: hidden during the global launch view, restored otherwise
      if (id === "launch") {
        layers.wind.forEach((e) => (e.show = false));
        layers.precip.forEach((e) => (e.show = false));
        layers.rocket.forEach((e) => (e.show = false));
        viewer.scene.screenSpaceCameraController.maximumZoomDistance = Infinity;
      } else {
        layers.rocket.forEach((e) => (e.show = true));
        ["wind", "precip"].forEach((k) => {
          const cb = document.querySelector('[data-layer="' + k + '"]');
          if (cb) cb.dispatchEvent(new Event("change"));
        });
      }
      tickActive();
      applyVisibility();
      if (opts.noFly) return;
      if (id === "road") {
        viewer.camera.flyToBoundingSphere(new C.BoundingSphere(cart(28.59, -80.632, 0), 1), {
          duration: 1.8,
          offset: new C.HeadingPitchRange(C.Math.toRadians(0), C.Math.toRadians(-52), 7800),
        });
      } else if (id === "warehouse") {
        viewer.camera.flyToBoundingSphere(new C.BoundingSphere(cart(WH.lat, WH.lon, 4), 1), {
          duration: 1.8,
          offset: new C.HeadingPitchRange(C.Math.toRadians(25), C.Math.toRadians(-42), 190),
        });
      } else {
        viewer.camera.flyToBoundingSphere(new C.BoundingSphere(veh.pos, 1), {
          duration: 1.6,
          offset: new C.HeadingPitchRange(C.Math.toRadians(215), C.Math.toRadians(-18), 260),
          complete: () => {
            if (active === "launch") {
              cam.ready = true;
              cam.director = followBtn.getAttribute("aria-pressed") === "true";
              if (!cam.director) releaseCamera();
            }
          },
        });
      }
    }
    function tickActive() {
      if (active === "road") tickRoad();
      else if (active === "warehouse") tickWarehouse();
      else tickLaunch();
    }

    tabs.forEach((t) => t.addEventListener("click", () => setScenario(t.dataset.scn)));
    window.addEventListener("twin:prefly", () => {
      if (active !== "road") setScenario("road", { noFly: true });
    });
    followBtn.addEventListener("click", () => {
      const on = followBtn.getAttribute("aria-pressed") !== "true";
      followBtn.setAttribute("aria-pressed", String(on));
      cam.zoom = 1;
      if (active === "road") {
        cam.roadFollow = on;
        if (!on) releaseCamera();
      }
      if (active === "launch") {
        cam.director = on;
        if (!on) releaseCamera();
      }
    });
    $("#mission-t").addEventListener("input", (ev) => {
      setPlaying(false);
      mission.u = parseInt(ev.target.value, 10) / 1000;
    });
    $("#mission-play").addEventListener("click", () => {
      if (mission.playing) return setPlaying(false);
      if (mission.u >= 1) mission.u = 0;
      setPlaying(true);
    });
    phaseRow.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-ph]");
      if (!b) return;
      const p = PHASES[parseInt(b.dataset.ph, 10)];
      setPlaying(false);
      mission.u = Math.min(0.999, p.u0 + 0.004);
      $("#mission-t").value = Math.round(mission.u * 1000);
    });
    const assetCb = document.querySelector('[data-layer="assets"]');
    assetCb.addEventListener("change", () => {
      assetsOn = assetCb.checked;
      applyVisibility();
    });

    // click a container to inspect its LuminaBox
    const handler = new C.ScreenSpaceEventHandler(viewer.canvas);
    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      const tag = picked && picked.id && picked.id._lb;
      if (tag && tag.scn === "warehouse" && active === "warehouse") selected = tag.b;
    }, C.ScreenSpaceEventType.LEFT_CLICK);

    // render loop + feed
    viewer.scene.preRender.addEventListener(() => {
      T = performance.now() / 1000;
      tickActive();
      if (active === "road" && cam.roadFollow) {
        viewer.camera.lookAt(
          road.pTeu,
          new C.HeadingPitchRange(C.Math.toRadians(road.hdg + 150), C.Math.toRadians(-24), 75 * cam.zoom)
        );
      }
    });
    viewer.canvas.addEventListener(
      "wheel",
      (ev) => {
        if ((active === "road" && cam.roadFollow) || (active === "launch" && cam.director && cam.ready)) {
          cam.zoom = clamp(cam.zoom * (ev.deltaY > 0 ? 1.12 : 0.89), 0.25, 4);
          ev.preventDefault();
          ev.stopImmediatePropagation();
        }
      },
      { capture: true, passive: false }
    );
    setInterval(() => {
      applyVisibility();
    }, 400);
    setInterval(() => {
      $("#lb-feed-body").innerHTML = active === "road" ? feedRoad() : active === "warehouse" ? feedWarehouse() : feedLaunch();
    }, 250);

    overlay.hidden = false;
    setScenario("road", { force: true, noFly: true });
    log("road", "LB-207 online · link established with BS-1");
    log("warehouse", "Gateway BS-W online · " + whBox.length + " LuminaBoxes joined");
    log("launch", "LB-301–306 armed · link BS-1");
    void teuInPos;
    void launchOn;
  }
})();
