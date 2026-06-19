(function () {
  const FLAVOURS = [
    { id: "verdino", name: "Verdino", sprite: "verdino.png" },
    { id: "pyra", name: "Pyra", sprite: "pyra.png" },
    { id: "pingu", name: "Pingu", sprite: "pingu.png" },
    { id: "cryptoa", name: "Cryptoa", sprite: "cryptoa.png" },
    { id: "glitcho", name: "Glitcho", sprite: "glitcho.png" },
    { id: "packbot", name: "Packbot", sprite: "packbot.png" }
  ];

  const STORAGE_KEY = "postmon.flavour";
  let current = "verdino";

  function detectInitial() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && FLAVOURS.some((f) => f.id === saved)) return saved;
    } catch (e) {}
    return "verdino";
  }

  function apply() {
    const flavour = FLAVOURS.find((f) => f.id === current) || FLAVOURS[0];
    document.body.classList.forEach((cls) => {
      if (cls.startsWith("flavour-")) document.body.classList.remove(cls);
    });
    document.body.classList.add(`flavour-${flavour.id}`);
    const mascot = document.querySelector(".mascot");
    if (mascot) mascot.setAttribute("src", `./assets/monsters/${flavour.sprite}`);
  }

  function setFlavour(id) {
    if (!FLAVOURS.some((f) => f.id === id)) return;
    current = id;
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) {}
    apply();
    window.dispatchEvent(new CustomEvent("flavour:change", { detail: { id } }));
  }

  function getFlavour() {
    return current;
  }

  function listFlavours() {
    return FLAVOURS.slice();
  }

  current = detectInitial();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }

  window.theme = { setFlavour, getFlavour, listFlavours };
})();
