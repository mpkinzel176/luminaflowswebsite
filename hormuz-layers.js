/* Independent illustrative Hormuz map overlays. Not navigational data. */
(function () {
  "use strict";

  window.addEventListener("twin:ready", ({ detail }) => {
    const viewer = detail.viewer;
    const C = detail.Cesium;
    const controls = Array.from(document.querySelectorAll("[data-hz-layer]"));
    const color = (hex, alpha) => C.Color.fromCssColorString(hex).withAlpha(alpha);
    const colors = {
      closure: color("#c94438", 0.9),
      corridor: color("#54cf8a", 0.95),
      mine: color("#e65353", 0.95),
      threat: color("#ffb547", 0.95),
      disruption: color("#b3bec8", 0.95),
    };
    const entities = {};
    let scenario = document.querySelector(".stab.is-active")?.dataset.scn || "road";

    const positions = (points) => C.Cartesian3.fromDegreesArray(points.flatMap(([lat, lon]) => [lon, lat]));
    const area = (key, points, alpha, striped) => {
      const material = striped
        ? new C.StripeMaterialProperty({ evenColor: colors[key].withAlpha(alpha), oddColor: color("#07131e", 0.08), repeat: 10 })
        : colors[key].withAlpha(alpha);
      entities[key] = [viewer.entities.add({
        polygon: {
          hierarchy: new C.PolygonHierarchy(positions(points)),
          material,
          height: 0,
          heightReference: C.HeightReference.CLAMP_TO_GROUND,
          outline: true,
          outlineColor: colors[key],
        },
      })];
    };

    // Approximate chart A-D converted from degrees/minutes to decimal degrees.
    const tssBounds = [[26.7086, 56.3261], [26.7092, 56.6897], [26.3769, 56.6925], [26.3775, 56.3269]];
    area("closure", [[26.79, 56.22], [26.82, 56.82], [26.27, 56.83], [26.28, 56.2]], 0.22, true);
    area("mine", tssBounds, 0.2, true);
    area("threat", [[26.83, 55.55], [26.89, 56.16], [26.82, 56.78], [26.48, 57.2], [25.88, 57.48], [25.58, 56.93], [25.71, 56.25], [26.03, 55.62]], 0.11, false);
    area("disruption", [[26.51, 56.66], [26.55, 57.03], [26.23, 57.2], [25.96, 56.94], [26.12, 56.66]], 0.19, true);
    entities.corridor = [viewer.entities.add({
      polyline: {
        positions: positions([[26.22, 56.2], [26.19, 56.38], [26.14, 56.58], [26.04, 56.79], [25.9, 56.97], [25.7, 57.2], [25.46, 57.45], [25.2, 57.75]]),
        width: 6,
        clampToGround: true,
        material: new C.PolylineGlowMaterialProperty({ color: colors.corridor, glowPower: 0.18 }),
      },
    })];

    const updateVisibility = () => {
      controls.forEach((control) => {
        (entities[control.dataset.hzLayer] || []).forEach((entity) => {
          entity.show = scenario === "hormuz" && control.checked;
        });
      });
    };
    controls.forEach((control) => control.addEventListener("change", updateVisibility));
    window.addEventListener("twin:scenario", (event) => {
      scenario = event.detail;
      updateVisibility();
    });
    updateVisibility();
  });
})();
