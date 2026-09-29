const toggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector("#nav-links");
const year = document.querySelector("#year");

if (year) {
  year.textContent = new Date().getFullYear();
}

if (toggle && navLinks) {
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    navLinks.classList.toggle("is-open", !expanded);
  });

  navLinks.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      toggle.setAttribute("aria-expanded", "false");
      navLinks.classList.remove("is-open");
    }
  });
}
