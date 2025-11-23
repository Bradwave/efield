const svg = document.getElementById("canvas");
svg.innerHTML = `<defs>
<marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
<path d="M0,0 L0,6 L6,3 z" fill="#9a2b17"/>
</marker>
</defs>`;

let linesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
let vectorsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
let chargesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
let textGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
textGroup.id = 'textGroup';
svg.appendChild(linesGroup);
svg.appendChild(vectorsGroup);
svg.appendChild(chargesGroup);
svg.appendChild(textGroup);

let state = JSON.parse(localStorage.getItem('chargesAppState')) || {
    charges: [
        { x: -1, y: 0, q: 1, label: "+q" },
        { x: 1, y: 0, q: 1, label: "+q" },
        { x: 0, y: 1.2, q: -1, label: "-q" }
    ],
    FIELD_STEP: 0.3, NUM_LEVELS: 12, VMAX: 5, VMIN: -5,
    vectorWidth: 0.008, equipWidth: 0.010,
    lineMin: 0.08, arrowMax: 0.35,
    showLabels: true, scaleCharge: true,
    baseChargeSize: 0.08, textSize: 0.15, textStroke: 0.003
};

let selectedCharge = null, isDragging = false;

function saveState() { localStorage.setItem('chargesAppState', JSON.stringify(state)); }

function potential(x, y) {
    return state.charges.reduce((s, c) => s + c.q / Math.hypot(x - c.x, y - c.y), 0);
}

function eField(x, y) {
    let Ex = 0, Ey = 0;
    for (const c of state.charges) {
        const dx = x - c.x, dy = y - c.y;
        const r2 = dx * dx + dy * dy || 1e-12;
        const f = c.q / (r2 * Math.sqrt(r2));
        Ex += f * dx; Ey += f * dy;
    }
    return { x: Ex, y: Ey };
}

function createSVG(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
}

// ================= MARCHING SQUARES =================
const NX = 150, NY = 150;
const EDGE_TABLE = {
    1: [[0, 3]], 2: [[0, 1]], 3: [[1, 3]], 4: [[1, 2]], 5: [[0, 1], [2, 3]], 6: [[0, 2]], 7: [[2, 3]],
    8: [[2, 3]], 9: [[0, 2]], 10: [[0, 3], [1, 2]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[0, 3]]
};

function interp(x1, y1, v1, x2, y2, v2, L) {
    if (Math.abs(v2 - v1) < 1e-15) return { x: x1, y: y1 };
    const t = (L - v1) / (v2 - v1);
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

function buildGrid() {
    const xs = [], ys = [], grid = [];
    for (let i = 0; i < NX; i++) xs[i] = -3 + 6 * i / (NX - 1);
    for (let j = 0; j < NY; j++) ys[j] = -2 + 5 * j / (NY - 1);
    for (let j = 0; j < NY; j++) {
        grid[j] = [];
        for (let i = 0; i < NX; i++) grid[j][i] = potential(xs[i], ys[j]);
    }
    return { grid, xs, ys };
}

function stitchSegments(segments) {
    const tol = 1e-8;
    const key = p => (Math.round(p.x * 1e6) / 1e6) + "," + (Math.round(p.y * 1e6) / 1e6);
    const ep = new Map();
    function add(k, si) { if (!ep.has(k)) ep.set(k, []); ep.get(k).push(si); }
    segments.forEach((s, idx) => { add(key(s[0]), idx); add(key(s[1]), idx); });
    const used = new Array(segments.length).fill(false);
    const out = [];
    for (let s = 0; s < segments.length; s++) {
        if (used[s]) continue;
        used[s] = true;
        let chain = [segments[s][0], segments[s][1]];
        let extend = true;
        while (extend) {
            extend = false;
            const tail = chain[chain.length - 1];
            const neigh = ep.get(key(tail)) || [];
            for (const n of neigh) {
                if (used[n]) continue;
                const seg = segments[n];
                const other = (Math.hypot(seg[0].x - tail.x, seg[0].y - tail.y) < tol ? seg[1] : seg[0]);
                chain.push(other); used[n] = true; extend = true; break;
            }
        }
        out.push(chain);
    }
    return out;
}

// ================= GENERATE =================
function generate() {
    linesGroup.innerHTML = ""; vectorsGroup.innerHTML = ""; chargesGroup.innerHTML = ""; textGroup.innerHTML = "";
    saveState();

    const showVectors = document.getElementById("toggleVectors").checked;
    const showLines = document.getElementById("toggleLines").checked;

    const g = buildGrid();

    // Equipotential lines
    if (showLines) {
        const levels = [];
        for (let k = 0; k < state.NUM_LEVELS; k++) {
            levels.push(state.VMIN + k * (state.VMAX - state.VMIN) / (state.NUM_LEVELS - 1));
        }

        for (const L of levels) {
            const segments = [];
            for (let j = 0; j < NY - 1; j++) {
                for (let i = 0; i < NX - 1; i++) {
                    const x0 = g.xs[i], x1 = g.xs[i + 1], y0 = g.ys[j], y1 = g.ys[j + 1];
                    const v00 = g.grid[j][i], v10 = g.grid[j][i + 1], v01 = g.grid[j + 1][i], v11 = g.grid[j + 1][i + 1];
                    const b0 = v00 > L ? 1 : 0, b1 = v10 > L ? 1 : 0, b2 = v11 > L ? 1 : 0, b3 = v01 > L ? 1 : 0;
                    const idx = b0 | (b1 << 1) | (b2 << 2) | (b3 << 3);
                    if (idx === 0 || idx === 15) continue;
                    const edge = [interp(x0, y0, v00, x1, y0, v10, L),
                                  interp(x1, y0, v10, x1, y1, v11, L),
                                  interp(x1, y1, v11, x0, y1, v01, L),
                                  interp(x0, y1, v01, x0, y0, v00, L)];
                    const cases = EDGE_TABLE[idx]; if (!cases) continue;
                    for (const c of cases) segments.push([edge[c[0]], edge[c[1]]]);
                }
            }
            const contours = stitchSegments(segments);
            for (const poly of contours) {
                const d = poly.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
                linesGroup.appendChild(createSVG("path", { d, fill: "none", stroke: "#444", 'stroke-width': state.equipWidth }));
            }
        }
    }

    // Field vectors
    if (showVectors) {
        let maxMag = 0;
        for (let x = -3; x <= 3; x += state.FIELD_STEP)
            for (let y = -2; y <= 3; y += state.FIELD_STEP) {
                if (state.charges.some(c => Math.hypot(x - c.x, y - c.y) < 0.2)) continue;
                const mag = Math.hypot(eField(x, y).x, eField(x, y).y);
                if (mag > maxMag) maxMag = mag;
            }

        for (let x = -3; x <= 3; x += state.FIELD_STEP)
            for (let y = -2; y <= 3; y += state.FIELD_STEP) {
                if (state.charges.some(c => Math.hypot(x - c.x, y - c.y) < 0.2)) continue;
                const E = eField(x, y); const mag = Math.hypot(E.x, E.y);
                if (mag < 1e-6) continue;
                let scale = state.arrowMax * (mag / maxMag); scale = Math.max(scale, state.lineMin);
                const dx = E.x / mag * scale, dy = E.y / mag * scale;
                vectorsGroup.appendChild(createSVG('line', {
                    x1: x, y1: y, x2: x + dx, y2: y + dy,
                    stroke: "#9a2b17", 'stroke-width': state.vectorWidth, 'marker-end': 'url(#arrow)'
                }));
            }
    }

    // Charges & labels
    state.charges.forEach(c => {
        let r = state.baseChargeSize;
        if (state.scaleCharge) r *= Math.abs(c.q);

        const fillColor = (c === selectedCharge) ? "#cc3b25" : "#9a2b17";
        const circle = createSVG('circle', { cx: c.x, cy: c.y, r, fill: fillColor, cursor: 'grab' });
        chargesGroup.appendChild(circle);

        if (c === selectedCharge) {
            const dot = createSVG('circle', { cx: c.x, cy: c.y, r: 0.02, fill: 'white', class: 'ui-dot' });
            chargesGroup.appendChild(dot);
        }

        if (state.showLabels) {
            const textStrokeEl = createSVG('text', {
                x: c.x + 0.1, y: c.y - 0.1, 'font-size': state.textSize,
                fill: 'none', stroke: 'white', 'stroke-width': state.textStroke
            });
            textStrokeEl.textContent = c.label; textStrokeEl.style.userSelect = 'none'; textGroup.appendChild(textStrokeEl);

            const textFillEl = createSVG('text', {
                x: c.x + 0.1, y: c.y - 0.1, 'font-size': state.textSize,
                fill: '#9a2b17', stroke: 'none'
            });
            textFillEl.textContent = c.label; textFillEl.style.userSelect = 'none'; textGroup.appendChild(textFillEl);
        }

        circle.addEventListener("pointerdown", e => {
            isDragging = true;
            selectedCharge = c;
            document.getElementById("chargeValue").value = c.q;
            generate();
        });
    });
}

// Pointer events
svg.addEventListener("pointermove", e => {
    if (!isDragging || !selectedCharge) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    selectedCharge.x = svgP.x; selectedCharge.y = svgP.y;
    generate();
});
svg.addEventListener("pointerup", e => { isDragging = false; });
svg.addEventListener("pointerdown", e => {
    if (e.target === svg) { selectedCharge = null; generate(); }
});

// UI listeners
function addListeners() {
    document.getElementById("toggleVectors").onchange = generate;
    document.getElementById("toggleLines").onchange = generate;

    document.getElementById("resetApp").onclick = () => { localStorage.removeItem('chargesAppState'); location.reload(); }
    document.getElementById("addCharge").onclick = () => { state.charges.push({ x: 0, y: 0, q: 1, label: "+q" }); generate(); }
    document.getElementById("removeCharge").onclick = () => { if (selectedCharge) { state.charges = state.charges.filter(c => c !== selectedCharge); selectedCharge = null; generate(); } };
    document.getElementById("chargeValue").oninput = () => { if (selectedCharge) { selectedCharge.q = parseFloat(document.getElementById("chargeValue").value); selectedCharge.label = (selectedCharge.q >= 0 ? "+" : "") + selectedCharge.q + "q"; generate(); } };
    document.getElementById("fieldDensity").oninput = e => { state.FIELD_STEP = parseFloat(e.target.value); generate(); }
    document.getElementById("vectorWidth").oninput = e => { state.vectorWidth = parseFloat(e.target.value); generate(); document.getElementById("vectorWidthVal").textContent = state.vectorWidth.toFixed(3); }
    document.getElementById("equipWidth").oninput = e => { state.equipWidth = parseFloat(e.target.value); generate(); document.getElementById("equipWidthVal").textContent = state.equipWidth.toFixed(3); }
    document.getElementById("potMax").onchange = e => { state.VMAX = parseFloat(e.target.value); generate(); }
    document.getElementById("potMin").onchange = e => { state.VMIN = parseFloat(e.target.value); generate(); }
    document.getElementById("equipDensity").onchange = e => { state.NUM_LEVELS = parseInt(e.target.value); generate(); }
    document.getElementById("showLabels").onchange = e => { state.showLabels = e.target.checked; generate(); }
    document.getElementById("scaleCharge").onchange = e => { state.scaleCharge = e.target.checked; generate(); }
    document.getElementById("baseChargeSize").oninput = e => { state.baseChargeSize = parseFloat(e.target.value); generate(); document.getElementById("baseChargeVal").textContent = state.baseChargeSize.toFixed(3); }
    document.getElementById("textSize").oninput = e => { state.textSize = parseFloat(e.target.value); generate(); document.getElementById("textSizeVal").textContent = state.textSize.toFixed(2); }
    document.getElementById("textStroke").oninput = e => { state.textStroke = parseFloat(e.target.value); generate(); document.getElementById("textStrokeVal").textContent = state.textStroke.toFixed(3); }
    document.getElementById("minLength").onchange = e => { state.lineMin = parseFloat(e.target.value); generate(); }
    document.getElementById("maxLength").onchange = e => { state.arrowMax = parseFloat(e.target.value); generate(); }
    document.getElementById("exportSVG").onclick = () => {
        const serializer = new XMLSerializer();
        const svgStr = serializer.serializeToString(svg);
        const blob = new Blob([svgStr], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "efield.svg";
        a.click();
        URL.revokeObjectURL(url);
    };
}

generate();
addListeners();
