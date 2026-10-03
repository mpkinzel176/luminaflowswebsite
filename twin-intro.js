/* First-use orientation text for each 3D twin scenario. */
(function () {
  "use strict";

  const introductions = {
    road: [
      "Follow a LuminaBox shipment",
      "Containers move along KSC roads. Each tracked unit reports simulated location and condition through LuminaBox, alongside facility and weather context.",
      "Click a container in the map or feed. Use Forecast time below the map to explore weather; choose Follow to track one unit.",
    ],
    warehouse: [
      "See warehouse inventory",
      "This view shows simulated containers at the KSC Logistics Facility. LuminaBox gives each unit a digital identity and current status for inventory visibility.",
      "Click a container in the map to inspect its LuminaBox record.",
    ],
    shipping: [
      "Track shipments on the move",
      "Follow simulated sea and road routes toward Cape Canaveral. LuminaBox keeps asset status visible as connectivity changes between cellular and satellite links.",
      "Choose Follow on a route in the feed to track it on the map.",
    ],
    launch: [
      "Follow the mission timeline",
      "Watch simulated LuminaBox-equipped containers move through a notional Cape-to-Japan mission. The twin connects asset telemetry with mission phases.",
      "Choose a mission phase, then press Play or drag the timeline below the map.",
    ],
    hormuz: [
      "Understand a constrained shipping lane",
      "This illustrative scenario shows tanker traffic and simulated navigation disruption. LuminaBox compares a fused asset track with GNSS reports; this is not live vessel or threat data.",
      "Toggle the maritime layers below the map. Try the interference and traffic controls, or select Stall a tanker to see a queue form.",
    ],
  };

  function render(scenario) {
    const copy = introductions[scenario] || introductions.road;
    const title = document.querySelector("#view-intro-title");
    const explanation = document.querySelector("#view-intro-copy");
    const action = document.querySelector("#view-intro-action");
    if (!title || !explanation || !action) return;
    [title.textContent, explanation.textContent, action.textContent] = copy;
  }

  render(document.querySelector(".stab.is-active")?.dataset.scn || "road");
  window.addEventListener("twin:scenario", (event) => render(event.detail));
})();
