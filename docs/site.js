// Crew Link – Website: Tag/Nacht, Handy-Menü, Bilder groß. Kein Tracking, keine Anfragen nach außen.
(function () {
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem("crewlink-theme"); } catch (e) { /* privater Modus */ }
  if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);

  function current() {
    var t = root.getAttribute("data-theme");
    if (t === "light" || t === "dark") return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  document.addEventListener("DOMContentLoaded", function () {
    var themeBtn = document.getElementById("theme");
    if (themeBtn) themeBtn.addEventListener("click", function () {
      var next = current() === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("crewlink-theme", next); } catch (e) { /* privater Modus */ }
    });

    var menu = document.getElementById("menu"), nav = document.getElementById("nav");
    if (menu && nav) {
      menu.addEventListener("click", function () {
        var open = nav.classList.toggle("open");
        menu.setAttribute("aria-expanded", open ? "true" : "false");
      });
      nav.addEventListener("click", function (e) {
        if (e.target.tagName === "A") { nav.classList.remove("open"); menu.setAttribute("aria-expanded", "false"); }
      });
    }

    var viewer = document.getElementById("viewer");
    if (viewer) {
      var big = viewer.querySelector("img"), from = null;
      var de = (root.getAttribute("lang") || "").indexOf("de") === 0;
      function open(img) { from = img; big.src = img.src; big.alt = img.alt; viewer.classList.add("open"); }
      function close() {
        if (!viewer.classList.contains("open")) return;
        viewer.classList.remove("open");
        if (from) { from.focus(); from = null; }
      }
      // Bilder auch per Tastatur vergrößern (Tab, dann Enter oder Leertaste); Escape schließt, Fokus kehrt zurück
      document.querySelectorAll("figure img").forEach(function (img) {
        img.setAttribute("tabindex", "0");
        img.setAttribute("role", "button");
        img.setAttribute("aria-label", (de ? "Bild vergrößern: " : "Enlarge image: ") + (img.alt || ""));
        img.addEventListener("click", function () { open(img); });
        img.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(img); }
        });
      });
      viewer.addEventListener("click", close);
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    }
  });
})();
