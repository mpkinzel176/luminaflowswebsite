/* Concept-only U.S. LuminaBox network view with synthetic event replays. */
(function () {
  "use strict";

  window.addEventListener("twin:ready", (event) => init(event.detail));

  function init(api) {
    const { viewer, Cesium: C, layers } = api;
    const $ = (selector) => document.querySelector(selector);
    const cart = (lat, lon, height) => C.Cartesian3.fromDegrees(lon, lat, height || 0);
    const white = C.Color.WHITE;
    const dark = C.Color.fromCssColorString("#06121f");
    const sites = [
      ["LB-01", "Northwest", 47.61, -122.33],
      ["LB-02", "Pacific Northwest", 45.52, -122.68],
      ["LB-03", "Northern California", 37.77, -122.42],
      ["LB-04", "Southern California", 34.05, -118.24],
      ["LB-05", "San Diego", 32.72, -117.16],
      ["LB-06", "Intermountain West", 40.76, -111.89],
      ["LB-07", "Southwest", 33.45, -112.07],
      ["LB-08", "Mountain West", 39.74, -104.99],
      ["LB-09", "Four Corners", 35.08, -106.65],
      ["LB-10", "North Texas", 32.78, -96.80],
      ["LB-11", "Gulf Coast", 29.76, -95.37],
      ["LB-12", "Central Plains", 39.10, -94.58],
      ["LB-13", "Upper Midwest", 44.98, -93.27],
      ["LB-14", "Great Lakes", 41.88, -87.63],
      ["LB-15", "Mid-South", 38.63, -90.20],
      ["LB-16", "Southeast", 33.75, -84.39],
      ["LB-17", "Florida Gulf", 27.95, -82.46],
      ["LB-18", "Florida Atlantic", 25.76, -80.19],
      ["LB-19", "Carolinas", 35.23, -80.84],
      ["LB-20", "Mid-Atlantic", 38.91, -77.04],
      ["LB-21", "Northeast", 40.71, -74.01],
      ["LB-22", "New England", 42.36, -71.06],
      ["LB-23", "Northern Rockies", 46.88, -110.36],
      ["LB-24", "Northern Plains", 46.88, -96.79],
      ["LB-25", "Alaska", 61.22, -149.90],
      ["LB-26", "Hawaii", 21.31, -157.86],
    ];
    const propagationSpeed = 20 * 343;
    const events = {
      highspeed: {
        name: "Hypersonic test-track concept",
        color: "#ffb347",
        speedMetersPerSecond: 20 * 343,
        points: [[34.9, -117.9, 30000], [35.8, -115.4, 32000], [37.1, -109.8, 34000], [38.5, -103.5, 36000], [32.8, -97.0, 38000]],
      },
      launch: {
        name: "Launch signature",
        color: "#ff6b5b",
        speedMetersPerSecond: 1800,
        points: [[28.56, -80.58, 0], [30.0, -80.2, 12000], [32.2, -79.7, 28000], [35.0, -78.8, 45000], [38.0, -77.8, 60000]],
      },
      aircraft: {
        name: "Aircraft corridor",
        color: "#41b7e3",
        speedMetersPerSecond: 250,
        points: [[47.45, -122.3, 10000], [45.2, -115.0, 10500], [43.1, -106.0, 11000], [41.9, -97.0, 11000], [40.2, -88.0, 10500], [38.9, -77.0, 10000]],
      },
    };
    const entities = [];
    const siteSignals = new Float32Array(sites.length);
    const siteSignalHistory = [];
    const networkSignalHistory = [];
    let networkActive = false;
    let currentEvent = "launch";
    let replayStart = 0;
    let replayRunning = false;
    const replayDuration = 30000;
    let eventPath = null;
    let sensorArrivalTimes = new Float64Array(sites.length);
    let activeSensors = new Uint8Array(sites.length);
    let nextSignalSample = 0;
    const status = $("#sensor-status");
    const nameOutput = $("#network-event-name");
    const stateOutput = $("#network-replay-state");
    const eventPicker = $("#sensor-event");
    const strongestOutput = $("#network-strongest");
    const groupOutput = $("#network-group-signal");
    const groupValueOutput = $("#network-group-out");
    const activeCountOutput = $("#network-active-count");
    const groupPath = $("#network-group-path");
    const sensorShading = $("#network-sensor-shading");
    const sensorPaths = sites.map(() => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", "network-sensor-area");
      sensorShading.appendChild(path);
      return path;
    });

    function addEntity(options, condition) {
      const entity = viewer.entities.add(options);
      entity._cond = condition || (() => networkActive);
      entities.push(entity);
      layers.sensors.push(entity);
      return entity;
    }

    function addSensorMarkers(sensorSites, indexOffset, tint) {
      sensorSites.forEach(([id, region, lat, lon], localIndex) => {
        const index = indexOffset + localIndex;
        const color = C.Color.fromCssColorString(tint);
        addEntity({
          position: cart(lat, lon, 1500),
          point: {
            pixelSize: 8,
            color: new C.CallbackProperty(
              () => (activeSensors[index] ? C.Color.fromCssColorString("#5fd08a") : color),
              false
            ),
            outlineColor: white,
            outlineWidth: 1.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        addEntity({
          position: cart(lat, lon, 1500),
          point: {
            show: new C.CallbackProperty(() => activeSensors[index] === 1, false),
            pixelSize: new C.CallbackProperty(() => 14 + siteSignals[index] * 30, false),
            color: C.Color.TRANSPARENT,
            outlineColor: new C.CallbackProperty(() => color.withAlpha(0.25 + siteSignals[index] * 0.75), false),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        addEntity({
          position: cart(lat, lon, 1500),
          label: {
            text: id + " · " + region,
            font: "600 11px ui-monospace, Consolas, monospace",
            fillColor: white,
            outlineColor: dark,
            outlineWidth: 3,
            style: C.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new C.Cartesian2(0, -12),
            distanceDisplayCondition: new C.DistanceDisplayCondition(0, 1250000),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      });
    }

    addSensorMarkers(sites, 0, "#41b7e3");

    function addTrackEntities() {
      Object.keys(events).forEach((key) => {
        const item = events[key];
        const positions = item.points.flatMap(([lat, lon, height]) => [lon, lat, height]);
        addEntity(
          {
            polyline: {
              positions: C.Cartesian3.fromDegreesArrayHeights(positions),
              width: 3,
              material: new C.PolylineGlowMaterialProperty({
                color: C.Color.fromCssColorString(item.color).withAlpha(0.9),
                glowPower: 0.18,
              }),
            },
          },
          () => networkActive && currentEvent === key
        );
        addEntity(
          {
            position: new C.CallbackProperty(() => routePosition(item.points, key), false),
            point: {
              pixelSize: 12,
              color: C.Color.fromCssColorString(item.color),
              outlineColor: white,
              outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: "SYNTHETIC TRACE",
              font: "600 11px ui-monospace, Consolas, monospace",
              fillColor: white,
              outlineColor: dark,
              outlineWidth: 3,
              style: C.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new C.Cartesian2(0, -16),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          },
          () => networkActive && currentEvent === key && replayStart > 0
        );
      });
    }
    addTrackEntities();

    function distanceMeters(a, b) {
      const meanLat = ((a[0] + b[0]) * Math.PI) / 360;
      const north = (b[0] - a[0]) * 111320;
      const east = (b[1] - a[1]) * 111320 * Math.cos(meanLat);
      const up = (b[2] || 0) - (a[2] || 0);
      return Math.hypot(north, east, up);
    }

    function pointAlong(a, b, fraction) {
      return [
        a[0] + (b[0] - a[0]) * fraction,
        a[1] + (b[1] - a[1]) * fraction,
        (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * fraction,
      ];
    }

    function buildEventPath() {
      const points = events[currentEvent].points;
      const eventSpeed = events[currentEvent].speedMetersPerSecond;
      const segmentLengths = points.slice(1).map((point, index) => distanceMeters(points[index], point));
      const totalDistance = segmentLengths.reduce((sum, length) => sum + length, 0);
      const times = [0];
      segmentLengths.forEach((length) => times.push(times[times.length - 1] + length / eventSpeed));
      eventPath = { points, segmentLengths, times, duration: times[times.length - 1], totalDistance, eventSpeed };
      sensorArrivalTimes = new Float64Array(sites.length);

      sites.forEach((site, siteIndex) => {
        let arrival = Number.POSITIVE_INFINITY;
        let traveled = 0;
        segmentLengths.forEach((length, segmentIndex) => {
          const a = points[segmentIndex];
          const b = points[segmentIndex + 1];
          const samples = Math.max(1, Math.ceil(length / 25000));
          for (let sample = 0; sample <= samples; sample++) {
            const fraction = sample / samples;
            const source = pointAlong(a, b, fraction);
            const sourceTime = (traveled + length * fraction) / eventSpeed;
            const travelTime = distanceMeters(source, [site[2], site[3], 0]) / propagationSpeed;
            arrival = Math.min(arrival, sourceTime + travelTime);
          }
          traveled += length;
        });
        sensorArrivalTimes[siteIndex] = arrival;
      });
    }

    function getEventPosition(elapsedSeconds) {
      const distance = Math.min(eventPath.totalDistance, elapsedSeconds * eventPath.eventSpeed);
      let segment = 0;
      while (segment < eventPath.segmentLengths.length - 1 && distance > eventPath.times[segment + 1] * eventPath.eventSpeed) segment++;
      const segmentStart = eventPath.times[segment] * eventPath.eventSpeed;
      const fraction = eventPath.segmentLengths[segment]
        ? Math.min(1, (distance - segmentStart) / eventPath.segmentLengths[segment])
        : 0;
      return pointAlong(eventPath.points[segment], eventPath.points[segment + 1], fraction);
    }

    function maxArrivalTime() {
      return sensorArrivalTimes.reduce((max, time) => Math.max(max, time), eventPath.duration);
    }

    function replayElapsedSeconds(now) {
      return replayStart ? ((now - replayStart) / replayDuration) * maxArrivalTime() : 0;
    }

    function routePosition(points, key) {
      if (key !== currentEvent || !eventPath) return C.Cartesian3.fromDegrees(points[0][1], points[0][0], points[0][2] || 0);
      const position = getEventPosition(replayElapsedSeconds(performance.now()));
      return C.Cartesian3.fromDegrees(position[1], position[0], position[2]);
    }

    function updateSignal(elapsedSeconds) {
      const source = getEventPosition(elapsedSeconds);
      let strongestIndex = 0;
      let strongestValue = 0;
      let networkPower = 0;
      let activeCount = 0;

      sites.forEach((site, index) => {
        if (elapsedSeconds >= sensorArrivalTimes[index]) activeSensors[index] = 1;
        const distanceKm = distanceMeters(source, [site[2], site[3], 0]) / 1000;
        const signal = activeSensors[index] ? Math.exp(-0.5 * (distanceKm / 190) ** 2) : 0;
        siteSignals[index] = signal;
        activeCount += activeSensors[index];
        networkPower += signal * signal;
        if (signal > strongestValue) {
          strongestValue = signal;
          strongestIndex = index;
        }
      });
      const combinedSignal = Math.sqrt(networkPower);
      siteSignalHistory.push(Array.from(siteSignals));
      if (siteSignalHistory.length > 64) siteSignalHistory.shift();
      networkSignalHistory.push(combinedSignal);
      if (networkSignalHistory.length > 64) networkSignalHistory.shift();
      siteSignals.forEach((_, sensorIndex) => {
        const line = siteSignalHistory
          .map((frame, index) => {
            const x = (index / Math.max(1, siteSignalHistory.length - 1)) * 240;
            const y = 49 - frame[sensorIndex] * 45;
            return (index ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
          })
          .join("");
        sensorPaths[sensorIndex].setAttribute("d", line + " L240 49 L0 49 Z");
      });
      const networkPath = networkSignalHistory
        .map((value, index) => {
          const x = (index / Math.max(1, networkSignalHistory.length - 1)) * 240;
          const y = 49 - (value / Math.sqrt(sites.length)) * 45;
          return (index ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
        })
        .join(" ");
      groupPath.setAttribute("d", networkPath || "M0 49 L240 49");
      groupOutput.textContent = combinedSignal.toFixed(2) + " relative";
      strongestOutput.textContent = activeCount ? sites[strongestIndex][0] + " · " + sites[strongestIndex][1] : "—";
      groupValueOutput.textContent = combinedSignal.toFixed(2);
      activeCountOutput.textContent = activeCount + " / " + sites.length;
    }

    function selectEvent(key) {
      currentEvent = events[key] ? key : "launch";
      const name = events[currentEvent].name;
      nameOutput.textContent = name;
      stateOutput.textContent = "Ready · synthetic trace";
      status.textContent = "Concept view · synthetic traces only";
      replayStart = 0;
      replayRunning = false;
      buildEventPath();
      activeSensors.fill(0);
      siteSignalHistory.length = 0;
      networkSignalHistory.length = 0;
      siteSignals.fill(0);
      strongestOutput.textContent = "—";
      activeCountOutput.textContent = "0 / " + sites.length;
      groupOutput.textContent = "—";
      groupValueOutput.textContent = "0.00";
      groupPath.setAttribute("d", "M0 49 L240 49");
      sensorPaths.forEach((path) => path.setAttribute("d", "M0 49 L240 49 Z"));
      updateVisibility();
    }

    function updateVisibility() {
      const enabled = networkActive && $('[data-layer="sensors"]').checked;
      entities.forEach((entity) => {
        entity.show = enabled && entity._cond();
      });
    }

    function replay() {
      buildEventPath();
      replayStart = performance.now();
      replayRunning = true;
      activeSensors.fill(0);
      nextSignalSample = 0;
      siteSignalHistory.length = 0;
      networkSignalHistory.length = 0;
      siteSignals.fill(0);
      activeCountOutput.textContent = "0 / " + sites.length;
      sensorPaths.forEach((path) => path.setAttribute("d", "M0 49 L240 49 Z"));
      groupPath.setAttribute("d", "M0 49 L240 49");
      status.textContent = "Synthetic replay running · no live detections";
      stateOutput.textContent = "Synthetic replay running";
      updateVisibility();
    }

    eventPicker.addEventListener("change", () => selectEvent(eventPicker.value));
    $("#sensor-replay").addEventListener("click", replay);
    $('[data-layer="sensors"]').addEventListener("change", updateVisibility);
    window.addEventListener("twin:scenario", (scenarioEvent) => {
      networkActive = scenarioEvent.detail === "us-network";
      updateVisibility();
    });
    viewer.scene.preRender.addEventListener(() => {
      const now = performance.now();
      if (replayRunning && now >= nextSignalSample) {
        updateSignal(replayElapsedSeconds(now));
        nextSignalSample = now + 150;
      }
      if (replayRunning && performance.now() - replayStart >= replayDuration) {
        updateSignal(maxArrivalTime());
        replayRunning = false;
        stateOutput.textContent = "Replay complete · synthetic trace";
        status.textContent = "Replay complete · illustrative only";
      }
    });

    selectEvent(eventPicker.value);
    updateVisibility();
  }
})();
