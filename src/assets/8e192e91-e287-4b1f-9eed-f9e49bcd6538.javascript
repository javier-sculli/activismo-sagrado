/* app.jsx — Tensiones interactive list + Tweaks panel */

const { useState, useEffect } = React;

const TENSIONES = [
  {
    a: "Cambio sutil",
    b: "Transformación radical",
    note: "No niega ninguno: integra ambos.",
  },
  {
    a: "Espiritualidad",
    b: "Acción concreta",
    note: "Sin cuerpo no hay verdad.",
  },
  {
    a: "Individualidad",
    b: "Comunidad",
    note: "La unicidad existe dentro del nosotros.",
  },
  {
    a: "Intención",
    b: "Acción",
    note: "No alcanza con sentir, hay que hacer.",
  },
  {
    a: "Proceso",
    b: "Impacto",
    note: "El impacto sin proceso se vacía de sentido.",
  },
];

function Tensiones() {
  const [open, setOpen] = useState(0);
  return (
    <>
      {TENSIONES.map((t, i) => (
        <div
          key={i}
          className={"tension" + (open === i ? " open" : "")}
          onClick={() => setOpen(open === i ? -1 : i)}
        >
          <div className="tension-num">0{i + 1}</div>
          <div className="tension-pair">
            <span>{t.a}</span>
            <span className="vs">↔</span>
            <span>{t.b}</span>
          </div>
          <div className="tension-note">{t.note}</div>
        </div>
      ))}
    </>
  );
}

// Mount Tensiones list
const tensionesRoot = document.getElementById("tensiones-list");
if (tensionesRoot) {
  ReactDOM.createRoot(tensionesRoot).render(<Tensiones />);
}

/* ===================== Tweaks ===================== */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "sobria",
  "accent": "#F56535",
  "showHash": true,
  "tagline": "El amor también es una forma de lucha"
}/*EDITMODE-END*/;

const ACCENT_PRESETS = {
  "#F56535": { soft: "#FFBB44", highlight: "#F7C627" },
  "#F7C627": { soft: "#FFE583", highlight: "#FFBB44" },
  "#31AFAF": { soft: "#358464", highlight: "#FFE583" },
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // apply theme
  useEffect(() => {
    document.body.classList.toggle("theme-manija", t.theme === "manija");
    document.body.classList.toggle("theme-sobria", t.theme !== "manija");
  }, [t.theme]);

  // apply accent
  useEffect(() => {
    const p = ACCENT_PRESETS[t.accent] || ACCENT_PRESETS["#F56535"];
    document.documentElement.style.setProperty("--accent", t.accent);
    document.documentElement.style.setProperty("--accent-soft", p.soft);
    document.documentElement.style.setProperty("--highlight", p.highlight);
  }, [t.accent]);

  // show/hide hash rules
  useEffect(() => {
    document.querySelectorAll(".hash-rule").forEach((el) => {
      el.style.display = t.showHash ? "" : "none";
    });
  }, [t.showHash]);

  // tagline injection
  useEffect(() => {
    const eyebrow = document.querySelector(".hero .eyebrow");
    if (eyebrow && t.tagline) {
      // preserve the ::before bar; only text nodes after it
      const txt = document.createTextNode(t.tagline);
      // clear & rebuild
      eyebrow.innerHTML = "";
      eyebrow.appendChild(txt);
    }
  }, [t.tagline]);

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Identidad">
        <TweakRadio
          label="Tono"
          value={t.theme}
          options={[
            { value: "sobria", label: "Sobria" },
            { value: "manija", label: "Manija" },
          ]}
          onChange={(v) => setTweak("theme", v)}
        />
      </TweakSection>

      <TweakSection label="Acento">
        <TweakColor
          label="Color de acento"
          value={t.accent}
          options={["#F56535", "#F7C627", "#31AFAF"]}
          onChange={(v) => setTweak("accent", v)}
        />
      </TweakSection>

      <TweakSection label="Detalles">
        <TweakToggle
          label="Líneas diagonales"
          value={t.showHash}
          onChange={(v) => setTweak("showHash", v)}
        />
        <TweakText
          label="Tagline del hero"
          value={t.tagline}
          onChange={(v) => setTweak("tagline", v)}
        />
      </TweakSection>
    </TweaksPanel>
  );
}

const tweaksMount = document.createElement("div");
document.body.appendChild(tweaksMount);
ReactDOM.createRoot(tweaksMount).render(<App />);
