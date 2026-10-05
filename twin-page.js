/* Standalone digital-twin page: share a view with a link.
   Query parameters: scn (road|warehouse|shipping|launch|us-network), site (all|vab|lc39a|lc39b|slc40),
   res (coarse|fine), link (all|rf|cell|sat), spd + dir (what-if wind), hour (0-47), embed=1. */
(function () {
  "use strict";
  const q = new URLSearchParams(location.search);
  if (q.get("embed") === "1") document.body.classList.add("embed");

  const preset = {};
  ["scn", "site", "res", "link", "jam", "dem"].forEach((k) => {
    if (q.get(k)) preset[k] = q.get(k);
  });
  ["spd", "dir", "hour"].forEach((k) => {
    const v = parseInt(q.get(k), 10);
    if (!isNaN(v)) preset[k] = v;
  });
  if (Object.keys(preset).length) window.__twinPending = preset;

  // URL for the view as it is right now (used by Copy link and Open full screen)
  window.twinUrl = function () {
    const st = typeof window.twinState === "function" ? window.twinState() : {};
    const u = new URL("twin.html", location.href);
    u.search = "";
    if (st.scn && st.scn !== "road") u.searchParams.set("scn", st.scn);
    if (st.site && st.site !== "all") u.searchParams.set("site", st.site);
    if (st.res === "fine") u.searchParams.set("res", "fine");
    if (st.link && st.link !== "all") u.searchParams.set("link", st.link);
    if (st.spd > 0) {
      u.searchParams.set("spd", st.spd);
      u.searchParams.set("dir", st.dir);
    }
    if (st.hour > 0) u.searchParams.set("hour", st.hour);
    if (st.scn === "hormuz") {
      if (st.jam && st.jam !== "mod") u.searchParams.set("jam", st.jam);
      if (st.dem && st.dem !== "normal") u.searchParams.set("dem", st.dem);
    }
    return u.toString();
  };

  const btn = document.querySelector("#twin-copy");
  const note = document.querySelector("#twin-copied");
  if (btn) {
    btn.addEventListener("click", async () => {
      const url = window.twinUrl();
      let ok = false;
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch (e) {
        window.prompt("Copy this link:", url);
      }
      if (note && ok) {
        note.textContent = "Link copied";
        setTimeout(() => (note.textContent = ""), 2200);
      }
    });
  }
})();
