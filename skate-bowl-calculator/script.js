const { DEG, toInches, formatInches, formatLong, formatDeg, profile, el, clear, pts, fitter, dim } = BowlGeo;

const $ = id => document.getElementById(id);
let lastResult = null;
let activeRib = null;
let pinnedRib = null;
let iso = null;

document.addEventListener('DOMContentLoaded', () => {
    const form = $('calculator-form');
    const saveUrl = BowlGeo.syncFormWithUrl(form);

    iso = BowlGeo.orbitView($('iso-view'), {
        yaw: -12 * DEG,
        pitch: 32 * DEG,
        extraClass: item => (item.rib && item.rib === activeRib ? 'active' : '')
    });

    const update = () => {
        updateShapeFields();
        calculate();
        saveUrl();
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', e => { e.preventDefault(); update(); });
    ['show-skin', 'show-walls'].forEach(id => $(id).addEventListener('change', () => lastResult && draw3D(lastResult)));
    $('print-btn').addEventListener('click', () => window.print());

    updateShapeFields();
    calculate();
    BowlGeo.setupHighlighting();
});

function updateShapeFields() {
    const torus = $('corner-shape').value === 'torus';
    document.querySelectorAll('.torus-only').forEach(n => n.classList.toggle('hidden', !torus));
}

function readInputs() {
    const num = id => parseFloat($(id).value);
    return {
        R: toInches(num('radius'), $('radius-unit').value),
        H: toInches(num('max-height'), $('height-unit').value),
        cornerDeg: num('corner-angle'),
        shape: $('corner-shape').value,
        coping: toInches(num('coping-radius'), $('coping-unit').value),
        n: parseInt($('num-sections').value, 10),
        spacing: num('rib-spacing'),
        t: num('rib-thickness'),
        depth: num('rib-depth'),
        s: num('support-thickness'),
        endSupports: $('end-supports').value,
        saw: $('saw-setup').value
    };
}

function showError(msg) {
    const box = $('error');
    if (msg) {
        box.textContent = msg;
        box.classList.remove('hidden');
        $('results').classList.add('stale');
    } else {
        box.classList.add('hidden');
        $('results').classList.remove('stale');
    }
}

function validate(i) {
    const bad = (v, min = 0) => !Number.isFinite(v) || v <= min;
    if (bad(i.R)) return 'Enter a transition radius.';
    if (bad(i.H)) return 'Enter a height.';
    if (bad(i.cornerDeg) || i.cornerDeg > 180) return 'Corner angle must be between 1° and 180°.';
    if (!Number.isInteger(i.n) || i.n < 1) return 'Number of sections must be a whole number of at least 1.';
    if (bad(i.spacing)) return 'Rib spacing must be greater than zero.';
    if (bad(i.t)) return 'Rib thickness must be greater than zero.';
    if (bad(i.depth)) return 'Rib depth must be greater than zero.';
    if (!Number.isFinite(i.s) || i.s < 0) return 'Support thickness can’t be negative.';
    if (i.spacing < i.t) return 'Rib spacing is smaller than the rib thickness, so the ribs would overlap.';
    if (i.shape === 'torus' && !(i.coping >= 0)) return 'Enter a coping radius.';
    return null;
}

// Compound-cut angles for a rib whose skin face is sloped at angle a (0 = flat floor, 90° = vertical),
// spanning a bay of angle φ. h = φ/2. The cut plane is the vertical face of the support.
function cutAngles(h, a, saw) {
    if (saw === 'edge') {
        return { miter: Math.atan(Math.tan(h) * Math.cos(a)), bevel: Math.asin(Math.sin(h) * Math.sin(a)) };
    }
    return { miter: Math.atan(Math.tan(h) * Math.sin(a)), bevel: Math.asin(Math.sin(h) * Math.cos(a)) };
}

function calculate() {
    const i = readInputs();
    const err = validate(i);
    if (err) { showError(err); return; }

    const theta = i.cornerDeg * DEG;
    const phi = theta / i.n;
    const h = phi / 2;

    // Tight corner's coping radius (sphere) — the smallest possible with this radius/height.
    const sphereTop = profile(i.R, i.H, 0).topU;
    let r0 = 0;
    if (i.shape === 'torus') {
        $('coping-note').textContent = `Radius of the deck edge, seen from above. Must be at least ${formatInches(sphereTop)} (the tight-corner radius).`;
        if (i.coping < sphereTop - 1e-9) {
            showError(`A ${formatInches(i.coping)} coping radius is tighter than a spherical corner allows with this transition. Use at least ${formatInches(sphereTop)}, or pick the tight corner shape.`);
            return;
        }
        r0 = i.coping - sphereTop;
    }
    const prof = profile(i.R, i.H, r0);

    // Support face offsets from their layout lines
    const oMid = i.s / 2;
    const oEnd = i.endSupports === 'outside' ? 0 : i.s / 2;
    // Bays: [left offset, right offset]
    const bays = [];
    for (let b = 0; b < i.n; b++) {
        bays.push([b === 0 ? oEnd : oMid, b === i.n - 1 ? oEnd : oMid]);
    }
    // Group bays with identical offsets so the cut list shows one column per distinct length
    const groups = [];
    bays.forEach(([o1, o2]) => {
        const key = (o1 + o2).toFixed(6);
        const g = groups.find(g => g.key === key);
        if (g) g.count++; else groups.push({ key, off: o1 + o2, count: 1, end: o1 !== oMid || o2 !== oMid });
    });
    groups.sort((a, b) => a.end - b.end);

    const lengthAt = (u, off) => 2 * u * Math.sin(h) - off * Math.cos(h);
    const minLen = Math.max(1, i.t);

    const ribs = [];
    let truncated = false;
    for (let dft = i.t; dft <= prof.total + 1e-9; dft += i.spacing) {
        const sBottom = prof.total - dft;
        const pb = prof.at(sBottom);
        const pm = prof.at(sBottom + i.t / 2);
        const lengths = groups.map(g => lengthAt(pb.u, g.off));
        if (Math.min(...lengths) < minLen) { truncated = true; break; }
        const ang = cutAngles(h, pm.a, i.saw);
        ribs.push({
            number: ribs.length + 1,
            dft, sBottom,
            u: pb.u, y: pb.y, a: pm.a,
            lengths,
            miter: ang.miter, bevel: ang.bevel
        });
    }

    // Where neighbouring supports run into each other (interior pair)
    const uCollide = i.s > 0 ? (i.s / 2) / Math.tan(h) : 0;
    const needsTrim = i.n > 1 && i.s > 0 && uCollide > r0 + 1e-9;

    // Supports start at the toe (wide corner) or where they'd collide (tight corner)
    const uStart = Math.max(r0, needsTrim ? uCollide : 0);

    const result = {
        uStart, i, theta, phi, h, r0, prof, ribs, groups, truncated, uCollide, needsTrim, oMid, oEnd,
        topChord: 2 * prof.topU * Math.sin(theta / 2),
        supportSpacing: 2 * prof.topU * Math.sin(h),
        facet: prof.topU * (1 - Math.cos(h))
    };
    lastResult = result;

    if (!ribs.length) {
        showError('No ribs fit with these dimensions. Try a smaller rib spacing or thickness.');
        return;
    }
    showError(null);
    displayResults(result);
    drawSide(result);
    drawTop(result);
    draw3D(result);
    drawRibDetail(result, pinnedRib && pinnedRib <= ribs.length ? pinnedRib : Math.ceil(ribs.length / 2));
}

function displayResults(r) {
    const { i, prof } = r;
    $('angle-between-supports').textContent = formatDeg(r.phi);
    $('top-radius').innerHTML = formatLong(prof.topU);
    $('toe-radius').innerHTML = formatLong(r.r0);
    $('top-chord').innerHTML = formatLong(r.topChord);
    $('support-spacing').innerHTML = formatLong(r.supportSpacing);
    $('facet-depth').textContent = formatInches(r.facet);

    if (i.n === 1 || i.s === 0) {
        $('support-trim').textContent = 'None';
        $('support-trim-note').textContent = 'The supports never touch each other.';
    } else if (r.needsTrim) {
        $('support-trim').innerHTML = formatLong(r.uCollide);
        $('support-trim-note').textContent = 'The supports run into each other near the corner center. Stop each one this far out from the center (measured along the support), or end them on a hub block.';
    } else {
        $('support-trim').textContent = 'None';
        $('support-trim-note').textContent = `The supports end at the toe, ${formatInches(r.r0)} from the corner center, before they would touch. Frame the flat bottom inside the toe however you like.`;
    }

    // Header
    const head = $('results-head');
    clear(head);
    const th = (text, cls) => { const e = document.createElement('th'); e.innerHTML = text; if (cls) e.className = cls; head.appendChild(e); };
    th('#');
    th('From top');
    th('Height', 'col-optional');
    r.groups.forEach(g => {
        let label = 'Length';
        if (r.groups.length > 1) label = g.end ? 'End bays' : 'Middle bays';
        th(`${label} <span class="qty">×${g.count}</span>`);
    });
    th('Miter');
    th('Bevel');

    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';
    let stock = 0;
    r.ribs.forEach(rib => {
        const row = document.createElement('tr');
        row.dataset.rib = rib.number;
        const cells = [
            rib.number,
            formatInches(rib.dft),
            `<span class="col-optional-inner">${formatInches(rib.y)}</span>`,
            ...rib.lengths.map(L => `<b>${formatInches(L)}</b>`),
            formatDeg(rib.miter),
            formatDeg(rib.bevel)
        ];
        row.innerHTML = cells.map((c, idx) => `<td${idx === 2 ? ' class="col-optional"' : ''}>${c}</td>`).join('');
        row.addEventListener('mouseenter', () => setActiveRib(rib.number));
        row.addEventListener('mouseleave', () => setActiveRib(pinnedRib));
        row.addEventListener('click', () => {
            pinnedRib = pinnedRib === rib.number ? null : rib.number;
            setActiveRib(pinnedRib ?? rib.number);
        });
        tbody.appendChild(row);
        rib.lengths.forEach((L, gi) => { stock += L * r.groups[gi].count; });
    });

    const ribCount = r.ribs.length * i.n;
    const sawWord = i.saw === 'edge'
        ? 'Stand the rib on its skin face, with the lower face against the fence'
        : 'Lay the rib flat, with its skin edge against the fence';
    let note = `Distances are measured along the curved edge of the support, down from the top, to the lower edge of each rib. Height is the same point measured straight up from the floor. ` +
        `Lengths are short-point measurements along the rib's lower skin-side edge, which lands exactly on the support profile at both ends. ` +
        `${sawWord}. Both ends get the same miter and bevel, mirrored. ` +
        `${ribCount} ribs, about ${(stock / 12).toFixed(0)} linear ft of rib stock before waste.`;
    if (r.truncated) note += ' Ribs stop where they would get too short to fasten. Fill in below that point as you like.';
    $('cut-list-note').textContent = note;
}

function setActiveRib(n) {
    activeRib = n;
    document.querySelectorAll('#results-table tbody tr').forEach(row => {
        row.classList.toggle('active', +row.dataset.rib === n);
        row.classList.toggle('pinned', +row.dataset.rib === pinnedRib);
    });
    document.querySelectorAll('.visualization [data-rib]').forEach(e => {
        e.classList.toggle('active', +e.dataset.rib === n);
    });
    iso && iso.render();
    if (n && lastResult) drawRibDetail(lastResult, n);
}

// ---------- Support profile (side view) ----------
function supportOutline(prof, uStart) {
    // Plywood template in (u, y): floor from uStart, up the profile, back behind the coping and down.
    const back = Math.max(3, prof.R * 0.06);
    const outline = [[uStart, 0]];
    prof.samples(40).forEach(p => { if (p.u >= uStart) outline.push([p.u, p.y]); });
    outline.push([prof.topU + back, prof.H], [prof.topU + back, 0]);
    return outline;
}

function ribSection(prof, rib, t, depth) {
    // Cross-section of a rib in the support plane (u, y)
    const pb = prof.at(rib.sBottom);
    const pt = prof.at(rib.sBottom + t);
    const n = [Math.sin(rib.a), -Math.cos(rib.a)]; // away from the bowl, into the framing
    return [
        [pb.u, pb.y], [pt.u, pt.y],
        [pt.u + n[0] * depth, pt.y + n[1] * depth],
        [pb.u + n[0] * depth, pb.y + n[1] * depth]
    ];
}

function drawSide(r) {
    const svg = $('side-view');
    clear(svg);
    const { prof, i } = r;
    const uStart = r.uStart;
    const outline = supportOutline(prof, uStart);
    const back = outline[outline.length - 1][0];
    const f = fitter([[0, 0], [back + prof.R * 0.08, prof.H], [0, prof.H + prof.R * 0.1], [-prof.R * 0.06, 0]], 220, 200, 14);
    const P = ([u, y]) => f(u, y);

    el('line', { x1: P([-prof.R, 0])[0], y1: P([0, 0])[1], x2: 220, y2: P([0, 0])[1], class: 'ground' }, svg);
    // Corner center axis
    const ax0 = P([0, 0]), ax1 = P([0, prof.H + prof.R * 0.05]);
    el('line', { x1: ax0[0], y1: ax0[1], x2: ax1[0], y2: ax1[1], class: 'axis' }, svg);

    el('polygon', { points: pts(outline.map(P)), class: 'ply' }, svg);
    el('polyline', { points: pts(prof.samples(60).map(p => P([p.u, p.y]))), class: 'surface' }, svg);

    // Ribs
    const g = el('g', { class: 'ribs' }, svg);
    r.ribs.forEach(rib => {
        el('polygon', { points: pts(ribSection(prof, rib, i.t, i.depth).map(P)), class: 'rib', 'data-rib': rib.number }, g);
    });

    // Radius
    const c = P([r.r0, prof.R]);
    const mid = prof.at(Math.min(prof.arcLen, prof.total) * 0.55);
    dim(svg, c, P([mid.u, mid.y]), 'R', 'dim-radius', 6);
    // Height
    const hx = back + prof.R * 0.05;
    dim(svg, P([hx, 0]), P([hx, prof.H]), 'H', 'dim-height', 7);
    // Coping radius
    const ty = prof.H + prof.R * 0.05;
    dim(svg, P([0, ty]), P([prof.topU, ty]), formatInches(prof.topU), 'dim-top-radius', -6);
    // Toe radius
    if (r.r0 > 0) dim(svg, P([0, -prof.R * 0.0]), P([r.r0, 0]), '', 'dim-toe', 0);
    // Trim
    if (r.needsTrim) {
        const tp = P([r.uCollide, 0]);
        el('circle', { cx: tp[0], cy: tp[1], r: 2.5, class: 'trim-mark' }, svg);
    }
}

// ---------- Top view ----------
function boundaryDirs(psi, side) {
    const radial = [Math.sin(psi), Math.cos(psi)];
    const tangent = [side * Math.cos(psi), -side * Math.sin(psi)];
    return { radial, tangent };
}

function drawTop(r) {
    const svg = $('top-view');
    clear(svg);
    const { prof, i, theta, phi } = r;
    const halfT = theta / 2;
    const XY = (u, psi) => [u * Math.sin(psi), u * Math.cos(psi)];
    const wallLen = prof.topU * 0.45;
    const back = prof.topU + Math.max(3, prof.R * 0.06);
    const uStart = r.uStart;

    // Bounds
    const bound = [[0, 0]];
    [-1, 1].forEach(side => {
        const psi = side * halfT;
        const { tangent } = boundaryDirs(psi, side);
        const c = XY(prof.topU, psi);
        bound.push(c, [c[0] + tangent[0] * wallLen, c[1] + tangent[1] * wallLen]);
    });
    for (let k = 0; k <= 16; k++) bound.push(XY(back, -halfT + theta * k / 16));
    const f = fitter(bound, 220, 200, 12);
    const P = ([x, y]) => f(x, y);
    const arc = (u, a0, a1, cls, steps = 48) => {
        const list = [];
        for (let k = 0; k <= steps; k++) list.push(P(XY(u, a0 + (a1 - a0) * k / steps)));
        return el('polyline', { points: pts(list), class: cls }, svg);
    };

    // Straight walls continuing out of the corner
    [-1, 1].forEach(side => {
        const psi = side * halfT;
        const { tangent } = boundaryDirs(psi, side);
        [prof.topU, r.r0].forEach((u, k) => {
            if (u === 0 && k === 1) return;
            const a = XY(u, psi), b = [a[0] + tangent[0] * wallLen, a[1] + tangent[1] * wallLen];
            el('line', { x1: P(a)[0], y1: P(a)[1], x2: P(b)[0], y2: P(b)[1], class: k === 0 ? 'wall-edge' : 'toe-line' }, svg);
        });
    });

    // Supports
    const sg = el('g', { class: 'supports' }, svg);
    for (let k = 0; k <= i.n; k++) {
        const psi = -halfT + k * phi;
        const a = P(XY(uStart, psi)), b = P(XY(back, psi));
        el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'support' }, sg);
    }

    // Ribs as straight chords in each bay — shows the faceting
    const rg = el('g', { class: 'ribs' }, svg);
    r.ribs.forEach(rib => {
        const list = [];
        for (let k = 0; k <= i.n; k++) list.push(P(XY(rib.u, -halfT + k * phi)));
        el('polyline', { points: pts(list), class: 'rib-line', 'data-rib': rib.number }, rg);
    });

    // Coping & toe
    arc(prof.topU, -halfT, halfT, 'coping');
    if (r.r0 > 0) arc(r.r0, -halfT, halfT, 'toe-line');

    // Chord
    const c1 = P(XY(prof.topU, -halfT)), c2 = P(XY(prof.topU, halfT));
    el('line', { x1: c1[0], y1: c1[1], x2: c2[0], y2: c2[1], class: 'chord' }, svg);

    // Coping radius
    const rr = P(XY(prof.topU, 0));
    el('line', { x1: P([0, 0])[0], y1: P([0, 0])[1], x2: rr[0], y2: rr[1], class: 'top-radius-line' }, svg);

    // Corner angle
    const angR = Math.min(prof.topU * 0.22, 26 / f.scale);
    arc(angR, -halfT, halfT, 'angle-arc', 24);
    const lab = P(XY(angR * 1.6, 0));
    el('text', { x: lab[0] + 4, y: lab[1] + 3, class: 'angle-label', text: `${i.cornerDeg}°` }, svg);
    const o = P([0, 0]);
    el('circle', { cx: o[0], cy: o[1], r: 2.2, class: 'center-dot' }, svg);
}

// ---------- 3D view ----------
function draw3D(r) {
    const { prof, i, theta, phi } = r;
    const halfT = theta / 2;
    const W = (u, y, psi) => [u * Math.sin(psi), y, u * Math.cos(psi)];
    const scene = [];
    const uStart = r.uStart;
    const samples = prof.samples(18);
    const showSkin = $('show-skin').checked;
    const showWalls = $('show-walls').checked;
    const wallLen = prof.topU * 0.45;

    // Floor
    const floor = [];
    const toeU = r.r0;
    const wallEnds = [-1, 1].map(side => {
        const psi = side * halfT;
        const { radial, tangent } = boundaryDirs(psi, side);
        const t0 = [toeU * radial[0], toeU * radial[1]];
        const e = [t0[0] + tangent[0] * wallLen, t0[1] + tangent[1] * wallLen];
        const inward = [e[0] - radial[0] * wallLen * 1.2, e[1] - radial[1] * wallLen * 1.2];
        return { e, inward };
    });
    floor.push([wallEnds[0].inward[0], 0, wallEnds[0].inward[1]], [wallEnds[0].e[0], 0, wallEnds[0].e[1]]);
    for (let k = 0; k <= 16; k++) floor.push(W(toeU, 0, -halfT + theta * k / 16));
    floor.push([wallEnds[1].e[0], 0, wallEnds[1].e[1]], [wallEnds[1].inward[0], 0, wallEnds[1].inward[1]]);
    scene.push({ type: 'poly', pts: floor, cls: 'floor3d', bias: 10 });

    // Supports (plywood templates)
    const outline = supportOutline(prof, uStart);
    for (let k = 0; k <= i.n; k++) {
        const psi = -halfT + k * phi;
        scene.push({ type: 'poly', pts: outline.map(([u, y]) => W(u, y, psi)), cls: 'ply3d', shade: [38, 45, 35, 72] });
    }

    // Ribs (as the skin-side edge, straight across each bay)
    r.ribs.forEach(rib => {
        for (let k = 0; k < i.n; k++) {
            scene.push({
                type: 'line', cls: 'rib3d', rib: rib.number,
                pts: [W(rib.u, rib.y, -halfT + k * phi), W(rib.u, rib.y, -halfT + (k + 1) * phi)],
                bias: -0.01
            });
        }
    });

    // Skin: flat facets between supports
    if (showSkin) {
        for (let k = 0; k < i.n; k++) {
            const a = -halfT + k * phi, b = a + phi;
            for (let j = 0; j < samples.length - 1; j++) {
                const p = samples[j], q = samples[j + 1];
                scene.push({ type: 'poly', cls: 'skin3d', shade: [205, 35, 30, 78], pts: [W(p.u, p.y, a), W(q.u, q.y, a), W(q.u, q.y, b), W(p.u, p.y, b)], bias: -0.02 });
            }
        }
    }

    // Straight walls continuing out of the corner
    if (showWalls) {
        [-1, 1].forEach(side => {
            const psi = side * halfT;
            const { tangent } = boundaryDirs(psi, side);
            for (let j = 0; j < samples.length - 1; j++) {
                const p = samples[j], q = samples[j + 1];
                const a = W(p.u, p.y, psi), b = W(q.u, q.y, psi);
                const off = v => [v[0] + tangent[0] * wallLen, v[1], v[2] + tangent[1] * wallLen];
                scene.push({ type: 'poly', cls: 'wall3d', shade: [205, 15, 30, 70], pts: [a, b, off(b), off(a)] });
            }
            const top = W(prof.topU, prof.H, psi);
            scene.push({ type: 'line', cls: 'coping3d', pts: [top, [top[0] + tangent[0] * wallLen, top[1], top[2] + tangent[1] * wallLen]], bias: -0.05 });
        });
    }

    // Coping line across the corner
    const coping = [];
    for (let k = 0; k <= i.n; k++) coping.push(W(prof.topU, prof.H, -halfT + k * phi));
    for (let k = 0; k < i.n; k++) scene.push({ type: 'line', cls: 'coping3d', pts: [coping[k], coping[k + 1]], bias: -0.05 });

    iso.setScene(scene);
}

// ---------- Rib detail ----------
function drawRibDetail(r, n) {
    const rib = r.ribs[n - 1];
    if (!rib) return;
    const svg = $('rib-detail');
    clear(svg);
    const { i, h } = r;
    const flat = i.saw !== 'edge';
    const visW = flat ? i.depth : i.t; // width of the face lying on the saw table
    // How much closer to the corner center the far edge of the table face is than the reference edge.
    // Negative: the far edge is further out, so it is longer. The reference edge is always the short point.
    const shift = flat ? -i.depth * Math.sin(rib.a) : -i.t * Math.cos(rib.a);
    const ref = rib.lengths[0];
    const far = ref - 2 * shift * Math.tan(h);

    // Schematic: true angles, exaggerated width
    const Lpx = 230, Wpx = 46;
    const dx = Wpx * Math.tan(rib.miter) * Math.sign(shift || 1);
    const x0 = (320 - Lpx) / 2, yFence = 112, yFar = yFence - Wpx;
    const board = [[x0, yFence], [x0 + Lpx, yFence], [x0 + Lpx - dx, yFar], [x0 + dx, yFar]];
    el('line', { x1: 8, y1: yFence + 2, x2: 312, y2: yFence + 2, class: 'fence' }, svg);
    el('text', { x: 312, y: yFence + 14, class: 'detail-label', 'text-anchor': 'end', text: 'fence' }, svg);
    el('polygon', { points: pts(board), class: 'board' }, svg);
    el('line', { x1: x0, y1: yFence, x2: x0 + Lpx, y2: yFence, class: 'ref-edge' }, svg);
    el('text', { x: 160, y: yFence + 14, class: 'detail-label strong', 'text-anchor': 'middle', text: `${formatInches(ref)} measured here` }, svg);
    el('text', { x: 160, y: yFar - 6, class: 'detail-label', 'text-anchor': 'middle', text: `${formatInches(far)} on the far edge` }, svg);
    // Square reference + miter angle at left end
    el('line', { x1: x0, y1: yFence, x2: x0, y2: yFar - 8, class: 'square-ref' }, svg);
    el('text', { x: x0 + 4, y: yFar - 12, class: 'detail-label', 'text-anchor': 'start', text: `miter ${formatDeg(rib.miter)}` }, svg);
    el('text', { x: 160, y: 22, class: 'detail-label', 'text-anchor': 'middle', text: `blade tilted ${formatDeg(rib.bevel)} (bevel)` }, svg);
    el('text', { x: 160, y: 36, class: 'detail-label subtle', 'text-anchor': 'middle', text: 'not to scale · angles true' }, svg);

    $('rib-detail-title').textContent = `#${rib.number}`;
    const lens = r.groups.map((g, gi) => `${r.groups.length > 1 ? (g.end ? 'end bays' : 'middle bays') + ' ' : ''}${formatInches(rib.lengths[gi])} ×${g.count}`).join(', ');
    $('rib-detail-text').textContent =
        `Rib ${rib.number} sits ${formatInches(rib.dft)} down the curve (${formatInches(rib.y)} off the floor), with its skin face sloped ${formatDeg(rib.a, 0)}. ` +
        `Cut ${lens}. ${flat ? 'Lay it flat on the saw with the skin edge against the fence.' : 'Stand it on its skin face with the lower face against the fence.'} ` +
        `Miter ${formatDeg(rib.miter)}, bevel ${formatDeg(rib.bevel)}. Cut the other end mirrored.`;
}
