/* ============================================================
   EE Knowledge Base — curriculum registry
   Single source of truth for navigation, pager, index cards,
   and progress tracking. Order here = study order.
   ============================================================ */

const EE_CURRICULUM = {
  parts: [
    {
      id: "p1",
      title: "Mathematical Foundations",
      de: "Mathematische Grundlagen",
      icon: "∑",
      desc: "The language everything else is written in — roughly the first three semesters of Höhere Mathematik, distilled to what an engineer actually uses.",
      modules: [
        {
          id: "m01", file: "m01-complex-linear-algebra.html", icon: "🧮",
          title: "Complex Numbers & Linear Algebra",
          de: "Komplexe Zahlen & Lineare Algebra",
          desc: "The imaginary unit j, phasors-in-waiting, Euler's formula, vectors, matrices and systems of linear equations — the toolkit behind AC analysis and every simulation."
        },
        {
          id: "m02", file: "m02-calculus-odes.html", icon: "📐",
          title: "Calculus & Differential Equations",
          de: "Analysis & Differentialgleichungen",
          desc: "Derivatives and integrals as rates and accumulations, and the ordinary differential equations that govern every capacitor charge and motor spin-up."
        },
        {
          id: "m03", file: "m03-transforms.html", icon: "🌊",
          title: "Fourier, Laplace & Transforms",
          de: "Fourier- & Laplace-Transformation",
          desc: "Why every signal is a sum of sinusoids, how transforms turn calculus into algebra, and the frequency-domain view that defines modern EE."
        }
      ]
    },
    {
      id: "p2",
      title: "Fundamentals of Electrical Engineering",
      de: "Grundlagen der Elektrotechnik",
      icon: "⚡",
      desc: "The core canon (GET I–III + fields): what current, voltage and fields really are, and how to analyze any circuit — DC, AC or transient.",
      modules: [
        {
          id: "m04", file: "m04-dc-circuits.html", icon: "🔋",
          title: "DC Circuit Analysis",
          de: "Gleichstromtechnik",
          desc: "Charge, current, voltage, Ohm's law, Kirchhoff's laws, nodal and mesh analysis, Thévenin & Norton, power and efficiency — the grammar of all circuits."
        },
        {
          id: "m05", file: "m05-ac-circuits.html", icon: "〰️",
          title: "AC Circuits & Phasors",
          de: "Wechselstromtechnik",
          desc: "Sinusoids, RMS, complex impedance, phasor diagrams, real/reactive/apparent power, and three-phase systems — how the entire grid is analyzed."
        },
        {
          id: "m06", file: "m06-transients-rlc.html", icon: "📈",
          title: "Transients & RLC Networks",
          de: "Ausgleichsvorgänge & Schwingkreise",
          desc: "What happens between steady states: RC/RL time constants, second-order RLC dynamics, damping, resonance and quality factor."
        },
        {
          id: "m07", file: "m07-em-fields.html", icon: "🧲",
          title: "Electromagnetic Fields & Maxwell's Equations",
          de: "Elektromagnetische Felder",
          desc: "Electrostatics, magnetostatics, induction and the four Maxwell equations — where R, L and C actually come from, and why light exists."
        }
      ]
    },
    {
      id: "p3",
      title: "Electronics",
      de: "Elektronik",
      icon: "🔬",
      desc: "From silicon physics to working circuits: how diodes and transistors work, and how to build amplifiers, logic and entire chips out of them.",
      modules: [
        {
          id: "m08", file: "m08-semiconductors.html", icon: "💠",
          title: "Semiconductor Devices",
          de: "Halbleiterbauelemente",
          desc: "Doping, the pn-junction, diodes, MOSFETs and BJTs — the physics of the devices that make all electronics possible."
        },
        {
          id: "m09", file: "m09-analog-electronics.html", icon: "🎚️",
          title: "Analog Circuit Design",
          de: "Analoge Schaltungstechnik",
          desc: "Transistor amplifiers, biasing, the almighty op-amp, negative feedback, filters and oscillators — shaping continuous signals."
        },
        {
          id: "m10", file: "m10-digital-electronics.html", icon: "🔢",
          title: "Digital Logic Design",
          de: "Digitaltechnik",
          desc: "Boolean algebra, gates, Karnaugh maps, flip-flops, state machines, and how CMOS implements it all — the foundation of every processor."
        },
        {
          id: "m11", file: "m11-microelectronics.html", icon: "🪙",
          title: "Microelectronics & Chip Design",
          de: "Mikroelektronik & Chipentwurf",
          desc: "CMOS scaling, the IC design flow from RTL to layout, memory technologies, and why building a chip is like printing a city."
        }
      ]
    },
    {
      id: "p4",
      title: "Signals, Control & Computing",
      de: "Signale, Regelung & Rechnersysteme",
      icon: "🎛️",
      desc: "The systems view: describing, processing and controlling dynamic behavior — and the embedded computers that do it in real time.",
      modules: [
        {
          id: "m12", file: "m12-signals-systems.html", icon: "📡",
          title: "Signals & Systems",
          de: "Signale & Systeme",
          desc: "LTI systems, convolution, impulse response, transfer functions, Bode plots and sampling — the shared language of control, comms and DSP."
        },
        {
          id: "m13", file: "m13-dsp.html", icon: "🎧",
          title: "Digital Signal Processing",
          de: "Digitale Signalverarbeitung",
          desc: "The DFT/FFT, z-transform, FIR/IIR filter design, windowing and quantization — processing the world after the ADC."
        },
        {
          id: "m14", file: "m14-control.html", icon: "🎯",
          title: "Control Engineering",
          de: "Regelungstechnik",
          desc: "Feedback loops, stability, PID controllers, root locus and frequency-domain design — making systems do what you want despite disturbances."
        },
        {
          id: "m15", file: "m15-measurement.html", icon: "📏",
          title: "Measurement & Instrumentation",
          de: "Messtechnik",
          desc: "Measurement errors and uncertainty, bridges, ADCs/DACs, oscilloscopes and sensors — you can only engineer what you can measure."
        },
        {
          id: "m16", file: "m16-embedded.html", icon: "🤖",
          title: "Microcontrollers & Embedded Systems",
          de: "Eingebettete Systeme",
          desc: "Processor architecture, memory, peripherals, interrupts, buses (UART/SPI/I²C/CAN) and real-time constraints — computers hidden inside things."
        }
      ]
    },
    {
      id: "p5",
      title: "Power Engineering",
      de: "Energietechnik",
      icon: "🏭",
      desc: "Generating, converting, moving and using electrical energy at scale — machines, converters and the grid that ties a continent together.",
      modules: [
        {
          id: "m17", file: "m17-machines.html", icon: "⚙️",
          title: "Electrical Machines & Drives",
          de: "Elektrische Maschinen & Antriebe",
          desc: "Transformers, DC machines, induction and synchronous machines, torque production and variable-speed drives."
        },
        {
          id: "m18", file: "m18-power-electronics.html", icon: "🔀",
          title: "Power Electronics",
          de: "Leistungselektronik",
          desc: "Switching converters — rectifiers, buck/boost, inverters and PWM — the technology behind EVs, solar inverters and every phone charger."
        },
        {
          id: "m19", file: "m19-power-systems.html", icon: "🗼",
          title: "Power Systems & the Grid",
          de: "Elektrische Energieversorgung",
          desc: "Grid structure, load flow, short circuits, protection, frequency stability and the renewable-energy transformation of the network."
        }
      ]
    },
    {
      id: "p6",
      title: "Communications & High Frequency",
      de: "Nachrichtentechnik & Hochfrequenztechnik",
      icon: "📶",
      desc: "Moving information instead of energy: modulation, information theory, antennas and the RF engineering that makes wireless possible.",
      modules: [
        {
          id: "m20", file: "m20-communications.html", icon: "📻",
          title: "Communications Engineering",
          de: "Nachrichtentechnik",
          desc: "AM/FM, digital modulation (QAM, OFDM), noise, Shannon's channel capacity and coding — how bits survive a noisy world."
        },
        {
          id: "m21", file: "m21-rf-emc.html", icon: "📡",
          title: "High-Frequency Engineering & EMC",
          de: "Hochfrequenztechnik & EMV",
          desc: "Transmission lines, reflections and impedance matching, the Smith chart, antennas, and electromagnetic compatibility."
        }
      ]
    }
  ]
};

/* Flat ordered list + lookup helpers */
const EE_MODULES = EE_CURRICULUM.parts.flatMap(p =>
  p.modules.map(m => Object.assign(m, { part: p.title, partDe: p.de, partId: p.id }))
);
EE_MODULES.forEach((m, i) => { m.index = i; m.num = String(i + 1).padStart(2, "0"); });

function eeModuleById(id) { return EE_MODULES.find(m => m.id === id) || null; }
