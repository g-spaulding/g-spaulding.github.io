// Shared geometry + drawing helpers for the bowl calculators.
//
// Coordinate conventions
// ----------------------
// The corner is built around a vertical axis through the "corner center" on the floor.
// Every support (plywood template) lies in a vertical plane through that axis.
// Within a support's plane we use (u, y):
//   u = horizontal distance from the axis, y = height above the floor.
// The transition profile is a circle of radius R tangent to the floor at u = r0:
//   u = r0 + R·sin(a),  y = R·(1 − cos a)      (a = 0 at the toe, π/2 at vertical)
// r0 = 0 gives a sphere (all supports meet at one point on the floor);
// r0 > 0 sweeps the circle around the axis and gives a torus (a "wide" corner
// with a curved flat-bottom toe of radius r0).
// Anything above y = R is vert: u stays at r0 + R.
//
// 3D world: x = u·sin(ψ), z = u·cos(ψ), y up. ψ = 0 is the corner's centerline.

const BowlGeo = (() => {
    const DEG = Math.PI / 180;

    function toInches(value, unit) {
        return unit === 'ft' ? value * 12 : value;
    }

    // Round to the nearest 1/16" and format as  34-5/16"
    function formatInches(inches) {
        const neg = inches < 0;
        const sixteenths = Math.round(Math.abs(inches) * 16);
        const whole = Math.floor(sixteenths / 16);
        let num = sixteenths % 16;
        let den = 16;
        while (num && num % 2 === 0) { num /= 2; den /= 2; }
        let s = num === 0 ? `${whole}` : (whole === 0 ? `${num}/${den}` : `${whole}-${num}/${den}`);
        return (neg && sixteenths ? '−' : '') + s + '"';
    }

    // Same, but adds a feet-inches form for long values: 8' 4-1/2" (100-1/2")
    function formatLong(inches) {
        if (inches < 24) return formatInches(inches);
        const sixteenths = Math.round(inches * 16);
        const feet = Math.floor(sixteenths / (16 * 12));
        const rest = (sixteenths - feet * 16 * 12) / 16;
        return `${feet}' ${formatInches(rest)} <span class="alt-units">(${formatInches(inches)})</span>`;
    }

    function formatDeg(rad, digits = 1) {
        return (rad / DEG).toFixed(digits) + '°';
    }

    // Transition profile: radius R, total height H (H > R adds vert), toe offset r0.
    function profile(R, H, r0 = 0) {
        const arcHeight = Math.min(H, R);
        const alphaTop = Math.acos(1 - arcHeight / R);
        const vert = Math.max(0, H - R);
        const arcLen = R * alphaTop;
        const total = arcLen + vert;
        const topU = r0 + R * Math.sin(alphaTop);

        // Point at arc length s measured along the surface from the toe.
        function at(s) {
            s = Math.max(0, Math.min(total, s));
            if (s <= arcLen) {
                const a = s / R;
                return { u: r0 + R * Math.sin(a), y: R * (1 - Math.cos(a)), a };
            }
            return { u: r0 + R, y: R + (s - arcLen), a: Math.PI / 2 };
        }

        // Height → arc length from toe
        function sAtHeight(y) {
            if (y <= R) return R * Math.acos(1 - Math.max(0, y) / R);
            return arcLen + (y - R);
        }

        function samples(n = 48) {
            const pts = [];
            for (let i = 0; i <= n; i++) pts.push(at(total * i / n));
            // make sure the arc/vert junction is included exactly
            if (vert > 0) { pts.push(at(arcLen)); pts.sort((p, q) => p.y - q.y); }
            return pts;
        }

        return { R, H, r0, alphaTop, vert, arcLen, total, topU, at, sAtHeight, samples };
    }

    // ---------- SVG helpers ----------
    const NS = 'http://www.w3.org/2000/svg';

    function el(tag, attrs = {}, parent) {
        const e = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null) continue;
            if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
        }
        if (parent) parent.appendChild(e);
        return e;
    }

    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

    function pts(list) { return list.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' '); }

    // Fit a set of world-space 2D points into a viewBox, y up.
    function fitter(points, vbW, vbH, pad) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        points.forEach(([x, y]) => {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        });
        const w = Math.max(maxX - minX, 1e-6), h = Math.max(maxY - minY, 1e-6);
        const scale = Math.min((vbW - 2 * pad) / w, (vbH - 2 * pad) / h);
        const ox = (vbW - w * scale) / 2 - minX * scale;
        const oy = (vbH + h * scale) / 2 + minY * scale;
        const f = (x, y) => [ox + x * scale, oy - y * scale];
        f.scale = scale;
        return f;
    }

    // Arrow-less dimension line with a label
    function dim(parent, a, b, label, cls, offset = 0, labelPos = 'mid') {
        const g = el('g', { class: cls }, parent);
        el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'dim' }, g);
        [a, b].forEach(p => el('circle', { cx: p[0], cy: p[1], r: 1.4, class: 'dim-end' }, g));
        if (label) {
            const t = labelPos === 'mid' ? 0.5 : labelPos;
            const lx = a[0] + (b[0] - a[0]) * t, ly = a[1] + (b[1] - a[1]) * t;
            const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
            // offset perpendicular to the line
            const nx = -dy / len * offset, ny = dx / len * offset;
            el('text', { x: lx + nx, y: ly + ny + 3, class: 'dim-label', 'text-anchor': 'middle', text: label }, g);
        }
        return g;
    }

    // ---------- Simple orbit-able 3D renderer (painter's algorithm) ----------
    // scene: array of { type: 'poly'|'line', pts: [[x,y,z],...], cls, bias }
    function orbitView(svg, opts = {}) {
        const vb = svg.viewBox.baseVal;
        const W = vb.width, H = vb.height;
        let yaw = opts.yaw ?? -25 * DEG;
        let pitch = opts.pitch ?? 28 * DEG;
        let zoom = 1;
        let scene = [];
        let center = [0, 0, 0];
        let radius = 1;
        const root = el('g', {}, svg);

        function project([x, y, z]) {
            x -= center[0]; y -= center[1]; z -= center[2];
            const cx = x * Math.cos(yaw) - z * Math.sin(yaw);
            const cz = x * Math.sin(yaw) + z * Math.cos(yaw);
            const up = y * Math.cos(pitch) + cz * Math.sin(pitch);
            const depth = cz * Math.cos(pitch) - y * Math.sin(pitch);
            const s = zoom * (Math.min(W, H) * 0.47) / radius;
            return [W / 2 + cx * s, H / 2 - up * s, depth];
        }

        // Simple Lambert shading with a light fixed in world space (above, slightly in front)
        const light = (() => { const v = [0.35, 1, -0.6]; const l = Math.hypot(...v); return v.map(c => c / l); })();
        function shadeColor(item) {
            const [a, b, c] = item.pts;
            const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            const len = Math.hypot(...n) || 1;
            const k = Math.abs(n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / len;
            const [hue, sat, lo, hi] = item.shade;
            return `hsl(${hue} ${sat}% ${(lo + (hi - lo) * k).toFixed(1)}%)`;
        }

        function render() {
            clear(root);
            const items = scene.map(item => {
                const p = item.pts.map(project);
                const depth = p.reduce((a, q) => a + q[2], 0) / p.length + (item.bias || 0) * radius;
                return { item, p, depth };
            });
            items.sort((a, b) => b.depth - a.depth);
            items.forEach(({ item, p }) => {
                const extra = opts.extraClass ? opts.extraClass(item) : '';
                const attrs = { class: extra ? `${item.cls} ${extra}` : item.cls };
                if (item.data) Object.assign(attrs, item.data);
                if (item.type === 'poly') {
                    attrs.points = pts(p);
                    if (item.shade) attrs.style = `fill: ${shadeColor(item)}`;
                    el('polygon', attrs, root);
                } else {
                    attrs.points = pts(p);
                    el('polyline', attrs, root);
                }
            });
        }

        function setScene(newScene) {
            scene = newScene;
            // bounding sphere so rotating doesn't change the zoom
            let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
            scene.forEach(it => it.pts.forEach(p => {
                for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
            }));
            center = min.map((v, i) => (v + max[i]) / 2);
            radius = 0;
            scene.forEach(it => it.pts.forEach(p => {
                radius = Math.max(radius, Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]));
            }));
            radius = radius || 1;
            render();
        }

        // Drag to orbit
        let drag = null;
        svg.style.touchAction = 'none';
        svg.addEventListener('pointerdown', e => {
            drag = { x: e.clientX, y: e.clientY, yaw, pitch };
            svg.setPointerCapture(e.pointerId);
            svg.classList.add('dragging');
        });
        svg.addEventListener('pointermove', e => {
            if (!drag) return;
            yaw = drag.yaw - (e.clientX - drag.x) * 0.01;
            pitch = Math.max(-5 * DEG, Math.min(89 * DEG, drag.pitch + (e.clientY - drag.y) * 0.01));
            render();
        });
        const end = () => { drag = null; svg.classList.remove('dragging'); };
        svg.addEventListener('pointerup', end);
        svg.addEventListener('pointercancel', end);
        svg.addEventListener('wheel', e => {
            e.preventDefault();
            zoom = Math.max(0.5, Math.min(4, zoom * Math.exp(-e.deltaY * 0.001)));
            render();
        }, { passive: false });
        svg.addEventListener('dblclick', () => {
            yaw = opts.yaw ?? -25 * DEG; pitch = opts.pitch ?? 28 * DEG; zoom = 1; render();
        });

        return { setScene, render };
    }

    // ---------- Form state <-> URL ----------
    function syncFormWithUrl(form) {
        const params = new URLSearchParams(location.search);
        form.querySelectorAll('input[id], select[id]').forEach(input => {
            if (params.has(input.id)) {
                if (input.type === 'checkbox') input.checked = params.get(input.id) === '1';
                else input.value = params.get(input.id);
            }
        });
        return function save() {
            const p = new URLSearchParams();
            form.querySelectorAll('input[id], select[id]').forEach(input => {
                p.set(input.id, input.type === 'checkbox' ? (input.checked ? '1' : '0') : input.value);
            });
            history.replaceState(null, '', '?' + p.toString());
        };
    }

    // Hovering anything with data-highlight="foo" adds .highlight-foo to every .viz svg
    function setupHighlighting(root = document) {
        root.querySelectorAll('[data-highlight]').forEach(node => {
            if (node.dataset.hlBound) return;
            node.dataset.hlBound = '1';
            const cls = 'highlight-' + node.dataset.highlight;
            node.addEventListener('mouseenter', () => document.querySelectorAll('.visualization svg').forEach(s => s.classList.add(cls)));
            node.addEventListener('mouseleave', () => document.querySelectorAll('.visualization svg').forEach(s => s.classList.remove(cls)));
        });
    }

    return { DEG, toInches, formatInches, formatLong, formatDeg, profile, el, clear, pts, fitter, dim, orbitView, syncFormWithUrl, setupHighlighting };
})();
