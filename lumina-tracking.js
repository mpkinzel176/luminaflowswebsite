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
    const groups = { road: [], warehouse: [], launch: [], shipping: [], sat: [] };
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
          const on = k === "sat" ? active === "launch" || active === "shipping" : k === active;
          e.show = assetsOn && on && (!e._cond || e._cond());
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
    let linkFilter = "all";
    const lk = (t) => () => linkFilter === "all" || linkFilter === t;
    const CELLC = GRN;
    const DGRN = css("#235c3a");
    function baseStation(scn, lat, lon, name, cond, ringM) {
      const top = cart(lat, lon, 32);
      if (ringM) add(scn, { position: cart(lat, lon, 0), ellipse: { semiMajorAxis: ringM, semiMinorAxis: ringM, height: 0.3, material: SKY.withAlpha(0.08) } }, cond);
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

    function cellTower(scn, lat, lon, name, rangeM, cond) {
      const top = cart(lat, lon, 36);
      add(scn, { position: cart(lat, lon, 18), cylinder: { length: 36, topRadius: 0.5, bottomRadius: 1.5, material: css("#8fc7a5") } }, cond);
      if (rangeM) add(scn, { position: cart(lat, lon, 0), ellipse: { semiMajorAxis: rangeM, semiMinorAxis: rangeM, height: 0.3, material: CELLC.withAlpha(0.08) } }, cond);
      add(
        scn,
        {
          position: top,
          point: { pixelSize: 10, color: CP(() => (Math.floor(T * 1.5) % 2 ? CELLC : DGRN)), outlineColor: WHITE, outlineWidth: 1, disableDepthTestDistance: INF },
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

    // Typed link line with data packets: type is "rf" (base station), "cell" (cellular) or "sat".
    function uplink(scn, aFn, bFn, cond, o) {
      o = o || {};
      const type = o.type || "rf";
      const col = o.color || SKY;
      const c2 = () => (!cond || cond()) && lk(type)();
      add(scn, { polyline: { positions: CP(() => [aFn(), bFn()]), width: 2, material: new C.PolylineDashMaterialProperty({ color: col, dashLength: 14 }) } }, c2);
      [0, 0.5].forEach((k) =>
        add(
          scn,
          {
            position: CP(() => lin(aFn(), bFn(), (T / 1.4 + k) % 1)),
            point: { pixelSize: 5, color: WHITE, disableDepthTestDistance: INF },
          },
          c2
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
            outlineColor: o.halo ? CP(() => col().withAlpha(0.15 + 0.85 * (1 - ph()))) : WHITE,
            outlineWidth: o.halo ? CP(() => 3 + 10 * ph()) : 2,
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

    const feedLog = { road: [], warehouse: [], launch: [], shipping: [] };
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
       Time history store + SVG chart (per-TEU traces with event markers)
       ===================================================================== */
    const HN = 260;
    const hist = {};
    const HS = (id) => hist[id] || (hist[id] = { s: [], ev: [] });
    function hpush(id, s) {
      const h = HS(id);
      h.s.push(s);
      if (h.s.length > HN) h.s.shift();
    }
    function hevent(id, e) {
      const h = HS(id);
      h.ev.push(e);
      if (h.ev.length > 30) h.ev.shift();
    }
    const spanTxt = (sec) => (sec >= 7200 ? (sec / 3600).toFixed(1) + " h" : sec >= 120 ? Math.round(sec / 60) + " min" : Math.round(sec) + " s");

    function chart(o) {
      const W = 268;
      const Hh = o.h || 92;
      const L = 30;
      const R = 6;
      const Tp = 6;
      const B = 16;
      const pw = W - L - R;
      const ph = Hh - Tp - B;
      const x0 = o.xr[0];
      const x1 = o.xr[1];
      const y0 = o.yr[0];
      const y1 = o.yr[1];
      const X = (x) => L + ((x - x0) / (x1 - x0 || 1)) * pw;
      const Y = (y) => Tp + (1 - (clamp(y, y0, y1) - y0) / (y1 - y0 || 1)) * ph;
      let g = "";
      (o.bands || []).forEach((b) => {
        const bx = X(b.x0);
        g += '<rect x="' + bx.toFixed(1) + '" y="' + Tp + '" width="' + Math.max(0, X(b.x1) - bx).toFixed(1) + '" height="' + ph + '" fill="' + b.fill + '"/>';
        if (b.label) g += '<text x="' + (bx + 2).toFixed(1) + '" y="' + (Tp + 8) + '" class="hc-band">' + b.label + "</text>";
      });
      [0, 0.5, 1].forEach((f) => {
        const yv = y0 + (y1 - y0) * f;
        const yy = Y(yv);
        g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" class="hc-grid"/><text x="' + (L - 3) + '" y="' + (yy + 3).toFixed(1) + '" class="hc-tick" text-anchor="end">' + (o.yfmt ? o.yfmt(yv) : yv.toFixed(1)) + "</text>";
      });
      (o.thresholds || []).forEach((t) => {
        const yy = Y(t.y);
        g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="' + t.color + '" stroke-dasharray="4 3" stroke-width="1"/><text x="' + (W - R - 2) + '" y="' + (yy - 2).toFixed(1) + '" class="hc-thr" fill="' + t.color + '" text-anchor="end">' + t.label + "</text>";
      });
      (o.series || []).forEach((s) => {
        const pts = s.pts;
        if (!pts.length) return;
        const d = (arr) => arr.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("");
        if (s.upto != null) {
          g += '<path d="' + d(pts) + '" fill="none" stroke="' + s.color + '" stroke-opacity="0.28" stroke-width="1.4"/>';
          const part = pts.filter((p) => p[0] <= s.upto);
          if (part.length > 1) g += '<path d="' + d(part) + '" fill="none" stroke="' + s.color + '" stroke-width="1.8"/>';
        } else {
          g += '<path d="' + d(pts) + '" fill="none" stroke="' + s.color + '" stroke-width="1.6" stroke-linejoin="round"/>';
        }
      });
      (o.events || []).forEach((e) => {
        if (e.x < x0 || e.x > x1) return;
        g += '<circle cx="' + X(e.x).toFixed(1) + '" cy="' + Y(e.y).toFixed(1) + '" r="3.6" fill="' + (e.color || "#ff6b5b") + '" stroke="#fff" stroke-width="1"/>';
      });
      if (o.cursor != null) g += '<line x1="' + X(o.cursor).toFixed(1) + '" x2="' + X(o.cursor).toFixed(1) + '" y1="' + Tp + '" y2="' + (Tp + ph) + '" stroke="#ffdf3c" stroke-width="1.4"/>';
      if (o.xl) g += '<text x="' + L + '" y="' + (Hh - 3) + '" class="hc-tick">' + o.xl[0] + '</text><text x="' + (W - R) + '" y="' + (Hh - 3) + '" class="hc-tick" text-anchor="end">' + o.xl[1] + "</text>";
      return '<svg class="hchart" viewBox="0 0 ' + W + " " + Hh + '" ' + (o.attrs || "") + ' role="img" aria-label="' + (o.aria || "history chart") + '">' + g + "</svg>";
    }
    // Rolling chart of one stored series for a TEU id
    function rollChart(id, key, o) {
      const h = HS(id);
      const s = h.s;
      if (s.length < 2) return '<div class="hc-empty">collecting history…</div>';
      const x0 = s[0].w;
      const x1 = s[s.length - 1].w;
      return chart(
        Object.assign(
          {
            xr: [x0, x1 + 1e-6],
            series: [{ pts: s.map((p) => [p.w, p[key]]), color: o.color || "#41b7e3" }],
            events: h.ev.filter((e) => e.kind === o.kind || !o.kind).map((e) => ({ x: e.w, y: e.y, color: e.color })),
            xl: ["−" + spanTxt(x1 - x0), "now"],
          },
          o
        )
      );
    }
    const hcBlock = (title, svg) => '<div class="hc"><div class="hc-title">' + title + "</div>" + svg + "</div>";

    /* =====================================================================
       (a) ROAD TRANSIT on the real Kennedy Space Center road network (OpenStreetMap)
       Convoy: Logistics Facility -> VAB. Six TEUs are integrated into the launch vehicle,
       which rolls out on the Crawlerway to Pad A. Pad B traffic shares the roads.
       ===================================================================== */
    const KS = window.KSC;
    const COSL = Math.cos((28.58 * Math.PI) / 180);
    function mkPath(pts) {
      const c = pts.map(([la, lo]) => cart(la, lo, 0));
      const cum = [0];
      for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + C.Cartesian3.distance(c[i - 1], c[i]));
      return { pts, c, cum, total: cum[cum.length - 1] };
    }
    function pathAt(P, s) {
      const d = clamp(s, 0, P.total);
      let i = 1;
      while (i < P.cum.length - 1 && d > P.cum[i]) i++;
      const k = (d - P.cum[i - 1]) / (P.cum[i] - P.cum[i - 1] || 1);
      const a = P.pts[i - 1];
      const b = P.pts[i];
      const la = a[0] + (b[0] - a[0]) * k;
      const lo = a[1] + (b[1] - a[1]) * k;
      return { la, lo, brg: (Math.atan2((b[1] - a[1]) * COSL, b[0] - a[0]) * 180) / Math.PI };
    }
    function projectPath(P, ll) {
      let best = 1e18;
      let bs = 0;
      for (let i = 1; i < P.pts.length; i++) {
        const a = P.pts[i - 1];
        const b = P.pts[i];
        const ax = a[1] * COSL, ay = a[0], bx = b[1] * COSL, by = b[0], px = ll[1] * COSL, py = ll[0];
        const dx = bx - ax, dy = by - ay;
        const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1e-18), 0, 1);
        const dd = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
        if (dd < best) {
          best = dd;
          bs = P.cum[i - 1] + (P.cum[i] - P.cum[i - 1]) * t;
        }
      }
      return bs;
    }
    const R_WV = mkPath(KS.routes.wv);
    const R_CR = mkPath(KS.routes.crawler);
    const R_OT = mkPath(KS.routes.other);
    const PT = KS.points;
    const A = {
      j1wv: projectPath(R_WV, PT.J1),
      j1ot: projectPath(R_OT, PT.J1),
      mOT: projectPath(R_OT, PT.M),
      fOT: projectPath(R_OT, PT.F),
      mCR: projectPath(R_CR, PT.M),
      fCR: projectPath(R_CR, PT.F),
    };
    const routeLine = (P, color, dash) =>
      add("road", {
        polyline: {
          positions: C.Cartesian3.fromDegreesArray(P.pts.flatMap(([la, lo]) => [lo, la])),
          width: 5,
          clampToGround: true,
          material: dash ? new C.PolylineDashMaterialProperty({ color, dashLength: 18 }) : color,
        },
      });
    routeLine(R_WV, css("#3ee0c6", 0.95));
    routeLine(R_CR, YEL.withAlpha(0.9));
    routeLine(R_OT, css("#ff9a3c", 0.9), true);

    const NT = 10; // convoy TEUs (LB-201..210): first 6 are integrated, last 4 return
    const NB = 34; // pool of Pad B vehicles
    const V_TRUCK = 9; // m/s (~32 km/h)
    const V_CRAWLER = 0.45; // m/s (~1.6 km/h)
    const V_OT = 11; // m/s (~40 km/h)
    const TLX_A = 8;
    const TLX_B = 120;
    const ZONE_R = 30;
    const DMG = [
      { s: 300, name: "D-1", n: 0, peak: 0, flagged: false },
      { s: 760, name: "D-2", n: 0, peak: 0, flagged: false },
    ];
    const road = { sel: 0, focus: null, hdg: 0, range: 75, chip: "" };
    const sim = { W: 0, cw: 0, phase: "convoy", pT: 0, hold: 0, tlx: TLX_A, last: T, integrated: 0, nextB: 6, jHold: false, jHoldUntil: 0, sampleAcc: 0, cycle: 0, stat: { convoyHold: 0, otDelaySum: 0, otDone: 0, queue: 0, otMax: 0 }, crawlerNote: false };
    const crawler = { active: false, s: 0, v: 0, pos: null, brg: 0, base: null, stage: null, bay: null, nose: null, teu: [], qBox: null, qUp: null, qTeu: null };
    const bsPosR = [28.5853, -80.6483];
    const bs1 = baseStation("road", bsPosR[0], bsPosR[1], "BS-1 · Base station (LCC)");
    const bs1f = () => bs1;

    const trucks = [];
    for (let k = 0; k < NT; k++) {
      trucks.push({ k, id: "LB-" + (201 + k), s: 0, v: 0, state: "wait", holdJ: 0, dep: k * 6, pFlat: null, pCab: null, pTeu: null, pTop: null, q: null, brg: 0, az: 1, vib: 0.03, temp: 26, rh: 55, speed: 0, loc: "dock", hot: false, hotUntil: 0, color: PALETTE[(k * 2) % PALETTE.length] });
    }
    const bvs = [];
    for (let i = 0; i < NB; i++) bvs.push({ i, active: false, s: 0, v: 0, type: i % 3 === 0 ? "van" : "tanker", spawnW: 0, pos: null, q: null });

    function poseTruck(t) {
      const R = R_WV;
      const pa = pathAt(R, t.s);
      const brg = t.state === "return" ? pa.brg + 180 : pa.brg;
      t.brg = brg;
      const [cl, co] = offsetLL(pa.la, pa.lo, Math.sin((brg * Math.PI) / 180) * 5.9, Math.cos((brg * Math.PI) / 180) * 5.9);
      t.pFlat = cart(pa.la, pa.lo, 0.95);
      t.pCab = cart(cl, co, 1.9);
      t.pTeu = cart(pa.la, pa.lo, 1.3 + TEU.z / 2);
      t.pTop = cart(pa.la, pa.lo, 1.3 + TEU.z + 0.5);
      t.q = hprQ(t.pTeu, brg - 90);
    }
    function poseB(b) {
      const pa = pathAt(R_OT, b.s);
      b.pos = cart(pa.la, pa.lo, b.type === "van" ? 1.4 : 2.0);
      b.q = hprQ(b.pos, pa.brg - 90);
    }
    const uprightQ = (pos) => {
      const en = enu(pos);
      return C.Quaternion.fromRotationMatrix(new C.Matrix3(en.u.x, en.e.x, en.n.x, en.u.y, en.e.y, en.n.y, en.u.z, en.e.z, en.n.z));
    };
    const CR_TEU = [[-1.35, -6.6], [1.35, -6.6], [-1.35, 0], [1.35, 0], [-1.35, 6.6], [1.35, 6.6]];
    function poseCrawler() {
      const pa = pathAt(R_CR, crawler.s);
      crawler.brg = pa.brg;
      const g = (h) => cart(pa.la, pa.lo, h);
      crawler.pos = g(0);
      crawler.base = g(3);
      crawler.stage = g(6 + 20);
      crawler.bay = g(6 + 40 + 12);
      crawler.nose = g(6 + 64 + 8);
      crawler.qBox = hprQ(crawler.base, pa.brg - 90);
      crawler.qUp = hprQ(crawler.stage, 0);
      crawler.qTeu = uprightQ(crawler.bay);
      CR_TEU.forEach(([lx, lz], k) => {
        const [la, lo] = offsetLL(pa.la, pa.lo, lx, 0);
        crawler.teu[k] = cart(la, lo, 58 + lz);
      });
    }

    // ---- entities ----
    const visT = (t) => () => t.state === "drive" || t.state === "return";
    trucks.forEach((t) => {
      const vis = visT(t);
      add("road", { position: CP(() => t.pFlat), orientation: CP(() => t.q), box: { dimensions: new C.Cartesian3(7.6, 2.7, 0.7), material: css("#26384a"), outline: true, outlineColor: EDGE } }, vis);
      add("road", { position: CP(() => t.pCab), orientation: CP(() => t.q), box: { dimensions: new C.Cartesian3(2.8, 2.5, 3.0), material: css("#c9ced4"), outline: true, outlineColor: EDGE } }, vis);
      teuBox("road", { pos: CP(() => t.pTeu), orient: CP(() => t.q), color: t.color, tag: { scn: "road", k: t.k }, cond: vis });
      add("road", { position: CP(() => t.pTop), orientation: CP(() => t.q), box: { dimensions: new C.Cartesian3(0.9, 0.6, 0.4), material: SKY, outline: true, outlineColor: WHITE } }, vis);
      indicator("road", () => t.pTop, {
        size: () => (road.sel === t.k ? 14 : 8),
        color: () => (t.hot ? RED : SKY),
        ring: true,
        ringCond: () => vis() && (road.sel === t.k || t.hot),
        rBase: 9,
        rGrow: 14,
        beacon: 60,
        cond: vis,
      });
    });
    // Pad B vehicles
    const TANKC = css("#e8ecef");
    const VANC = css("#8e9aa6");
    bvs.forEach((b) =>
      add(
        "road",
        {
          position: CP(() => b.pos),
          orientation: CP(() => b.q),
          box: {
            dimensions: b.type === "van" ? new C.Cartesian3(5, 2.1, 2.2) : new C.Cartesian3(9.5, 2.6, 3.2),
            material: new C.ColorMaterialProperty(CP(() => (b.v < 0.6 ? RED : b.type === "van" ? VANC : TANKC))),
            outline: true,
            outlineColor: EDGE,
          },
        },
        () => b.active
      )
    );
    // launch vehicle on the crawler-transporter (6 TEUs in the payload bay)
    const crAct = () => crawler.active;
    add("road", { position: CP(() => crawler.base), orientation: CP(() => crawler.qBox), box: { dimensions: new C.Cartesian3(46, 40, 6), material: css("#3a4a5a"), outline: true, outlineColor: EDGE } }, crAct);
    add("road", { position: CP(() => crawler.stage), orientation: CP(() => crawler.qUp), cylinder: { length: 40, topRadius: 6.5, bottomRadius: 6.5, material: WHITE } }, crAct);
    add("road", { position: CP(() => crawler.bay), orientation: CP(() => crawler.qUp), cylinder: { length: 24, topRadius: 6.5, bottomRadius: 6.5, material: SKY.withAlpha(0.14), outline: true, outlineColor: css("#bfe6fa", 0.6) } }, crAct);
    add("road", { position: CP(() => crawler.nose), orientation: CP(() => crawler.qUp), cylinder: { length: 16, topRadius: 0.4, bottomRadius: 6.5, material: css("#e8f1f8") } }, crAct);
    CR_TEU.forEach((_, k) => {
      teuBox("road", { pos: CP(() => crawler.teu[k]), orient: CP(() => crawler.qTeu), color: trucks[k].color, tag: { scn: "road", k }, cond: crAct });
      indicator("road", () => upBy(crawler.teu[k], 4), { size: () => (road.sel === k ? 12 : 7), ring: false, dist: 2500, cond: crAct, color: () => SKY });
    });
    indicator("road", () => upBy(crawler.bay, 22), { big: true, ring: false, halo: true, size: () => 12, cond: crAct });
    add("road", {
      position: CP(() => upBy(crawler.bay, 30)),
      label: {
        text: CP(() => "● TRACKED · 6 × TEU (LB-201–206)\nCrawler-transporter · " + (crawler.v * 3.6).toFixed(1) + " km/h"),
        font: MONO,
        fillColor: WHITE,
        showBackground: true,
        backgroundColor: DARK.withAlpha(0.82),
        backgroundPadding: new C.Cartesian2(8, 5),
        verticalOrigin: C.VerticalOrigin.BOTTOM,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 20000),
        disableDepthTestDistance: INF,
      },
    }, crAct);
    // selected-truck callout
    add("road", {
      position: CP(() => upBy(trucks[road.sel].pTop, 70)),
      label: {
        text: CP(() => {
          const t = trucks[road.sel];
          return "● TRACKED · LuminaBox " + t.id + "\n" + t.speed.toFixed(0) + " km/h · " + t.az.toFixed(2) + " g · " + t.temp.toFixed(0) + " °C";
        }),
        font: MONO,
        fillColor: WHITE,
        showBackground: true,
        backgroundColor: DARK.withAlpha(0.82),
        backgroundPadding: new C.Cartesian2(8, 5),
        verticalOrigin: C.VerticalOrigin.BOTTOM,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 6000),
        disableDepthTestDistance: INF,
      },
    }, () => visT(trucks[road.sel])());
    const CELL_LL = [28.56228, -80.66941]; // real KSC communication tower (OpenStreetMap)
    const cellRoad = cellTower("road", CELL_LL[0], CELL_LL[1], "Cell tower \u00B7 KSC comms tower", 3500);
    const padAp = offsetLL(SITES.lc39a.lat, SITES.lc39a.lon, -380, -260);
    const bsAr = baseStation("road", padAp[0], padAp[1], "BS-A \u00B7 LC-39A", null, 600);
    const roadAsset = () => {
      const t = trucks[road.sel];
      if (t.state === "drive" || t.state === "return" || t.state === "wait" || t.state === "home") return t.pTop;
      return crawler.active ? upBy(crawler.bay, 22) : upBy(cart(KS.vab.center[0], KS.vab.center[1], 0), 30);
    };
    const LNAME = { rf: "RF base station", cell: "cellular", sat: "SATCOM" };
    road.link = { type: "rf", tgt: bs1f, text: "RF \u00B7 BS-1" };
    let roadSat = null; // created after the satellite block
    function roadLinkUpdate() {
      const p = roadAsset();
      const d1 = C.Cartesian3.distance(p, bs1);
      const dA = C.Cartesian3.distance(p, bsAr);
      const dC = C.Cartesian3.distance(p, cellRoad);
      let L;
      if (d1 < 600) L = { type: "rf", tgt: bs1f, text: "RF \u00B7 BS-1 \u00B7 " + (d1 / 1000).toFixed(1) + " km" };
      else if (dA < 600) L = { type: "rf", tgt: () => bsAr, text: "RF \u00B7 BS-A \u00B7 " + (dA / 1000).toFixed(1) + " km" };
      else if (dC < 3500) L = { type: "cell", tgt: () => cellRoad, text: "Cellular LTE \u00B7 tower " + (dC / 1000).toFixed(1) + " km" };
      else L = { type: "sat", tgt: null, text: "SATCOM" };
      if (L.type !== road.link.type) log("road", trucks[road.sel].id + ": " + LNAME[road.link.type] + " \u2192 " + LNAME[L.type]);
      if (L.type === "sat" && roadSat) {
        roadSat.eval();
        L.text = roadSat.ok ? "SATCOM \u00B7 SAT-" + (roadSat.a + 1) + " \u00B7 " + roadSat.el.toFixed(0) + "\u00B0 el" : "SATCOM \u00B7 searching";
      }
      road.link = L;
    }
    uplink("road", roadAsset, () => (typeof road.link.tgt === "function" ? road.link.tgt() : bs1), () => active === "road" && road.link.type === "rf" && typeof road.link.tgt === "function", { type: "rf" });
    uplink("road", roadAsset, () => cellRoad, () => active === "road" && road.link.type === "cell", { type: "cell", color: CELLC });

    // damaged-road markers (detected from TEU shock readings)
    DMG.forEach((p) => {
      const pa = pathAt(R_WV, p.s);
      add("road", { position: cart(pa.la, pa.lo, 0), ellipse: { semiMajorAxis: 16, semiMinorAxis: 16, height: 0.5, material: RED.withAlpha(0.5) } }, () => p.flagged);
      add("road", {
        position: cart(pa.la, pa.lo, 14),
        point: { pixelSize: 9, color: RED, outlineColor: WHITE, outlineWidth: 2, disableDepthTestDistance: INF },
        label: {
          text: CP(() => "⚠ Road damage " + p.name + " · " + f1(p.peak) + " g peak · " + p.n + " TEU hits"),
          font: MONO,
          fillColor: WHITE,
          outlineColor: DARK,
          outlineWidth: 4,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new C.Cartesian2(0, -12),
          verticalOrigin: C.VerticalOrigin.BOTTOM,
          distanceDisplayCondition: new C.DistanceDisplayCondition(0, 5000),
          disableDepthTestDistance: INF,
        },
      }, () => p.flagged);
    });
    // conflict markers
    const jp = cart(PT.J1[0], PT.J1[1], 0);
    add("road", { position: jp, ellipse: { semiMajorAxis: ZONE_R, semiMinorAxis: ZONE_R, height: 0.5, material: new C.ColorMaterialProperty(CP(() => (sim.jHoldUntil > T ? RED.withAlpha(0.5) : AMB.withAlpha(0.28)))) } });
    add("road", {
      position: cart(PT.J1[0], PT.J1[1], 25),
      label: { text: "⚠ Conflict zone · Pad B traffic ↔ TEU convoy", font: MONO, fillColor: WHITE, showBackground: true, backgroundColor: DARK.withAlpha(0.82), backgroundPadding: new C.Cartesian2(7, 4), verticalOrigin: C.VerticalOrigin.BOTTOM, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 7000), disableDepthTestDistance: INF },
    });
    const midCR = pathAt(R_CR, (A.mCR + A.fCR) / 2);
    add("road", {
      position: cart(midCR.la, midCR.lo, 25),
      label: { text: "⚠ Shared Crawlerway · Pad B traffic queues behind the crawler", font: MONO, fillColor: WHITE, showBackground: true, backgroundColor: DARK.withAlpha(0.82), backgroundPadding: new C.Cartesian2(7, 4), verticalOrigin: C.VerticalOrigin.BOTTOM, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 9000), disableDepthTestDistance: INF },
    });
    const bstart = pathAt(R_OT, 0);
    add("road", { position: cart(bstart.la, bstart.lo, 6), label: { text: "Pad B traffic → LC-39B", font: MONO, fillColor: css("#ffb36b"), outlineColor: DARK, outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: C.VerticalOrigin.BOTTOM, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 9000), disableDepthTestDistance: INF } });
    add("road", { position: cart(KS.dock[0], KS.dock[1], 6), label: { text: "Logistics Facility dock", font: MONO, fillColor: css("#7fe9d6"), outlineColor: DARK, outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: C.VerticalOrigin.BOTTOM, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 4000), disableDepthTestDistance: INF } });

    // ---- simulation ----
    function spawnB() {
      const b = bvs.find((x) => !x.active);
      if (!b) return;
      b.active = true;
      b.s = 0;
      b.v = V_OT;
      b.spawnW = sim.W;
      poseB(b);
    }
    function dmgHit(t, p) {
      const g = rnd(2.7, 4.2) * (0.9 + 0.2 * Math.min(1, t.v / V_TRUCK));
      p.n++;
      p.peak = Math.max(p.peak, g);
      t.hot = true;
      t.hotUntil = T + 2.2;
      hpush(t.id, { w: sim.W, az: 1 + g, vib: 0.4 + g * 0.2, temp: t.temp, rh: t.rh, loc: "road" });
      hevent(t.id, { w: sim.W, y: 1 + g, kind: "dmg", label: p.name, color: "#ff6b5b" });
      if (!p.flagged) {
        p.flagged = true;
        log("road", "Road damage " + p.name + " detected · " + f1(1 + g) + " g · " + t.id + " · segment flagged for repair");
      } else if (p.n === 3) log("road", p.name + " confirmed by 3 TEUs · repair ticket raised");
    }
    function stepWorld(dw) {
      sim.W += dw;
      sim.cw += dw;
      const sInWv = A.j1wv - ZONE_R;
      const sOutWv = A.j1wv + ZONE_R;
      const sInOt = A.j1ot - ZONE_R;
      const sOutOt = A.j1ot + ZONE_R;
      const rollout = sim.phase === "rollout" || sim.phase === "onpad";
      sim.nextB -= dw;
      if (sim.nextB <= 0) {
        spawnB();
        sim.nextB = rollout ? rnd(110, 190) : rnd(28, 55);
      }
      const wvIn = trucks.some((t) => t.state === "drive" && t.s > sInWv && t.s < sOutWv);
      const otIn = bvs.some((b) => b.active && b.s > sInOt && b.s < sOutOt);
      const otNear = bvs.some((b) => b.active && b.s <= sInOt && b.s > sInOt - 45);
      // convoy
      trucks.forEach((t) => {
        if (t.state === "wait" && sim.cw >= t.dep && sim.phase === "convoy") {
          t.state = "drive";
          t.s = 0;
          t.v = 0;
          if (t.k === 0) log("road", "Convoy departs Logistics Facility · 10 TEUs → VAB");
        }
      });
      const drivers = trucks.filter((t) => t.state === "drive").sort((a, b) => b.s - a.s);
      drivers.forEach((t, i) => {
        const lead = drivers[i - 1];
        let vd = V_TRUCK;
        if (lead) vd = Math.min(vd, lead.v + Math.max(0, lead.s - t.s - 14) / 2.5);
        if (R_WV.total - t.s < 25) vd = Math.min(vd, 3);
        let s1 = t.s + t.v * dw;
        const blocked = otIn || (!wvIn && otNear);
        if (t.s <= sInWv + 0.5 && s1 >= sInWv - 1 && blocked) {
          vd = 0;
          s1 = Math.min(s1, sInWv - 1.5);
          t.holdJ += dw;
          sim.jHoldUntil = T + 1.2;
        }
        t.v = vd < t.v ? Math.max(vd, t.v - 5 * dw) : Math.min(vd, t.v + 1.8 * dw);
        if (vd === 0) t.v = 0;
        if (lead) s1 = Math.min(s1, lead.s - 12);
        DMG.forEach((p) => {
          if (t.s < p.s && s1 >= p.s) dmgHit(t, p);
        });
        t.s = Math.max(t.s, s1);
        if (t.s >= R_WV.total - 2) {
          if (t.k < 6) {
            t.state = "integrated";
            t.v = 0;
            sim.integrated++;
            log("road", t.id + " at VAB · integrated into the launch vehicle (" + sim.integrated + "/6)");
          } else {
            t.state = "return";
            t.v = 0;
            t.s = R_WV.total;
            log("road", t.id + " delivered to VAB · returning to warehouse");
          }
        }
        sim.stat.convoyHold = Math.max(sim.stat.convoyHold, t.holdJ);
      });
      trucks.forEach((t) => {
        if (t.state !== "return") return;
        t.v = V_TRUCK * 0.9;
        const s1 = t.s - t.v * dw;
        DMG.forEach((p) => {
          if (t.s > p.s && s1 <= p.s) dmgHit(t, p);
        });
        t.s = s1;
        if (t.s <= 2) {
          t.state = "home";
          t.v = 0;
        }
      });
      // phases
      if (sim.phase === "convoy" && sim.integrated === 6 && trucks.every((t) => t.state !== "drive" && t.state !== "wait")) {
        sim.phase = "integrate";
        sim.pT = 0;
        log("road", "All 6 TEUs integrated · stacking launch vehicle in the VAB");
      } else if (sim.phase === "integrate") {
        sim.pT += dw;
        if (sim.pT >= 30) {
          sim.phase = "rollout";
          sim.tlx = TLX_B;
          crawler.active = true;
          crawler.s = 0;
          crawler.v = 0;
          log("road", "Rollout begins · crawler-transporter leaves the VAB for LC-39A (5.0 km at 1.6 km/h)");
        }
      } else if (sim.phase === "rollout") {
        crawler.v = Math.min(V_CRAWLER, crawler.v + 0.02 * dw);
        const s0 = crawler.s;
        crawler.s = Math.min(R_CR.total, crawler.s + crawler.v * dw);
        if (s0 < 2750 && crawler.s >= 2750) {
          trucks.slice(0, 6).forEach((t) => {
            hpush(t.id, { w: sim.W, az: 1.55, vib: 0.35, temp: t.temp, rh: t.rh, loc: "crawler" });
            hevent(t.id, { w: sim.W, y: 1.55, kind: "dmg", label: "Crawlerway soft spot", color: "#ffb347" });
          });
          log("road", "Crawlerway gravel anomaly at 2.75 km · soft spot reported by 6 TEUs");
        }
        if (crawler.s >= R_CR.total - 0.5) {
          sim.phase = "onpad";
          crawler.v = 0;
          sim.hold = 0;
          log("road", "Vehicle on LC-39A · 6/6 TEUs nominal · Pad B traffic cleared");
        }
      }
      // Pad B traffic (car-following; crawler is a slow leader on the shared Crawlerway)
      const act = bvs.filter((b) => b.active).sort((a, b) => b.s - a.s);
      const sCrOT = crawler.active && crawler.s >= A.mCR - 20 && crawler.s <= A.fCR ? A.mOT + (crawler.s - A.mCR) : null;
      act.forEach((b, i) => {
        let lead = act[i - 1] ? { s: act[i - 1].s, v: act[i - 1].v } : null;
        if (sCrOT != null && b.s < sCrOT && (!lead || sCrOT < lead.s)) lead = { s: sCrOT, v: crawler.v };
        let vd = V_OT;
        if (lead) vd = Math.min(vd, lead.v + Math.max(0, lead.s - b.s - 14) / 2.5);
        let s1 = b.s + b.v * dw;
        if (b.s <= sInOt + 0.5 && s1 >= sInOt - 1 && wvIn) {
          vd = 0;
          s1 = Math.min(s1, sInOt - 1.5);
          sim.jHoldUntil = T + 1.2;
        }
        b.v = vd < b.v ? Math.max(vd, b.v - 6 * dw) : Math.min(vd, b.v + 2 * dw);
        if (vd === 0) b.v = 0;
        if (lead) s1 = Math.min(s1, lead.s - 12);
        b.s = Math.max(b.s, s1);
        if (b.s >= R_OT.total - 3) {
          const delay = Math.max(0, sim.W - b.spawnW - R_OT.total / V_OT);
          sim.stat.otDelaySum += delay;
          sim.stat.otDone++;
          sim.stat.otMax = Math.max(sim.stat.otMax, delay);
          b.active = false;
        }
      });
      sim.stat.queue = bvs.filter((b) => b.active && b.v < 0.6 && b.s > A.mOT - 800 && b.s < A.fOT).length;
      // thermal model: ambient on the road, conditioned inside the VAB / vehicle
      const wx = api.getWx();
      trucks.forEach((t) => {
        const onRoad = t.state === "drive" || t.state === "return" || t.state === "wait" || t.state === "home";
        const amb = wx ? wx.pts[api.nearest(28.58, -80.652)].temp[api.getHour()] : 27;
        const target = onRoad ? amb + 1.8 : 21.5;
        t.temp += (target - t.temp) * (1 - Math.exp(-dw / 150));
        t.rh += ((onRoad ? 58 : 44) - t.rh) * (1 - Math.exp(-dw / 150));
      });
    }
    function resetCycle() {
      sim.cycle++;
      sim.cw = 0;
      sim.phase = "convoy";
      sim.tlx = TLX_A;
      sim.integrated = 0;
      crawler.active = false;
      crawler.s = 0;
      crawler.v = 0;
      sim.stat = { convoyHold: 0, otDelaySum: 0, otDone: 0, queue: 0, otMax: 0 };
      trucks.forEach((t) => {
        t.state = "wait";
        t.s = 0;
        t.v = 0;
        t.holdJ = 0;
        t.temp = 26;
      });
      bvs.forEach((b) => (b.active = false));
      DMG.forEach((p) => (p.n = 0));
      sim.nextB = 6;
      log("road", "New cycle · next convoy staging at the Logistics Facility");
    }
    function teuTel(t) {
      let loc = "dock";
      let sp = 0;
      if (t.state === "drive" || t.state === "return") {
        loc = "road";
        sp = t.v * 3.6;
      } else if (t.state === "integrated") {
        if (crawler.active) {
          loc = "crawler";
          sp = crawler.v * 3.6;
        } else loc = "VAB";
      }
      t.loc = loc;
      t.speed = sp;
      t.az = 1 + (loc === "road" ? rnd(-1, 1) * (0.012 + 0.0035 * sp) : loc === "crawler" ? rnd(-1, 1) * 0.02 : rnd(-1, 1) * 0.004);
      t.vib = loc === "road" ? 0.03 + 0.0045 * sp + rnd(0, 0.02) : loc === "crawler" ? 0.06 + rnd(0, 0.03) : 0.01 + rnd(0, 0.005);
      t.hot = t.hot && T < t.hotUntil;
    }
    function tickRoad() {
      const dt = clamp(T - sim.last, 0, 0.1);
      sim.last = T;
      if (sim.phase === "onpad") {
        sim.hold += dt;
        if (sim.hold > 9) resetCycle();
      }
      const dw = dt * sim.tlx;
      const n = Math.max(1, Math.ceil(dw / 0.5));
      for (let i = 0; i < n; i++) stepWorld(dw / n);
      trucks.forEach((t) => {
        if (t.state === "drive" || t.state === "return") poseTruck(t);
        else if (!t.pTeu) poseTruck(t);
      });
      bvs.forEach((b) => b.active && poseB(b));
      if (crawler.active || !crawler.pos) poseCrawler();
      sim.sampleAcc += dt;
      if (sim.sampleAcc >= 0.25) {
        sim.sampleAcc = 0;
        trucks.forEach((t) => {
          teuTel(t);
          hpush(t.id, { w: sim.W, az: t.az, vib: t.vib, temp: t.temp, rh: t.rh, loc: t.loc });
        });
      }
      const st = trucks[road.sel];
      if (st.state === "drive" || st.state === "return") {
        road.focus = st.pTeu;
        road.hdg = st.brg;
        road.range = 75;
      } else if (st.state === "integrated" && crawler.active) {
        road.focus = crawler.bay;
        road.hdg = crawler.brg;
        road.range = 230;
      } else {
        road.focus = st.state === "integrated" ? cart(KS.vab.center[0], KS.vab.center[1], 20) : st.pTeu;
        road.hdg = st.brg;
        road.range = st.state === "integrated" ? 500 : 75;
      }
      roadLinkUpdate();
      const chip = "Time-lapse ×" + sim.tlx + " · real OSM roads · simulated";
      if (active === "road" && chip !== road.chip) {
        road.chip = chip;
        $("#lb-chip").textContent = chip;
      }
    }
    trucks.forEach((t) => {
      poseTruck(t);
      teuTel(t);
    });
    poseCrawler();

    function feedRoad() {
      const t = trucks[road.sel];
      const where = { road: "Convoy on road", crawler: "Crawler-transporter · rollout", VAB: "Inside the VAB (integration)", dock: t.state === "home" ? "Back at the warehouse" : "Staged at the dock" }[t.loc];
      const ageS = ((T % 2) / 1).toFixed(1);
      const chips = trucks
        .map((x) => '<button type="button" class="tc' + (x.k === road.sel ? " is-on" : "") + '" data-tsel="' + x.k + '" title="' + x.id + '">' + (201 + x.k) + "</button>")
        .join("");
      const dm = DMG.filter((p) => p.flagged)
        .map((p) => '<li class="dmg"><b>' + p.name + "</b><span>" + f1(p.peak) + " g peak · " + p.n + " TEU hit" + (p.n === 1 ? "" : "s") + (p.n >= 3 ? " · confirmed" : "") + "</span></li>")
        .join("");
      const avgD = sim.stat.otDone ? sim.stat.otDelaySum / sim.stat.otDone / 60 : 0;
      const alertShock = t.az > 2.2;
      return (
        '<div class="tchips" aria-label="Select a TEU">' + chips + "</div>" +
        '<div class="lb-asset"><span class="lb-badge ' + (t.hot ? "alert" : "ok") + '">' + (t.hot ? "SHOCK" : "TRACKING") + "</span><b>" + t.id + "</b><small>" + where + (t.k < 6 ? " · goes to the pad" : " · returns to warehouse") + "</small></div>" +
        '<div class="kvs">' +
        kv("Speed", t.speed.toFixed(t.loc === "crawler" ? 1 : 0) + " km/h") +
        kv("Vertical accel", t.az.toFixed(2) + " g", alertShock ? "alert" : "") +
        kv("Vibration", t.vib.toFixed(2) + " g rms") +
        kv("Temp", t.temp.toFixed(1) + " °C") +
        kv("Humidity", t.rh.toFixed(0) + " %RH") +
        kv("Link", road.link.text) +
        "</div>" +
        hcBlock("Vertical acceleration · " + t.id, rollChart(t.id, "az", { yr: [0, 5.5], yfmt: (v) => v.toFixed(0), color: "#41b7e3", kind: "dmg", thresholds: [{ y: 2.2, color: "#ffb347", label: "damage threshold 2.2 g" }], aria: "Vertical acceleration history with detected road-damage hits" })) +
        hcBlock("Temperature · " + t.id + " (°C)", rollChart(t.id, "temp", { yr: [18, 34], yfmt: (v) => v.toFixed(0), color: "#ffb347", kind: "none", aria: "Container temperature history" })) +
        '<div class="sec-h">Road condition from TEU shocks</div>' +
        (dm ? '<ul class="dmgs">' + dm + "</ul>" : '<p class="lb-hint">No damage detected yet.</p>') +
        '<div class="sec-h">Pad B conflict traffic</div>' +
        '<div class="kvs">' +
        kv("Convoy held at J1", mmss(sim.stat.convoyHold), sim.stat.convoyHold > 5 ? "alert" : "") +
        kv("Pad B queue", sim.stat.queue + " vehicles", sim.stat.queue > 3 ? "alert" : "") +
        kv("Avg delay", avgD.toFixed(1) + " min", avgD > 3 ? "alert" : "") +
        kv("Phase", { convoy: "Convoy", integrate: "Integration", rollout: "Rollout", onpad: "On pad" }[sim.phase]) +
        "</div>" +
        '<p class="lb-hint">Bottleneck flagged by LuminaTwin planning: the slow crawler (1.6 km/h) blocks Pad B traffic on the shared Crawlerway. Shift fuel deliveries outside the rollout window.</p>' +
        logHTML("road")
      );
    }

    /* =====================================================================
       (b) WAREHOUSE: the real Kennedy Space Center "Logistics Facility" (OpenStreetMap footprint)
       ===================================================================== */
    const WHO = KS.logistics.obb;
    const WH = { lat: WHO.lat, lon: WHO.lon, ang: WHO.heading, L: WHO.len, W: WHO.wid };
    const whCenter = cart(WH.lat, WH.lon, 0);
    const wa = (WH.ang * Math.PI) / 180;
    const obbLL = (x, y) => offsetLL(WH.lat, WH.lon, x * Math.cos(wa) - y * Math.sin(wa), x * Math.sin(wa) + y * Math.cos(wa));
    const wpoly = C.Cartesian3.fromDegreesArray(KS.logistics.poly.flatMap(([la, lo]) => [lo, la]));
    add("warehouse", { polygon: { hierarchy: wpoly, height: 0, extrudedHeight: 0.3, material: css("#16293b", 0.95) } });
    add("warehouse", { polygon: { hierarchy: wpoly, height: 0, extrudedHeight: 14, material: SKY.withAlpha(0.06), outline: true, outlineColor: css("#9fd8f2", 0.85) } });
    add("warehouse", {
      position: cart(WH.lat, WH.lon, 34),
      label: {
        text: "Logistics Facility · KSC warehouse (OSM footprint)\n● 36 TEUs tracked by LuminaBox",
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
    // dock (road node nearest the building) expressed in the building frame
    const dxm = (KS.dock[1] - WH.lon) * 111320 * COSL;
    const dym = (KS.dock[0] - WH.lat) * 111320;
    const dockL = { x: dxm * Math.cos(wa) + dym * Math.sin(wa), y: -dxm * Math.sin(wa) + dym * Math.cos(wa) };
    add("warehouse", {
      position: cart(KS.dock[0], KS.dock[1], 3),
      point: { pixelSize: 8, color: css("#3ee0c6"), outlineColor: WHITE, outlineWidth: 2, disableDepthTestDistance: INF },
      label: { text: "Outbound dock", font: MONO, fillColor: WHITE, outlineColor: DARK, outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -12), verticalOrigin: C.VerticalOrigin.BOTTOM, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 2500), disableDepthTestDistance: INF },
    });
    const bsWp = obbLL(WH.L / 2 + 22, WH.W / 2 + 8);
    const bsW = baseStation("warehouse", bsWp[0], bsWp[1], "BS-W · Base station");
    const whLinkType = () => {
      const c = T % 36;
      return c < 22 ? "rf" : c < 28 ? "cell" : c < 32 ? "sat" : "rf";
    };
    const cellWh = cellTower("warehouse", CELL_LL[0], CELL_LL[1], "Cell tower \u00B7 KSC comms tower", 3500);
    const whRoof = () => cart(WH.lat, WH.lon, 16);
    uplink("warehouse", whRoof, () => bsW, () => active === "warehouse" && whLinkType() === "rf", { type: "rf" });
    uplink("warehouse", whRoof, () => cellWh, () => active === "warehouse" && whLinkType() === "cell", { type: "cell", color: CELLC });
    let whSat = null; // created after the satellite block
    let whLastLink = "rf";
    const whLinkText = () => {
      const t = whLinkType();
      return t === "rf" ? "RF \u00B7 BS-W gateway" : t === "cell" ? "Cellular LTE \u00B7 failover test" : whSat && whSat.ok ? "SATCOM \u00B7 SAT-" + (whSat.a + 1) + " \u00B7 failover test" : "SATCOM \u00B7 failover test";
    };

    const CONTENTS = ["Avionics racks", "Payload adapters", "Ground support eq.", "Optical instruments", "Spares pallets", "Fairing hardware", "Test fixtures", "Cabling & harness"];
    const whBox = [];
    let n = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 10; c++) {
        const tiers = r === 1 && c >= 2 && c <= 7 ? 2 : 1;
        for (let t = 0; t < tiers; t++) {
          const east = -60 + 13.3 * c;
          const north = (r - 1) * 34;
          const [la, lo] = obbLL(east, north);
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
    const transfer = whBox.find((b) => b.tier === 0 && b.north === 34 && Math.abs(b.east - (-60 + 13.3 * 6)) < 0.01);
    transfer.dynamic = true;
    const tPath = [[transfer.east, 34], [transfer.east, 17], [dockL.x, 17], [dockL.x, dockL.y]];
    let selected = transfer;

    const STATE_COL = { ok: SKY, temp: AMB, shock: RED, door: AMB, moving: WHITE };
    const whHead = -WH.ang;
    whBox.forEach((b) => {
      const pos = b.dynamic ? CP(() => b.pos) : b.pos;
      teuBox("warehouse", {
        pos,
        orient: b.dynamic ? CP(() => hprQ(b.pos, whHead)) : hprQ(b.pos, whHead),
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
    let whSamp = 0;
    let lastTransferPhase = "";
    function tickWarehouse() {
      const lt = whLinkType();
      if (lt === "sat" && whSat) whSat.eval();
      if (lt !== whLastLink) {
        log("warehouse", "Gateway link failover test: " + LNAME[whLastLink] + " \u2192 " + LNAME[lt]);
        whLastLink = lt;
      }
      const c = T % 40;
      let f = 0;
      let phase = "hold";
      if (c >= 6 && c < 17) { f = ss((c - 6) / 11); phase = "out"; }
      else if (c >= 17 && c < 23) { f = 1; phase = "dock"; }
      else if (c >= 23 && c < 34) { f = 1 - ss((c - 23) / 11); phase = "back"; }
      const [e, nn] = tPos(f);
      const [la, lo] = obbLL(e, nn);
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
          hevent(b.id, { w: T, y: b.temp, kind: "temp", color: "#ffb347" });
        } else if (k < 0.75) {
          b.status = "door";
          b.until = T + 6;
          log("warehouse", b.id + " door-open event");
        } else {
          b.status = "shock";
          b.until = T + 5;
          const g = rnd(1.6, 2.9);
          log("warehouse", b.id + " handling shock " + f1(g) + " g");
          hpush(b.id, { w: T, az: 1 + g, vib: 0.3, temp: b.temp, rh: b.rh });
          hevent(b.id, { w: T, y: 1 + g, kind: "shock", color: "#ff6b5b" });
        }
        whNext = T + rnd(2.2, 4);
      }
      if (T >= whScan) {
        log("warehouse", "Inventory scan complete · " + whBox.length + "/" + whBox.length + " TEUs reporting");
        whScan = T + 12;
      }
      if (T >= whSamp) {
        whSamp = T + 0.25;
        whBox.forEach((b) => hpush(b.id, { w: T, az: 1 + rnd(-0.004, 0.004) + (b.status === "moving" ? rnd(0, 0.05) : 0), vib: 0.01, temp: b.temp, rh: b.rh }));
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
          kv("Location", s.tier ? "Bay tier 2" : s.dynamic && s.north > 40 ? "Outbound dock" : "Bay tier 1") +
          kv("Temp", f1(s.temp) + " °C", s.status === "temp" ? "alert" : "") +
          kv("Humidity", s.rh.toFixed(0) + " %RH") +
          kv("Link", whLinkText()) +
          "</div>" +
          hcBlock("Temperature · " + s.id + " (°C)", rollChart(s.id, "temp", { yr: [16, 38], yfmt: (v) => v.toFixed(0), color: "#ffb347", kind: "temp", thresholds: [{ y: 30, color: "#ff6b5b", label: "excursion 30 °C" }], aria: "Container temperature history" })) +
          hcBlock("Vertical acceleration · " + s.id + " (g)", rollChart(s.id, "az", { yr: [0.8, 4.2], yfmt: (v) => v.toFixed(1), color: "#41b7e3", kind: "shock", aria: "Handling shock history" }))
        : "";
      return (
        '<div class="lb-summary"><span><b>' + whBox.length + "/" + whBox.length + "</b> reporting</span><span class=\"" + (alerts.length ? "alert" : "") + '"><b>' + alerts.length + "</b> alerts</span></div>" +
        sel +
        '<p class="lb-hint">Click any container to inspect its LuminaBox history.</p>' +
        logHTML("warehouse")
      );
    }

    /* =====================================================================
       SATELLITE RELAY (notional LEO constellation for SATCOM tracking)
       Each LuminaBox can fall back to SATCOM: asset -> satellite -> (cross-link) -> satellite -> ground gateway.
       ===================================================================== */
    const RE = 6378137;
    const SAT_R = RE + 780e3;
    const SAT_PLANES = 6;
    const SAT_PER = 11;
    const NSAT = SAT_PLANES * SAT_PER;
    const ORBIT_S = 260; // seconds per orbit on screen (time-lapse)
    const SAT_INC = C.Math.toRadians(86.4);
    const DEG = Math.PI / 180;
    const VIOLET = css("#b58cff");
    const satP = [];
    for (let i = 0; i < NSAT; i++) satP.push(new C.Cartesian3());
    function orbitPoint(p, M, out) {
      const om = C.Math.toRadians(p * 31.6);
      const cM = Math.cos(M), sM = Math.sin(M), cO = Math.cos(om), sO = Math.sin(om);
      const ci = Math.cos(SAT_INC), si = Math.sin(SAT_INC);
      out.x = SAT_R * (cM * cO - sM * ci * sO);
      out.y = SAT_R * (cM * sO + sM * ci * cO);
      out.z = SAT_R * sM * si;
      return out;
    }
    function updateSats() {
      for (let i = 0; i < NSAT; i++) {
        const p = Math.floor(i / SAT_PER);
        const k = i % SAT_PER;
        orbitPoint(p, 2 * Math.PI * (k / SAT_PER + ((p % 2) * 0.5) / SAT_PER) + (2 * Math.PI * T) / ORBIT_S, satP[i]);
      }
    }
    updateSats();
    const sp = (i) => satP[i >= 0 ? i : 0];
    for (let i = 0; i < NSAT; i++) {
      add("sat", {
        position: CP(() => satP[i]),
        point: { pixelSize: 4, color: WHITE.withAlpha(0.85) },
      });
    }
    for (let p = 0; p < SAT_PLANES; p++) {
      const ring = [];
      for (let j = 0; j <= 120; j++) ring.push(orbitPoint(p, (2 * Math.PI * j) / 120, new C.Cartesian3()));
      add("sat", { polyline: { positions: ring, width: 1, material: WHITE.withAlpha(0.1) } });
    }

    const losBlocked = (a, b) => {
      const d = C.Cartesian3.subtract(b, a, new C.Cartesian3());
      const dd = C.Cartesian3.dot(d, d);
      const t = clamp(-C.Cartesian3.dot(a, d) / dd, 0, 1);
      return C.Cartesian3.magnitude(madd(a, d, t)) < 6.35e6; // just under the surface: ground assets must not self-block
    };
    const elevOf = (g, s) => {
      const d = C.Cartesian3.subtract(s, g, new C.Cartesian3());
      return Math.asin(clamp(C.Cartesian3.dot(d, upVec(g)) / C.Cartesian3.magnitude(d), -1, 1));
    };

    function satLink(scn, assetFn, gwFns, activeFn, onHandover) {
      const st = { a: -1, b: -1, gw: 0, ok: false, el: 0, next: 0 };
      const valid = (i, p, needEl) => !losBlocked(p, satP[i]) && (needEl == null || elevOf(p, satP[i]) >= needEl);
      st.eval = (force) => {
        if (!force && T < st.next) return st;
        st.next = T + 0.5;
        const p = assetFn();
        const alt = C.Cartographic.fromCartesian(p).height;
        const needEl = alt < 100e3 ? 8 * DEG : null;
        const nearest = (from, el) => {
          let best = -1;
          let bd = Infinity;
          for (let i = 0; i < NSAT; i++) {
            if (!valid(i, from, el)) continue;
            const d = C.Cartesian3.distance(from, satP[i]);
            if (d < bd) { bd = d; best = i; }
          }
          return { best, bd };
        };
        let { best, bd } = nearest(p, needEl);
        if (best < 0 && needEl != null) ({ best, bd } = nearest(p, 0));
        if (st.a >= 0 && best >= 0 && valid(st.a, p, needEl) && C.Cartesian3.distance(p, satP[st.a]) < bd * 1.3) best = st.a;
        if (best !== st.a) {
          if (st.a >= 0 && best >= 0 && onHandover) onHandover(st.a, best);
          st.a = best;
        }
        st.ok = st.a >= 0;
        let gi = 0;
        let gd = Infinity;
        gwFns.forEach((f, k) => {
          const d = C.Cartesian3.distance(p, f());
          if (d < gd) { gd = d; gi = k; }
        });
        st.gw = gi;
        if (st.ok) {
          const g = gwFns[gi]();
          if (valid(st.a, g, 5 * DEG)) st.b = st.a;
          else {
            const r = nearest(g, 5 * DEG);
            st.b = r.best >= 0 ? r.best : st.a;
          }
          st.el = elevOf(p, satP[st.a]) / DEG;
        }
        return st;
      };
      const show = () => activeFn() && st.ok && lk("sat")();
      add(scn, { polyline: { positions: CP(() => [assetFn(), sp(st.a)]), width: 2, material: new C.PolylineDashMaterialProperty({ color: VIOLET, dashLength: 16 }) } }, show);
      add(scn, { polyline: { positions: CP(() => [sp(st.a), sp(st.b)]), width: 2, material: new C.PolylineDashMaterialProperty({ color: VIOLET.withAlpha(0.7), dashLength: 10 }) } }, () => show() && st.b !== st.a);
      add(scn, { polyline: { positions: CP(() => [sp(st.b), gwFns[st.gw]()]), width: 2, material: new C.PolylineDashMaterialProperty({ color: VIOLET, dashLength: 16 }) } }, show);
      [() => st.a, () => st.b].forEach((idxFn, n) => {
        add(
          scn,
          {
            position: CP(() => sp(idxFn())),
            point: { pixelSize: 9, color: VIOLET, outlineColor: WHITE, outlineWidth: 2 },
            label: {
              text: CP(() => "SAT-" + (idxFn() + 1) + (n ? " (gateway)" : "")),
              font: "600 10px ui-monospace, Consolas, monospace",
              fillColor: WHITE,
              outlineColor: DARK,
              outlineWidth: 3,
              style: C.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new C.Cartesian2(10, -8),
              horizontalOrigin: C.HorizontalOrigin.LEFT,
              distanceDisplayCondition: new C.DistanceDisplayCondition(0, 2.5e7),
            },
          },
          () => show() && (n === 0 || st.b !== st.a)
        );
      });
      [0, 0.5].forEach((k) =>
        add(
          scn,
          { position: CP(() => lin(assetFn(), sp(st.a), (T / 1.2 + k) % 1)), point: { pixelSize: 5, color: WHITE } },
          show
        )
      );
      return st;
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

    let lsel = 0;
    function launchTel(u, k) {
      const bump = (c, w2) => Math.exp(-(((u - c) / w2) ** 2));
      const layer = k < 0 ? 1 : Math.floor(k / 2);
      const g0 = u < 0.1 ? 1 : u < 0.22 ? 1.4 + 2.8 * ((u - 0.1) / 0.12) : u < 0.7 ? 0.02 : u < 0.82 ? 0.3 + 3.2 * bump(0.76, 0.03) : u < 0.92 ? 1.1 + 0.6 * bump(0.9, 0.012) : 1;
      const v0 = u < 0.1 ? 0.03 : u < 0.22 ? 1.2 + 1.8 * ((u - 0.1) / 0.12) : u < 0.7 ? 0.03 : u < 0.82 ? 0.4 + 1.6 * bump(0.76, 0.03) : u < 0.92 ? 0.3 + 0.8 * bump(0.9, 0.012) : 0.03;
      const tOff = k < 0 ? 0 : (-1.2 + 0.5 * k) * (1 + 1.2 * bump(0.77, 0.04));
      return {
        g: g0 * (1 + 0.04 * layer),
        vib: v0 * (1 + 0.12 * layer),
        temp: 21 + 6 * bump(0.77, 0.04) + 1.2 * ss((u - 0.1) / 0.12) + tOff,
      };
    }
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
      const tl0 = launchTel(u, -1);
      veh.g = tl0.g + rnd(-0.04, 0.04);
      veh.vib = tl0.vib + rnd(0, 0.05);
      veh.temp = tl0.temp;
      veh.link = "BS-1 (RF)";
      veh.linkOk = true;
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
        text: CP(() => "● TRACKED · 6 × TEU\nLuminaBox LB-201–206 · " + launchLinkShort()),
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
    uplink("launch", () => veh.pos, () => bsPad, () => veh.u < 0.12);
    uplink("launch", () => veh.pos, () => bsJ, () => veh.u > 0.86);
    const cellJp = cellTower("launch", JP.lat + 0.0007, JP.lon - 0.0013, "Cell tower \u00B7 Japan site", 900);
    uplink("launch", () => veh.pos, () => cellJp, () => veh.u > 0.88, { type: "cell", color: CELLC });
    // SATCOM: LuminaBox falls back to the relay constellation from liftoff; re-entry plasma blackout interrupts it
    const launchSatOn = () => active === "launch" && ((veh.u >= 0.1 && veh.u < 0.745) || veh.u >= 0.79);
    const launchSat = satLink("launch", () => veh.pos, [() => bsPad, () => bsJ], launchSatOn, (a, b) => log("launch", "SATCOM handover SAT-" + (a + 1) + " \u2192 SAT-" + (b + 1)));
    const blackout = () => veh.u >= 0.745 && veh.u < 0.79;
    let wasBlackout = false;
    roadSat = satLink("road", roadAsset, [() => bs1, () => bsAr], () => active === "road" && road.link.type === "sat", (a, b) => log("road", "SATCOM handover SAT-" + (a + 1) + " \u2192 SAT-" + (b + 1)));
    whSat = satLink("warehouse", whRoof, [() => bsW], () => active === "warehouse" && whLinkType() === "sat");
    function launchLinkShort() {
      return veh.u < 0.1 ? "RF" : blackout() ? "BLACKOUT" : "SATCOM";
    }
    function updateLaunchLink() {
      if (launchSatOn()) launchSat.eval();
      const bl = blackout();
      if (bl !== wasBlackout) {
        wasBlackout = bl;
        if (bl) log("launch", "Plasma blackout \u00B7 LuminaBox buffering telemetry");
        else if (veh.u >= 0.79) log("launch", "Signal re-acquired \u00B7 buffer flushed via SATCOM");
      }
      veh.linkOk = !bl;
      if (veh.u < 0.1) veh.link = "BS-1 (RF)";
      else if (bl) veh.link = "BLACKOUT \u00B7 buffering";
      else {
        const s = launchSat.ok ? "SATCOM \u00B7 SAT-" + (launchSat.a + 1) : "SATCOM";
        veh.link = veh.u >= 0.88 ? s + " + BS-J RF + cell" : veh.u >= 0.86 ? s + " + BS-J RF" : s;
      }
    }
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
    const cam = { director: true, ready: false, zoom: 1, roadFollow: false, follow: null };
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
      updateLaunchLink();
      const ph = PHASES.findIndex((p, i) => mission.u >= p.u0 && (mission.u < p.u1 || i === PHASES.length - 1));
      if (ph !== lastPhase) {
        if (ph >= 0 && lastPhase >= 0 && ph > lastPhase) {
          const msg = ["", "Liftoff \u00B7 SATCOM engaged", "Main engine cutoff \u00B7 coasting on SATCOM", "Re-entry interface \u00B7 blackout expected", "Landing burn \u00B7 SATCOM re-acquired", "Landed \u00B7 offloading \u00B7 RF + SATCOM at Japan site"][ph];
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

    function launchProfile(k) {
      const g = [], v = [], t = [];
      for (let i = 0; i <= 300; i++) {
        const u = i / 300;
        const tl = launchTel(u, k);
        g.push([u * MISSION_S, tl.g]);
        v.push([u * MISSION_S, tl.vib]);
        t.push([u * MISSION_S, tl.temp]);
      }
      return { g, v, t };
    }
    function feedLaunch() {
      const ph = PHASES[Math.max(0, PHASES.findIndex((p, i) => veh.u >= p.u0 && (veh.u < p.u1 || i === PHASES.length - 1)))];
      const delivered = veh.u >= 0.99;
      const tl = launchTel(veh.u, lsel);
      const chips = [0, 1, 2, 3, 4, 5].map((k) => '<button type="button" class="tc' + (k === lsel ? " is-on" : "") + '" data-lsel="' + k + '">' + (201 + k) + "</button>").join("");
      const prof = launchProfile(lsel);
      const bands = PHASES.map((p, i) => ({ x0: p.u0 * MISSION_S, x1: p.u1 * MISSION_S, fill: i % 2 ? "rgba(140,185,220,.08)" : "rgba(140,185,220,.03)", label: String(i + 1) }));
      const cur = veh.u * MISSION_S;
      const base = { xr: [0, MISSION_S], bands, cursor: cur, xl: ["T+00:00", "T+" + mmss(MISSION_S)], attrs: 'data-scrub="launch"' };
      const cA = chart(Object.assign({ yr: [0, 5], yfmt: (v) => v.toFixed(0), series: [{ pts: prof.g, color: "#41b7e3", upto: cur }, { pts: prof.v, color: "#ffdf3c", upto: cur }], aria: "Acceleration and vibration through the mission" }, base));
      const cT = chart(Object.assign({ yr: [18, 30], yfmt: (v) => v.toFixed(0), series: [{ pts: prof.t, color: "#ffb347", upto: cur }], aria: "Container temperature through the mission" }, base));
      return (
        '<div class="tchips" aria-label="Select a TEU">' + chips + "</div>" +
        '<div class="lb-asset"><span class="lb-badge ' + (veh.linkOk ? "ok" : "log") + '">' + (veh.linkOk ? "TRACKING" : "BUFFERING") + "</span><b>LB-" + (201 + lsel) + "</b><small>" + ["bottom", "bottom", "middle", "middle", "top", "top"][lsel] + " layer of the payload bay · " + ph.name + "</small></div>" +
        '<div class="kvs">' +
        kv("Mission time", "T+" + mmss(veh.u * MISSION_S)) +
        kv("Altitude", veh.alt < 1 ? "0 km" : veh.alt.toFixed(veh.alt < 100 ? 1 : 0) + " km") +
        kv("Speed", veh.speed < 0.05 ? "0 km/s" : veh.speed.toFixed(2) + " km/s") +
        kv("Accel", tl.g.toFixed(1) + " g", tl.g > 2.5 ? "alert" : "") +
        kv("Vibration", tl.vib.toFixed(2) + " g rms", tl.vib > 1.5 ? "alert" : "") +
        kv("Temp", tl.temp.toFixed(1) + " \u00B0C") +
        kv("Link", veh.link) +
        kv("TEUs reporting", delivered ? "6/6 · synced" : "6/6") +
        "</div>" +
        hcBlock('Acceleration <i class="lg-a"></i>g and vibration <i class="lg-v"></i>g rms · LB-' + (201 + lsel), cA) +
        hcBlock("Temperature · LB-" + (201 + lsel) + " (°C)", cT) +
        '<p class="lb-hint">Numbers mark mission phases. Click a chart to scrub the mission.</p>' +
        logHTML("launch")
      );
    }

    /* =====================================================================
       (d) SHIPPING TO CAPE CANAVERAL: Houston (sea), Miami (sea), Atlanta (road)
       SATCOM carries tracking where there is no RF/cellular coverage.
       ===================================================================== */
    const ROUTES = [
      {
        id: "HOU", name: "Houston", mode: "ship", color: "#ffb347", ids: "LB-401–432", teus: 32, cols: 8, cruise: 19, unit: "kn", period: 130, mast: "BS-H",
        pts: [[29.685, -94.985], [29.5, -94.9], [29.34, -94.74], [29.2, -94.5], [28.6, -92.8], [27.4, -89.8], [25.9, -86.0], [24.6, -83.5], [24.2, -82.0], [24.35, -81.0], [24.55, -80.3], [25.4, -79.9], [26.7, -79.85], [27.9, -79.95], [28.38, -80.35], [28.41, -80.58]],
      },
      {
        id: "MIA", name: "Miami", mode: "ship", color: "#5fd08a", ids: "LB-451–474", teus: 24, cols: 6, cruise: 17, unit: "kn", period: 60, mast: "BS-M",
        pts: [[25.775, -80.165], [25.77, -80.05], [26.7, -79.9], [27.9, -79.97], [28.38, -80.35], [28.41, -80.58]],
      },
      {
        id: "ATL", name: "Atlanta", mode: "truck", color: "#e8f1f8", ids: "LB-501–503", teus: 3, cruise: 85, unit: "km/h", period: 95, mast: null,
        pts: [[33.749, -84.388], [32.84, -83.632], [31.45, -83.51], [30.83, -83.28], [30.19, -82.64], [29.19, -82.14], [28.54, -81.38], [28.41, -80.62]],
      },
    ];
    const SHIP_TEUS = ROUTES.reduce((a, r) => a + r.teus, 0);
    const mastH = baseStation("shipping", 29.69, -94.97, "BS-H · Port Houston");
    const mastM = baseStation("shipping", 25.78, -80.19, "BS-M · PortMiami");
    const mastP = baseStation("shipping", 28.405, -80.625, "BS-P · Port Canaveral (gateway)");
    const MASTS = { "BS-H": mastH, "BS-M": mastM, "BS-P": mastP };
    const PLACES = [
      ["Houston", 29.76, -95.37],
      ["Miami", 25.76, -80.19],
      ["Atlanta", 33.749, -84.388],
      ["Port Canaveral", 28.41, -80.6],
    ];
    PLACES.forEach(([nm, la, lo]) =>
      add("shipping", {
        position: cart(la, lo, 0),
        point: { pixelSize: 7, color: WHITE, outlineColor: DARK, outlineWidth: 2 },
        label: { text: nm, font: MONO, fillColor: WHITE, outlineColor: DARK, outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(10, 0), horizontalOrigin: C.HorizontalOrigin.LEFT, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 9e6) },
      })
    );

    ROUTES.forEach((r) => {
      r.c = r.pts.map(([la, lo]) => cart(la, lo, 0));
      r.cum = [0];
      for (let i = 1; i < r.c.length; i++) r.cum.push(r.cum[i - 1] + C.Cartesian3.distance(r.c[i - 1], r.c[i]));
      r.total = r.cum[r.cum.length - 1];
      r.km = r.total / 1000;
      r.cruiseKmh = r.unit === "kn" ? r.cruise * 1.852 : r.cruise;
      r.hours = r.km / r.cruiseKmh;
      r.f = 0;
      r.speed = 0;
      r.b = [];
      r.col = css(r.color);
      r.link = { k: "rf", text: "RF" };
      r.cycle = -1;
      r.arrived = false;
    });
    function routeAt(r, f) {
      const d = clamp(f, 0, 1) * r.total;
      let i = 1;
      while (i < r.cum.length - 1 && d > r.cum[i]) i++;
      const k = (d - r.cum[i - 1]) / (r.cum[i] - r.cum[i - 1]);
      const a = r.pts[i - 1];
      const b = r.pts[i];
      const la = a[0] + (b[0] - a[0]) * k;
      const lo = a[1] + (b[1] - a[1]) * k;
      const brg = (Math.atan2((b[1] - a[1]) * Math.cos((la * Math.PI) / 180), b[0] - a[0]) * 180) / Math.PI;
      return { la, lo, brg };
    }
    function basisAt(r, f) {
      const p = routeAt(r, f);
      const pos = cart(p.la, p.lo, 0);
      const en = enu(pos);
      const br = (p.brg * Math.PI) / 180;
      const fwd = C.Cartesian3.add(C.Cartesian3.multiplyByScalar(en.e, Math.sin(br), new C.Cartesian3()), C.Cartesian3.multiplyByScalar(en.n, Math.cos(br), new C.Cartesian3()), new C.Cartesian3());
      const side = C.Cartesian3.subtract(C.Cartesian3.multiplyByScalar(en.e, Math.cos(br), new C.Cartesian3()), C.Cartesian3.multiplyByScalar(en.n, Math.sin(br), new C.Cartesian3()), new C.Cartesian3());
      return { pos, fwd, side, up: en.u, brg: p.brg, q: hprQ(pos, p.brg - 90) };
    }
    const lay = (b, fwd, side, up) => madd(madd(madd(b.pos, b.fwd, fwd), b.side, side), b.up, up);

    const TW = ROUTES[2].pts.map(([la, lo]) => cart(la, lo, 0));
    TW.forEach((p) => {
      add("shipping", { position: p, ellipse: { semiMajorAxis: 55000, semiMinorAxis: 55000, height: 0, material: CELLC.withAlpha(0.1) } });
      add("shipping", { position: p, point: { pixelSize: 6, color: CELLC, outlineColor: WHITE, outlineWidth: 1, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 1.2e7) } });
    });
    function routeLink(r) {
      if (r.mode === "ship") {
        if (r.f < 0.035) return { k: "rf", text: "RF · " + r.mast, mast: r.mast };
        if (r.f > 0.965) return { k: "rf", text: "RF · BS-P", mast: "BS-P" };
        return { k: "sat" };
      }
      if (r.f > 0.97) return { k: "rf", text: "RF \u00B7 BS-P", mast: "BS-P" };
      let bd = 1e12;
      let bi = 0;
      TW.forEach((p, i) => {
        const d = C.Cartesian3.distance(p, r.b[0].pos);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      if (bd < 55000) return { k: "lte", text: "Cellular LTE \u00B7 tower " + Math.round(bd / 1000) + " km", tw: bi };
      return { k: "sat" };
    }
    const LINK_COL = { sat: VIOLET, rf: SKY, lte: CELLC };

    function tickShipping0() {
      ROUTES.forEach((r) => {
        const cyc = r.period + 9;
        const x = T % cyc;
        const run = x < r.period;
        r.f = run ? x / r.period : 1;
        const sh = run ? Math.min(1, r.f / 0.03, (1 - r.f) / 0.03) : 0;
        r.speed = r.cruise * Math.max(0, sh) * (1 + 0.04 * Math.sin(T * (r.mode === "ship" ? 1 : 0.7)));
        const n = r.mode === "ship" ? 1 : 3;
        for (let j = 0; j < n; j++) r.b[j] = basisAt(r, clamp(r.f - (j * 70) / r.total, 0, 1));
        r.top = upBy(r.b[0].pos, r.mode === "ship" ? 24 : 6);
        const lk = routeLink(r);
        if (lk.k === "sat") {
          r.sat.eval();
          lk.text = r.sat.ok ? "SATCOM · SAT-" + (r.sat.a + 1) + " · " + r.sat.el.toFixed(0) + "° el" : "SATCOM · searching";
        }
        if (lk.k !== r.link.k && r.cycle >= 0) {
          if (lk.k === "sat") log("shipping", r.name + ": out of RF/cellular range · switched to SATCOM");
          else if (r.link.k === "sat") log("shipping", r.name + ": back in coverage · " + lk.text);
        }
        r.link = lk;
        const c = Math.floor(T / cyc);
        if (c !== r.cycle) {
          r.cycle = c;
          r.arrived = false;
          log("shipping", r.name + " → Cape: departed · " + r.teus + " TEU" + (r.teus > 1 ? "s" : "") + " reporting");
        }
        if (!run && !r.arrived) {
          r.arrived = true;
          log("shipping", r.name + " arrived at Port Canaveral · " + r.teus + "/" + r.teus + " TEUs nominal");
        }
      });
    }

    ROUTES.forEach((r, ri) => {
      // route line + travelled portion
      add("shipping", { polyline: { positions: C.Cartesian3.fromDegreesArrayHeights(r.pts.flatMap(([la, lo]) => [lo, la, 40])), width: 2, arcType: C.ArcType.GEODESIC, material: new C.PolylineDashMaterialProperty({ color: r.col.withAlpha(0.8), dashLength: 14 }) } });
      add("shipping", {
        polyline: {
          positions: CP(() => {
            const pts = [];
            for (let i = 0; i < r.c.length; i++) {
              if (r.cum[i] / r.total >= r.f) break;
              pts.push(upBy(r.c[i], 40));
            }
            pts.push(upBy(r.b[0].pos, 40));
            return pts.length >= 2 ? pts : [r.b[0].pos, upBy(r.b[0].pos, 1)];
          }),
          width: 4,
          material: new C.PolylineGlowMaterialProperty({ glowPower: 0.25, color: r.col }),
        },
      });
      r.sat = satLink("shipping", () => r.top, [() => mastP], () => active === "shipping" && r.link.k === "sat", (a, b) => log("shipping", r.name + ": SATCOM handover SAT-" + (a + 1) + " → SAT-" + (b + 1)));
      if (r.mode === "truck") uplink("shipping", () => r.top, () => upBy(TW[r.link.tw || 0], 30), () => active === "shipping" && r.link.k === "lte", { type: "cell", color: CELLC });
      // RF link to the nearest port mast while in port range
      uplink("shipping", () => r.top, () => MASTS[r.link.mast || "BS-P"], () => active === "shipping" && r.link.k === "rf" && !!r.link.mast);
      // fleet indicator + label
      indicator("shipping", () => r.top, { big: true, ring: false, halo: true, size: () => 12, color: () => LINK_COL[r.link.k] });
      add("shipping", {
        position: CP(() => upBy(r.top, 30)),
        label: {
          text: CP(() => "● TRACKED · " + r.name + " → Cape\n" + r.teus + " TEU · " + (r.link.k === "sat" ? "SATCOM" : r.link.k === "lte" ? "LTE" : "RF")),
          font: MONO,
          fillColor: WHITE,
          showBackground: true,
          backgroundColor: DARK.withAlpha(0.82),
          backgroundPadding: new C.Cartesian2(8, 5),
          pixelOffset: new C.Cartesian2(0, -16),
          verticalOrigin: C.VerticalOrigin.BOTTOM,
          distanceDisplayCondition: new C.DistanceDisplayCondition(0, 8e6),
          disableDepthTestDistance: INF,
        },
      });
      if (r.mode === "ship") {
        add("shipping", { position: CP(() => lay(r.b[0], 0, 0, 5)), orientation: CP(() => r.b[0].q), box: { dimensions: new C.Cartesian3(150, 24, 10), material: css("#2b3d4f"), outline: true, outlineColor: EDGE } });
        add("shipping", { position: CP(() => lay(r.b[0], -58, 0, 18)), orientation: CP(() => r.b[0].q), box: { dimensions: new C.Cartesian3(16, 22, 16), material: css("#d9dee3"), outline: true, outlineColor: EDGE } });
        let k = 0;
        for (let c = 0; c < r.cols; c++) {
          for (let row = 0; row < 2; row++) {
            for (let t = 0; t < 2; t++) {
              const fw = -34 + c * 8;
              const sd = row ? 3.2 : -3.2;
              const up = 10 + TEU.z / 2 + t * TEU.z;
              const idx = k++;
              teuBox("shipping", { pos: CP(() => lay(r.b[0], fw, sd, up)), orient: CP(() => r.b[0].q), color: PALETTE[(idx * 3 + ri * 2) % PALETTE.length], tag: { scn: "shipping" } });
              indicator("shipping", () => lay(r.b[0], fw, sd, up + TEU.z / 2 + 0.6), { ring: false, size: () => 6, dist: 2500, color: () => LINK_COL[r.link.k] });
            }
          }
        }
      } else {
        for (let j = 0; j < 3; j++) {
          add("shipping", { position: CP(() => lay(r.b[j], 0, 0, 0.95)), orientation: CP(() => r.b[j].q), box: { dimensions: new C.Cartesian3(7.6, 2.7, 0.7), material: css("#26384a"), outline: true, outlineColor: EDGE } });
          add("shipping", { position: CP(() => lay(r.b[j], 5.9, 0, 2.0)), orientation: CP(() => r.b[j].q), box: { dimensions: new C.Cartesian3(2.8, 2.5, 3.0), material: css("#c9ced4"), outline: true, outlineColor: EDGE } });
          teuBox("shipping", { pos: CP(() => lay(r.b[j], -0.2, 0, 1.3 + TEU.z / 2)), orient: CP(() => r.b[j].q), color: PALETTE[(j * 2 + 3) % PALETTE.length], tag: { scn: "shipping" } });
          indicator("shipping", () => lay(r.b[j], -0.2, 0, 1.3 + TEU.z + 0.6), { ring: false, size: () => 7, dist: 2500, color: () => LINK_COL[r.link.k] });
        }
      }
    });
    let shipSamp = 0;
    function tickShipping() {
      tickShipping0();
      if (T >= shipSamp) {
        shipSamp = T + 0.25;
        ROUTES.forEach((r, i) => hpush("ship-" + r.id, { w: T, az: 1 + Math.sin(T * 0.9 + i) * (r.mode === "ship" ? 0.012 : 0.01) + rnd(-1, 1) * (r.mode === "ship" ? 0.006 : 0.008 + 0.0004 * r.speed), vib: 0.02, temp: 24 + 3 * Math.sin(T / 60 + i * 2), link: r.link.k }));
      }
    }
    tickShipping();

    const linkBadge = (r) => (r.link.k === "sat" ? "sat" : r.link.k === "lte" ? "cell" : "ok");
    const linkLabel = (r) => (r.link.k === "sat" ? "SATCOM" : r.link.k === "lte" ? "LTE" : "RF");
    const hm = (h) => Math.floor(h) + "h " + String(Math.round((h % 1) * 60)).padStart(2, "0") + "m";
    function feedShipping() {
      let html =
        '<div class="lb-summary"><span><b>' + SHIP_TEUS + "/" + SHIP_TEUS + "</b> TEUs reporting</span><span><b>" + ROUTES.length + "</b> routes</span></div>";
      ROUTES.forEach((r, i) => {
        const on = cam.follow === i;
        html +=
          '<div class="rt' + (on ? " is-on" : "") + '">' +
          '<div class="rt-head"><i class="rt-sw" style="background:' + r.color + '"></i><b>' + r.name + " → Cape</b><span class=\"lb-badge " + linkBadge(r) + '">' + linkLabel(r) + "</span></div>" +
          '<div class="rt-sub">' + (r.mode === "ship" ? "Container ship" : "Truck convoy") + " · " + r.teus + " TEU · " + r.ids + "</div>" +
          '<div class="rt-bar"><span style="width:' + (r.f * 100).toFixed(0) + "%;background:" + r.color + '"></span></div>' +
          '<div class="rt-kv"><span>' + r.speed.toFixed(0) + " " + r.unit + "</span><span>ETA " + hm((1 - r.f) * r.hours) + "</span><span>" + Math.round(r.km) + " km</span></div>" +
          '<div class="rt-link">' + (r.link.text || linkLabel(r)) + "</div>" +
          '<button class="rt-follow" type="button" data-follow="' + i + '">' + (on ? "Release camera" : "Follow") + "</button></div>";
      });
      const sr = ROUTES[cam.follow != null ? cam.follow : 0];
      const hs = HS("ship-" + sr.id).s;
      const sb = [];
      let cb = null;
      hs.forEach((p) => {
        if (p.link === "sat") {
          if (!cb) cb = { x0: p.w, x1: p.w, fill: "rgba(181,140,255,.25)" };
          cb.x1 = p.w;
        } else if (cb) {
          sb.push(cb);
          cb = null;
        }
      });
      if (cb) sb.push(cb);
      html +=
        hcBlock(sr.name + " \u00B7 vertical acceleration (g) \u00B7 violet = SATCOM", rollChart("ship-" + sr.id, "az", { yr: [0.95, 1.1], yfmt: (v) => v.toFixed(2), color: "#41b7e3", kind: "none", bands: sb, aria: "Vertical acceleration history with satellite-link periods" })) +
        hcBlock(sr.name + " \u00B7 temperature (\u00B0C)", rollChart("ship-" + sr.id, "temp", { yr: [18, 32], yfmt: (v) => v.toFixed(0), color: "#ffb347", kind: "none", aria: "Container temperature history" }));
      return html + logHTML("shipping");
    }

    /* =====================================================================
       UI wiring
       ===================================================================== */
    const overlay = $("#lb-overlay");
    const followBtn = $("#lb-follow");
    const tabs = document.querySelectorAll(".stab");
    const META = {
      road: { title: "LuminaBox convoy", sub: "Tracking 10 TEUs \u00B7 warehouse \u2192 VAB \u2192 pad", chip: "Time-lapse \u00B7 real OSM roads \u00B7 simulated", follow: "Follow selected TEU (scroll to zoom)" },
      warehouse: { title: "LuminaBox inventory", sub: "Tracking 36 TEUs \u00B7 KSC Logistics Facility", chip: "Simulated inventory feed · click a container", follow: null },
      shipping: { title: "LuminaBox fleet", sub: "Tracking " + SHIP_TEUS + " TEUs \u00B7 3 routes to Cape Canaveral", chip: "Time-lapse \u00B7 simulated \u00B7 SATCOM at sea", follow: null },
      launch: { title: "LuminaBox LB-201–206", sub: "Tracking 6 TEUs · Cape → Japan", chip: "Notional trajectory · simulated", follow: "Director camera (scroll to zoom)" },
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
        setPlaying(false);
      }
      if (prev === "shipping" && cam.follow != null) {
        cam.follow = null;
        releaseCamera();
      }
      if (prev === "launch" || prev === "shipping") viewer.scene.screenSpaceCameraController.maximumZoomDistance = 160000;
      if (prev === "road" && cam.roadFollow) {
        cam.roadFollow = false;
        releaseCamera();
      }
      cam.zoom = 1;
      active = id;
      window.dispatchEvent(new CustomEvent("twin:scenario", { detail: id }));
      if (typeof renderTech === "function") renderTech(id);
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
      wxReadout.hidden = id === "launch" || id === "shipping";
      // weather overlays: hidden during the global launch view, restored otherwise
      if (id === "launch" || id === "shipping") {
        layers.wind.forEach((e) => (e.show = false));
        layers.precip.forEach((e) => (e.show = false));
        layers.rocket.forEach((e) => (e.show = id !== "launch"));
        viewer.scene.screenSpaceCameraController.maximumZoomDistance = Infinity;
      } else {
        layers.rocket.forEach((e) => (e.show = true));
        ["wind", "precip"].forEach((k) => {
          const cb = document.querySelector('[data-layer="' + k + '"]');
          if (cb) cb.dispatchEvent(new Event("change"));
        });
      }
      if (id === "road" && !opts.force) resetCycle();
      tickActive();
      applyVisibility();
      if (opts.noFly) return;
      if (id === "road") {
        viewer.camera.flyToBoundingSphere(new C.BoundingSphere(cart(28.5915, -80.6285, 0), 1), {
          duration: 1.8,
          offset: new C.HeadingPitchRange(C.Math.toRadians(0), C.Math.toRadians(-58), 9600),
        });
      } else if (id === "warehouse") {
        viewer.camera.flyToBoundingSphere(new C.BoundingSphere(cart(WH.lat, WH.lon, 4), 1), {
          duration: 1.8,
          offset: new C.HeadingPitchRange(C.Math.toRadians(25), C.Math.toRadians(-42), 190),
        });
      } else if (id === "shipping") {
        flyShipOverview(2.4);
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
    function flyShipOverview(dur) {
      viewer.camera.flyToBoundingSphere(new C.BoundingSphere(cart(28.4, -87.9, 0), 1), {
        duration: dur,
        offset: new C.HeadingPitchRange(0, C.Math.toRadians(-72), 2.9e6),
      });
    }
    function tickActive() {
      if (active === "road") tickRoad();
      else if (active === "warehouse") tickWarehouse();
      else if (active === "shipping") tickShipping();
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
    $("#lb-feed-body").addEventListener("pointerdown", (ev) => {
      const b = ev.target.closest("[data-follow]");
      if (!b || active !== "shipping") return;
      const i = parseInt(b.dataset.follow, 10);
      if (cam.follow === i) {
        cam.follow = null;
        releaseCamera();
        flyShipOverview(1.8);
      } else {
        cam.follow = i;
        cam.zoom = 1;
      }
    });
    $("#lb-feed-body").addEventListener("pointerdown", (ev) => {
      const ts = ev.target.closest("[data-tsel]");
      if (ts) {
        road.sel = parseInt(ts.dataset.tsel, 10);
        return;
      }
      const ls = ev.target.closest("[data-lsel]");
      if (ls) {
        lsel = parseInt(ls.dataset.lsel, 10);
        return;
      }
      const sv = ev.target.closest("svg[data-scrub]");
      if (sv && active === "launch") {
        const r = sv.getBoundingClientRect();
        const f = clamp(((ev.clientX - r.left) / r.width * 268 - 30) / (268 - 30 - 6), 0, 1);
        setPlaying(false);
        mission.u = f;
        $("#mission-t").value = Math.round(f * 1000);
      }
    });
    const lf = $("#link-filter");
    function setLinkFilter(v) {
      linkFilter = v;
      if (lf)
        lf.querySelectorAll("button").forEach((b) => {
          const on = b.dataset.lf === v;
          b.classList.toggle("is-on", on);
          b.setAttribute("aria-pressed", String(on));
        });
      applyVisibility();
    }
    if (lf)
      lf.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-lf]");
        if (b) setLinkFilter(b.dataset.lf);
      });
    const TECH = {
      road: [["LuminaBox sensing", "#luminabox"], ["Road health", "#roadhealth"], ["Digital thread", "#digital-thread"], ["Planning", "#platform"], ["Connectivity", "#arch"]],
      warehouse: [["LuminaBox sensing", "#luminabox"], ["Digital thread", "#digital-thread"], ["Connectivity", "#arch"]],
      shipping: [["Logistics", "#logistics"], ["Connectivity", "#arch"], ["Digital thread", "#digital-thread"]],
      launch: [["Real-time CFD", "#cfd"], ["Connectivity", "#arch"], ["Digital thread", "#digital-thread"]],
    };
    function renderTech(id) {
      const el = $("#tech-chips");
      if (!el) return;
      el.innerHTML = '<span class="tabs-label">Technologies in this view</span>' + TECH[id].map(([t, h]) => '<a class="tchip" href="index.html' + h + '" target="_top">' + t + "</a>").join("");
    }
    function twinGo(p) {
      if (p.res === "fine" && !p.scn && active !== "road" && active !== "warehouse") p.scn = "road";
      if (p.scn) setScenario(p.scn);
      if (p.site) {
        const b = document.querySelector('.fac[data-site="' + p.site + '"]');
        if (b) b.click();
      }
      if (p.res) {
        const b = document.querySelector('#res-mode [data-res="' + p.res + '"]');
        if (b) b.click();
      }
      if (p.link) setLinkFilter(p.link);
      const fire = (sel, v) => {
        const e = document.querySelector(sel);
        if (e && v != null) {
          e.value = v;
          e.dispatchEvent(new Event("input"));
        }
      };
      if (p.spd != null) {
        fire("#wi-spd", p.spd);
        if (p.dir != null) fire("#wi-dir", p.dir);
      }
      if (p.hour != null) fire("#hour", p.hour);
    }
    window.twinGo = twinGo;
    window.twinState = () => {
      const val = (sel, d) => {
        const e = document.querySelector(sel);
        return e ? parseInt(e.value, 10) || d : d;
      };
      const res = document.querySelector("#res-mode .is-on");
      return { scn: active, site: api.getSelected(), res: res ? res.dataset.res : "coarse", link: linkFilter, spd: val("#wi-spd", 0), dir: val("#wi-dir", 90), hour: val("#hour", 0) };
    };
    // minimize the tracking card so it never hides the map (starts minimized on phones)
    const lbMin = $("#lb-min");
    const lbCard = document.querySelector(".lb-card");
    function setMin(card, btn, on) {
      card.classList.toggle("is-min", on);
      btn.setAttribute("aria-expanded", String(!on));
      btn.textContent = on ? "+" : "−";
      btn.title = btn.ariaLabel = on ? "Expand" : "Minimize";
    }
    if (lbMin && lbCard) {
      lbMin.addEventListener("click", () => setMin(lbCard, lbMin, !lbCard.classList.contains("is-min")));
      if (window.matchMedia("(max-width: 760px)").matches) setMin(lbCard, lbMin, true);
    }
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
      if (tag && tag.scn === "road" && active === "road") road.sel = tag.k;
    }, C.ScreenSpaceEventType.LEFT_CLICK);

    // render loop + feed
    viewer.scene.preRender.addEventListener(() => {
      T = performance.now() / 1000;
      tickActive();
      if (active === "shipping" && cam.follow != null) {
        const r = ROUTES[cam.follow];
        const b = r.b[0];
        viewer.camera.lookAt(b.pos, new C.HeadingPitchRange(C.Math.toRadians(b.brg + 160), C.Math.toRadians(-26), (r.mode === "ship" ? 380 : 75) * cam.zoom));
      }
      updateSats();
      if (active === "road" && cam.roadFollow) {
        viewer.camera.lookAt(
          road.focus,
          new C.HeadingPitchRange(C.Math.toRadians(road.hdg + 150), C.Math.toRadians(-24), road.range * cam.zoom)
        );
      }
    });
    viewer.canvas.addEventListener(
      "wheel",
      (ev) => {
        if ((active === "road" && cam.roadFollow) || (active === "launch" && cam.director && cam.ready) || (active === "shipping" && cam.follow != null)) {
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
      $("#lb-feed-body").innerHTML = active === "road" ? feedRoad() : active === "warehouse" ? feedWarehouse() : active === "shipping" ? feedShipping() : feedLaunch();
    }, 250);

    overlay.hidden = false;
    if (window.__twinPending) {
      const pp = window.__twinPending;
      window.__twinPending = null;
      setTimeout(() => twinGo(pp), 600);
    }
    setScenario("road", { force: true, noFly: true });
    log("road", "10 LuminaBoxes online \u00B7 link established with BS-1 (LCC)");
    log("warehouse", "Gateway BS-W online · " + whBox.length + " LuminaBoxes joined");
    log("shipping", "Fleet online \u00B7 " + SHIP_TEUS + " LuminaBoxes joined \u00B7 SATCOM fallback armed");
    log("launch", "LB-201–206 armed · link BS-1");
    void teuInPos;
    void launchOn;
  }
})();
