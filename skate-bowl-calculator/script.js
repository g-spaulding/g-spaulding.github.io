const { DEG, toInches, formatInches, formatLong, formatDeg, profile, el, clear, pts, fitter, dim } = BowlGeo;

const $ = id => document.getElementById(id);
let lastResult = null;
let activeRib = null;
let pinnedRib = null;
let iso = null;
let isoFull = null;
let fsOpen = false;

document.addEventListener('DOMContentLoaded', () => {
    const form = $('calculator-form');
    const saveUrl = BowlGeo.syncFormWithUrl(form);

    const extraClass = item => (item.rib && item.rib === activeRib ? 'active' : '');
    iso = BowlGeo.orbitView($('iso-view'), {
        yaw: -12 * DEG,
        pitch: 32 * DEG,
        extraClass,
        onClick: () => openFullscreen()
    });
    isoFull = BowlGeo.orbitView($('fs-view'), {
        yaw: -12 * DEG,
        pitch: 32 * DEG,
        extraClass,
        onHover: showPartInfo,
        onClick: item => {
            if (item && item.info && item.info.kind === 'rib') {
                pinnedRib = pinnedRib === item.rib ? null : item.rib;
                setActiveRib(item.rib);
            }
        }
    });
    setupFullscreen();

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
        saw: $('saw-setup').value,
        curved: $('rib-style').value === 'curved'
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
    const bayGroup = bays.map(([o1, o2]) => groups.findIndex(g => g.key === (o1 + o2).toFixed(6)));

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
        // Cup radius: distance along the skin normal to the corner axis (R for a sphere)
        const cupR = r0 > 0 ? i.R + r0 / Math.max(Math.sin(pm.a), 1e-9) : i.R;
        const halfL = Math.max(...lengths) / 2;
        const cupDepth = cupR - Math.sqrt(Math.max(0, cupR * cupR - halfL * halfL));
        ribs.push({
            cupR, cupDepth,
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
        uStart, bayGroup, i, theta, phi, h, r0, prof, ribs, groups, truncated, uCollide, needsTrim, oMid, oEnd,
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
    if (i.curved) {
        $('facet-depth').textContent = 'None';
        $('facet-note').textContent = `The ribs are cupped to the surface, so the skin follows the true curve. (Straight ribs would leave up to ${formatInches(r.facet)} at the middle of each bay at the coping.)`;
    } else {
        $('facet-depth').textContent = formatInches(r.facet);
        $('facet-note').textContent = 'The deepest gap between a straight rib and the true round surface, at the middle of each bay at the coping. Add sections or cup the ribs to shrink it.';
    }
    $('cup-radius').innerHTML = formatLong(i.R);
    document.querySelectorAll('.cup-sphere-only').forEach(n => n.classList.toggle('hidden', !(i.curved && r.r0 === 0)));

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
    if (i.curved && r.r0 > 0) th('Cup radius');
    if (i.curved) th('Cup depth');

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
            formatDeg(rib.bevel),
            ...(i.curved && r.r0 > 0 ? [formatInches(rib.cupR)] : []),
            ...(i.curved ? [formatInches(rib.cupDepth)] : [])
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
        ? 'Stand the rib on its skin face, with the lower face toward you'
        : 'Lay the rib flat, with its skin edge toward you';
    let note = `Distances are measured along the curved edge of the support, down from the top, to the lower edge of each rib. Height is the same point measured straight up from the floor. ` +
        `Lengths are short-point measurements along the rib's lower skin-side edge, which lands exactly on the support profile at both ends. ` +
        `${sawWord}. Both ends get the same miter and bevel, mirrored. ` +
        `${ribCount} ribs, about ${(stock / 12).toFixed(0)} linear ft of rib stock before waste.`;
    if (i.curved) {
        note += ` Cut each rib straight first and check the fit, then cup out the middle of the skin face to the cup radius. Cup depth is how much to remove at the center; the ends stay put.`;
        const maxCup = Math.max(...r.ribs.map(x => x.cupDepth));
        if (maxCup > i.depth / 2) note += ` The deepest cup (${formatInches(maxCup)}) is more than half the rib depth, so consider deeper stock or more bays.`;
    }
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
    fsOpen && isoFull.render();
    if (n && lastResult) drawRibDetail(lastResult, n);
}

// ---------- Support profile (side view) ----------
// The support's curved edge in (u, y), starting exactly where the support starts
function supportProfile(prof, uStart, n = 40) {
    const aStart = Math.asin(Math.max(0, Math.min(1, (uStart - prof.r0) / prof.R)));
    const sStart = prof.R * aStart;
    const list = [];
    for (let k = 0; k <= n; k++) {
        const p = prof.at(sStart + (prof.total - sStart) * k / n);
        list.push([p.u, p.y]);
    }
    if (prof.vert > 0 && sStart < prof.arcLen) {
        const j = prof.at(prof.arcLen);
        list.push([j.u, j.y]);
        list.sort((a, b) => a[1] - b[1]);
    }
    return list;
}

function supportBack(prof) {
    return prof.topU + Math.max(3, prof.R * 0.06);
}

function supportOutline(prof, uStart) {
    // Plywood template in (u, y): floor from uStart, up the profile, back behind the coping and down.
    const back = supportBack(prof);
    const outline = [[uStart, 0], ...supportProfile(prof, uStart)];
    outline.push([back, prof.H], [back, 0]);
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

    // Ribs: straight chords in each bay (shows the faceting), or arcs when cupped
    const rg = el('g', { class: 'ribs' }, svg);
    const sub = i.curved ? 8 : 1;
    r.ribs.forEach(rib => {
        const list = [];
        for (let k = 0; k <= i.n * sub; k++) list.push(P(XY(rib.u, -halfT + k * phi / sub)));
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

    // Supports (plywood slabs) and ribs (solid lumber)
    for (let k = 0; k <= i.n; k++) scene.push(...supportSolid(r, k));
    const sub = i.curved ? Math.max(2, Math.ceil(phi / (4 * DEG))) : 1;
    r.ribs.forEach(rib => {
        for (let k = 0; k < i.n; k++) scene.push(...ribSolid(r, rib, k));
    });

    // Skin: flat facets between supports, or the true curved surface when ribs are cupped
    if (showSkin) {
        for (let k = 0; k < i.n * sub; k++) {
            const a = -halfT + k * phi / sub, b = a + phi / sub;
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

    // Coping across the corner (bent to the deck radius), one piece per bay so it can be hovered
    for (let k = 0; k < i.n; k++) {
        const list = [];
        for (let m = 0; m <= 8; m++) list.push(W(prof.topU, prof.H, -halfT + (k + m / 8) * phi));
        scene.push({ type: 'line', cls: 'coping3d', pts: list, bias: -0.05, info: { kind: 'coping', k } });
    }

    iso.setScene(scene);
    isoFull.setScene(scene);
}

// ---------- Rib detail ----------
function drawRibDetail(r, n) {
    const rib = r.ribs[n - 1];
    if (!rib) return;
    const svg = $('rib-detail');
    clear(svg);
    const { i } = r;
    const flat = i.saw !== 'edge';
    drawRibOnSaw(svg, r, rib, flat);

    $('rib-detail-title').textContent = `#${rib.number}`;
    const lens = r.groups.map((g, gi) => `${r.groups.length > 1 ? (g.end ? 'end bays' : 'middle bays') + ' ' : ''}${formatInches(rib.lengths[gi])} ×${g.count}`).join(', ');
    $('rib-detail-text').textContent =
        `Rib ${rib.number} sits ${formatInches(rib.dft)} down the curve (${formatInches(rib.y)} off the floor), with its skin face sloped ${formatDeg(rib.a, 0)}. ` +
        `Cut ${lens}. ${flat ? 'Lay it flat on the saw with the skin edge toward you.' : 'Stand it on its skin face with the lower face toward you.'} ` +
        `Miter ${formatDeg(rib.miter)}, bevel ${formatDeg(rib.bevel)}. Cut the other end mirrored.` +
        (i.curved ? ` Then cup the skin face to a ${formatInches(rib.cupR)} radius, ${formatInches(rib.cupDepth)} deep at the center.` : '');
}

// ---------- Full-screen 3D view with per-part measurements ----------
function setupFullscreen() {
    $('expand-3d').addEventListener('click', openFullscreen);
    $('fs-close').addEventListener('click', closeFullscreen);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && fsOpen) closeFullscreen(); });
    window.addEventListener('resize', () => fsOpen && fitFullscreen());
    // Mirror the skin/walls toggles
    [['fs-show-skin', 'show-skin'], ['fs-show-walls', 'show-walls']].forEach(([fsId, id]) => {
        $(fsId).addEventListener('change', () => {
            $(id).checked = $(fsId).checked;
            $(id).dispatchEvent(new Event('change'));
        });
    });
}

function fitFullscreen() {
    const svg = $('fs-view');
    const { width, height } = svg.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${Math.max(1, Math.round(width))} ${Math.max(1, Math.round(height))}`);
    isoFull.render();
}

function openFullscreen() {
    if (!lastResult || fsOpen) return;
    fsOpen = true;
    $('fs-show-skin').checked = $('show-skin').checked;
    $('fs-show-walls').checked = $('show-walls').checked;
    $('fs').classList.remove('hidden');
    document.body.classList.add('fs-locked');
    fitFullscreen();
    isoFull.setView(iso.getView());
    $('fs-close').focus();
}

function closeFullscreen() {
    fsOpen = false;
    $('fs').classList.add('hidden');
    document.body.classList.remove('fs-locked');
    showPartInfo(null);
    iso.setView(isoFull.getView());
    $('expand-3d').focus();
}

function describePart(info) {
    const r = lastResult;
    const { i, prof, phi, theta } = r;
    const rows = [];
    let title = '';
    if (info.kind === 'rib') {
        const rib = info.rib;
        const gi = r.bayGroup[info.k];
        const g = r.groups[gi];
        const bayName = r.groups.length > 1 ? (g.end ? 'end bay' : 'middle bay') : 'bay';
        title = `Rib #${rib.number} · ${bayName} ${info.k + 1} of ${i.n}`;
        rows.push(['Length', `<b>${formatInches(rib.lengths[gi])}</b> short point`]);
        rows.push(['Miter', formatDeg(rib.miter)], ['Bevel', formatDeg(rib.bevel)]);
        if (i.curved) rows.push(['Cup radius', formatLong(rib.cupR)], ['Cup depth', formatInches(rib.cupDepth)]);
        rows.push(['From top', `${formatInches(rib.dft)} along the curve`], ['Height', `${formatInches(rib.y)} off the floor`]);
        rows.push(['Skin slope', formatDeg(rib.a, 0)]);
        rows.push(['Cut', `${g.count} like this per row`]);
    } else if (info.kind === 'support') {
        const k = info.k;
        const end = k === 0 || k === i.n;
        const psi = (-theta / 2 + k * phi) / DEG;
        title = `Support ${k + 1} of ${i.n + 1}${end ? ' · outermost' : ''}`;
        rows.push(['Position', Math.abs(psi) < 0.05 ? 'on the centerline' : `${Math.abs(psi).toFixed(1)}° ${psi < 0 ? 'left' : 'right'} of center`]);
        rows.push(['Profile', `${formatLong(prof.R)} radius${prof.vert > 0 ? ` + ${formatInches(prof.vert)} vert` : ''}`]);
        rows.push(['Height', formatLong(prof.H)]);
        rows.push(['Starts', `${formatInches(r.uStart)} from corner center`]);
        rows.push(['Coping at', `${formatLong(prof.topU)} from corner center`]);
        if (end) rows.push(['Placement', i.endSupports === 'outside' ? 'face on the corner line' : 'centered on the corner line']);
        else rows.push(['Placement', 'centered on its layout line']);
        rows.push(['Rib marks', `${r.ribs.length}, first ${formatInches(i.t)} down, then every ${formatInches(i.spacing)} along the curve`]);
    } else if (info.kind === 'coping') {
        title = `Coping · bay ${info.k + 1} of ${i.n}`;
        rows.push(['Coping radius', formatLong(prof.topU)]);
        rows.push(['This bay', `${formatInches(prof.topU * phi)} along the curve`]);
        rows.push(['Support to support', `${formatInches(r.supportSpacing)} straight`]);
        rows.push(['Whole corner', `${formatLong(prof.topU * theta)} of coping`]);
        rows.push(['Corner chord', formatLong(r.topChord)]);
    }
    return `<div class="fs-tip-title">${title}</div><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function showPartInfo(item, e) {
    const tip = $('fs-tip');
    if (!item || !lastResult) {
        tip.classList.add('hidden');
        if (fsOpen) setActiveRib(pinnedRib);
        return;
    }
    tip.innerHTML = describePart(item.info);
    tip.classList.remove('hidden');
    if (item.info.kind === 'rib' && activeRib !== item.rib) setActiveRib(item.rib);
    if (item.info.kind !== 'rib' && activeRib !== pinnedRib) setActiveRib(pinnedRib);
    if (e) {
        const pad = 16;
        const w = tip.offsetWidth, h = tip.offsetHeight;
        let x = e.clientX + pad, y = e.clientY + pad;
        if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
        if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
        tip.style.left = Math.max(8, x) + 'px';
        tip.style.top = Math.max(8, y) + 'px';
    }
}

// ---------- Solid geometry for the 3D views ----------
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vnorm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const centroid = list => vmul(list.reduce(vadd, [0, 0, 0]), 1 / list.length);

// Outward unit normal of a planar face, oriented away from a point inside the solid
function outwardNormal(face, inside) {
    let n = [0, 0, 0];
    for (let j = 0; j < face.length; j++) { // Newell's method: robust for any planar polygon
        const a = face[j], b = face[(j + 1) % face.length];
        n = vadd(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
    }
    n = vnorm(n);
    return vdot(n, vsub(centroid(face), inside)) < 0 ? vmul(n, -1) : n;
}

// Plywood support k as a slab, with its real thickness and placement
function supportSolid(r, k) {
    const { prof, i, theta, phi } = r;
    const psi = -theta / 2 + k * phi;
    const d = [Math.sin(psi), 0, Math.cos(psi)];     // radial direction in the support's plane
    const m = [Math.cos(psi), 0, -Math.sin(psi)];    // slab normal, toward increasing psi
    const s = i.s || 0.01;
    let lo = -s / 2, hi = s / 2;
    if (i.endSupports === 'outside' && i.n > 0) {
        if (k === 0) { lo = -s; hi = 0; }
        if (k === i.n) { lo = 0; hi = s; }
    }
    const P = (u, y, o) => [u * d[0] + o * m[0], y, u * d[2] + o * m[2]];
    const info = { kind: 'support', k };
    const shade = [38, 45, 38, 74];
    const items = [];
    const R = prof.R;

    // Broad faces, tessellated so the painter's sort can interleave them with the ribs
    const curve = supportProfile(prof, r.uStart, 28);
    const back = supportBack(prof);
    const quadsUV = [];
    const pieces = y => Math.max(1, Math.ceil(y / (R / 8)));
    for (let j = 0; j < curve.length - 1; j++) {
        const [u0, y0] = curve[j], [u1, y1] = curve[j + 1];
        if (u1 - u0 < 1e-6) continue;
        const nPieces = pieces(Math.max(y0, y1));
        for (let q = 0; q < nPieces; q++) {
            const t0 = q / nPieces, t1 = (q + 1) / nPieces;
            quadsUV.push([[u0, y0 * t0], [u1, y1 * t0], [u1, y1 * t1], [u0, y0 * t1]]);
        }
    }
    const nBack = pieces(prof.H);
    for (let q = 0; q < nBack; q++) {
        const y0 = prof.H * q / nBack, y1 = prof.H * (q + 1) / nBack;
        quadsUV.push([[prof.topU, y0], [back, y0], [back, y1], [prof.topU, y1]]);
    }
    [[lo, vmul(m, -1)], [hi, m]].forEach(([o, n]) => {
        quadsUV.forEach(q => items.push({ type: 'poly', cls: 'ply3d', seamless: true, shade, info, n, pts: q.map(([u, y]) => P(u, y, o)) }));
    });

    // Edges of the plywood: one strip per outline segment
    const outline = supportOutline(prof, r.uStart);
    let area = 0;
    outline.forEach((a, j) => { const b = outline[(j + 1) % outline.length]; area += a[0] * b[1] - b[0] * a[1]; });
    const ccw = area > 0;
    outline.forEach((a, j) => {
        const b = outline[(j + 1) % outline.length];
        const du = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(du, dy);
        if (len < 1e-6) return;
        const nu = (ccw ? dy : -dy) / len, ny = (ccw ? -du : du) / len; // outward, in the support's plane
        const n = [nu * d[0], ny, nu * d[2]];
        items.push({ type: 'poly', cls: 'ply3d ply-edge', shade: [38, 40, 28, 60], info, n,
            pts: [P(a[0], a[1], lo), P(b[0], b[1], lo), P(b[0], b[1], hi), P(a[0], a[1], hi)] });
    });
    return items;
}

// Rib geometry for bay k in the bay's local frame [x, z, y]:
// x along the rib, z outward along the bay bisector, y up.
// rings[t][c] = corner c (skin-lower, skin-upper, back-upper, back-lower) at station t along the rib.
function ribGeometry(r, rib, k, { cupped = r.i.curved, segs = 1 } = {}) {
    const { prof, i, h } = r;
    const [o1, o2] = [k === 0 ? r.oEnd : r.oMid, k === i.n - 1 ? r.oEnd : r.oMid];
    const oAvg = (o1 + o2) / 2;
    const sec = ribSection(prof, rib, i.t, i.depth);
    const toZ = u => u * Math.cos(h) + oAvg * Math.sin(h);   // support-plane u -> distance along the bisector
    const corners = sec.map(([u, y]) => ({ z: toZ(u), y }));
    // End planes: x·cos h − z·sin h = −o2 (right), −x·cos h − z·sin h = −o1 (left)
    const xR = z => (z * Math.sin(h) - o2) / Math.cos(h);
    const xL = z => -(z * Math.sin(h) - o1) / Math.cos(h);
    const nOut = [Math.sin(rib.a), -Math.cos(rib.a)];      // away from the bowl, in (z, y)
    const ref = corners[0];
    const xMid = (xL(ref.z) + xR(ref.z)) / 2;
    // Cup depth at x (returned even when the rings are built straight, for drawing the cup line)
    const cup = x => {
        const dx = x - xMid;
        return Math.max(0, rib.cupDepth - (rib.cupR - Math.sqrt(Math.max(0, rib.cupR * rib.cupR - dx * dx))));
    };
    const rings = [];
    for (let t = 0; t <= segs; t++) {
        const f = t / segs;
        rings.push(corners.map((c, ci) => {
            const x = xL(c.z) + (xR(c.z) - xL(c.z)) * f;
            const off = cupped && ci < 2 ? cup(x) : 0;
            return [x, c.z + nOut[0] * off, c.y + nOut[1] * off];
        }));
    }
    return { rings, cup, xMid };
}

// A rib in bay k as a solid for the 3D views, cupped when curved ribs are selected.
function ribSolid(r, rib, k) {
    const { i, theta, phi } = r;
    const beta = -theta / 2 + (k + 0.5) * phi;            // bay bisector
    const ex = [Math.cos(beta), 0, -Math.sin(beta)];       // along the rib
    const ez = [Math.sin(beta), 0, Math.cos(beta)];        // outward, horizontal
    const segs = i.curved ? 4 : 1;
    const W = ([x, z, y]) => vadd(vadd(vmul(ex, x), vmul(ez, z)), [0, y, 0]);
    const rings = ribGeometry(r, rib, k, { segs }).rings.map(ring => ring.map(W));
    const inside = centroid(rings[Math.floor(segs / 2)]);
    const info = { kind: 'rib', rib, k };
    const shade = [28, 55, 48, 84];
    const items = [];
    const face = pts => items.push({ type: 'poly', cls: 'rib-solid', rib: rib.number, seamless: true, shade, info, n: outwardNormal(pts, inside), pts, bias: -0.004 });
    for (let t = 0; t < segs; t++) {
        for (let c = 0; c < 4; c++) {
            const c2 = (c + 1) % 4;
            face([rings[t][c], rings[t + 1][c], rings[t + 1][c2], rings[t][c2]]);
        }
    }
    face(rings[0].slice());
    face(rings[segs].slice());
    return items;
}

// ---------- Rib detail: the rib on the saw table, to scale, seen from the operator's side ----------
let clipSeq = 0;
function drawRibOnSaw(svg, r, rib, flat) {
    const { i } = r;
    // Use a bay from the first group (middle bays when there are several); its length is the first column
    const k = Math.max(0, r.bayGroup.indexOf(0));
    const geo = ribGeometry(r, rib, k, { cupped: false });
    const ca = Math.cos(rib.a), sa = Math.sin(rib.a);
    // Saw frame: X along the fence, Y up off the table, Z away from the fence (toward the operator).
    // The short-point edge (skin-lower) always faces the operator:
    // Flat: lower wide face on the table, skin face toward you, back face against the fence.
    // On edge: skin face on the table, lower wide face toward you, upper face against the fence.
    // Z is flipped, so X is mirrored too to keep the frame right-handed.
    const toSaw = ([x, z, y]) => {
        const tT = z * ca + y * sa;          // up the ramp
        const tN = z * sa - y * ca;          // into the rib, away from the skin
        return flat ? [-x, tT, -tN] : [x, tN, -tT];
    };
    let rings = geo.rings.map(ring => ring.map(toSaw));
    const all = rings.flat();
    const min = [0, 1, 2].map(a => Math.min(...all.map(p => p[a])));
    const max = [0, 1, 2].map(a => Math.max(...all.map(p => p[a])));
    const cx = (min[0] + max[0]) / 2;
    rings = rings.map(ring => ring.map(p => [p[0] - cx, p[1] - min[1], p[2] - min[2]]));
    if (rings[0][0][0] > rings[1][0][0]) rings.reverse();   // rings[0] = left end
    const boardH = max[1] - min[1], boardW = max[2] - min[2];
    const xLo = Math.min(...rings.flat().map(p => p[0])), xHi = Math.max(...rings.flat().map(p => p[0]));
    const cupAt = X => geo.cup(flat ? -(X + cx) : X + cx);

    // Camera: above and in front (operator side), turned a little so the left end face shows
    const camera = (yaw, pitch) => {
        const cyaw = Math.cos(yaw), syaw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        return {
            cam: ([X, Y, Z]) => [X * cyaw + Z * syaw, Y * cp - (-X * syaw + Z * cyaw) * sp],
            facing: n => n[1] * sp + (-n[0] * syaw + n[2] * cyaw) * cp > 1e-9
        };
    };

    // Shared scene (saw coordinates)
    const margin = Math.max(1.5, boardW * 0.7);
    const fenceH = Math.max(boardH + 0.75, 3.5), fenceT = 1.5;
    const tx0 = xLo - margin * 1.5, tx1 = xHi + margin * 1.5;
    const table = [[tx0, 0, -fenceT], [tx1, 0, -fenceT], [tx1, 0, boardW + margin * 2.2], [tx0, 0, boardW + margin * 2.2]];
    const fence = [
        [[tx0, 0, 0], [tx1, 0, 0], [tx1, fenceH, 0], [tx0, fenceH, 0]],
        [[tx0, fenceH, 0], [tx1, fenceH, 0], [tx1, fenceH, -fenceT], [tx0, fenceH, -fenceT]]
    ];
    const boardFaces = [];
    for (let c = 0; c < 4; c++) {
        const c2 = (c + 1) % 4;
        boardFaces.push([rings[0][c], rings[1][c], rings[1][c2], rings[0][c2]]);
    }
    boardFaces.push(rings[0].slice(), rings[1].slice());
    const inside = centroid(rings.flat());
    const light = vnorm([-0.3, 1, 0.6]);
    const shadeFill = n => `hsl(30 50% ${(42 + 40 * Math.max(0, vdot(n, light))).toFixed(0)}%)`;
    const byY = ring => ring.map((p, c) => ({ p, c })).sort((a, b) => b.p[1] - a.p[1]);
    const topL = byY(rings[0]).slice(0, 2).sort((a, b) => a.p[2] - b.p[2]);   // [fence side, front (short side)]
    const botL = byY(rings[0]).slice(2).sort((a, b) => a.p[2] - b.p[2]);

    // Draws the scene into a rectangle of the SVG, fitted to the given focus points; returns the projector
    const VW = 360, VH = 250;
    svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
    function panel(rect, focus, padX, padY, { cam, facing }) {
        const f2 = focus.map(cam);
        const bx0 = Math.min(...f2.map(p => p[0])), bx1 = Math.max(...f2.map(p => p[0]));
        const by0 = Math.min(...f2.map(p => p[1])), by1 = Math.max(...f2.map(p => p[1]));
        const scale = Math.min((rect.w - 2 * padX) / (bx1 - bx0), (rect.h - 2 * padY) / (by1 - by0));
        const ox = rect.x + rect.w / 2 - (bx0 + bx1) / 2 * scale;
        const oy = rect.y + rect.h / 2 + (by0 + by1) / 2 * scale;
        const P = p => { const [a, b] = cam(p); return [ox + a * scale, oy - b * scale]; };
        const path = (list, close) => 'M' + list.map(p => P(p).map(v => v.toFixed(1)).join(' ')).join('L') + (close ? 'Z' : '');
        const id = `rib-clip-${++clipSeq}`;
        const defs = el('defs', {}, svg);
        el('rect', { x: rect.x, y: rect.y, width: rect.w, height: rect.h }, el('clipPath', { id }, defs));
        const g = el('g', { 'clip-path': `url(#${id})` }, svg);
        el('rect', { x: rect.x, y: rect.y, width: rect.w, height: rect.h, class: 'panel-bg' }, g);
        el('path', { d: path(table, true), class: 'saw-table' }, g);
        fence.forEach(f => el('path', { d: path(f, true), class: 'saw-fence' }, g));
        boardFaces.forEach(f => {
            const n = outwardNormal(f, inside);
            if (facing(n)) el('path', { d: path(f, true), class: 'board3d', style: `fill: ${shadeFill(n)}` }, g);
        });
        return { P, path, g, scale };
    }

    // ---- Panel 1: the whole board, with its length and the cup ----
    const dimZ = boardW + margin * 1.1;
    const top = i.curved ? 30 : 20;
    const v1 = panel({ x: 0, y: top, w: VW, h: 118 - top },
        [...rings.flat(), [xLo, 0, dimZ + margin * 0.5], [xHi, 0, dimZ + margin * 0.5], [xLo, fenceH, -fenceT], [xHi, fenceH, -fenceT]], 14, 6,
        camera(14 * DEG, 55 * DEG));
    {
        const { P, path, g } = v1;
        const refA = rings[0][0], refB = rings[1][0];   // skin-lower edge: toward you, on the table
        el('path', { d: path([refA, refB]), class: 'ref-edge' }, g);
        [refA, refB].forEach(p => { const q = P(p); el('circle', { cx: q[0], cy: q[1], r: 2, class: 'ref-dot' }, g); });
        el('path', { d: path([refA, [refA[0], 0, dimZ]]) + path([refB, [refB[0], 0, dimZ]]), class: 'ext-line' }, g);
        el('path', { d: path([[refA[0], 0, dimZ], [refB[0], 0, dimZ]]), class: 'dim-line' }, g);
        const mid = P([(refA[0] + refB[0]) / 2, 0, dimZ]);
        el('text', { x: VW / 2, y: Math.max(mid[1] + 11, 114), class: 'detail-label strong label-halo', 'text-anchor': 'middle', text: `${formatInches(rib.lengths[0])} short point, the edge toward you on the table` }, svg);
        if (i.curved) {
            // Show the cup where it meets a visible face: the top face's front edge (flat),
            // or the front face's bottom edge (on edge); the cup goes into the board from the skin.
            const cc = flat ? 1 : 0;
            const x0 = rings[0][cc][0], x1 = rings[1][cc][0];
            const edge = X => {
                const f = (X - x0) / (x1 - x0);
                const base = vadd(rings[0][cc], vmul(vsub(rings[1][cc], rings[0][cc]), f));
                const d = cupAt(X);
                return { base, cupped: flat ? [base[0], base[1], base[2] - d] : [base[0], base[1] + d, base[2]] };
            };
            const xs = [];
            for (let m = 0; m <= 40; m++) xs.push(x0 + (x1 - x0) * m / 40);
            el('path', { d: path(xs.map(X => edge(X).cupped)), class: 'cup-line' }, g);
            const c = edge((x0 + x1) / 2);
            el('path', { d: path([c.base, c.cupped]), class: 'cup-tick' }, g);
            const lab = P([(x0 + x1) / 2, fenceH, -fenceT]);
            el('text', { x: VW / 2, y: top - 4, class: 'detail-label cup-text label-halo', 'text-anchor': 'middle', text: `cup the skin face to a ${formatInches(rib.cupR)} radius, ${formatInches(rib.cupDepth)} deep at the center` }, svg);
        }
        // Scale bar
        const bar = (xHi - xLo) > 30 ? 12 : 6;
        const sb1 = [xHi + margin * 1.1, 0, dimZ + margin * 0.4], sb0 = [sb1[0] - bar, 0, sb1[2]];
        el('path', { d: path([sb0, sb1]), class: 'scale-bar' }, g);
        const sbm = P([(sb0[0] + sb1[0]) / 2, 0, sb0[2]]);
        el('text', { x: sbm[0], y: sbm[1] - 4, class: 'detail-label subtle', 'text-anchor': 'middle', text: `${bar}"` }, g);
    }

    // ---- Panel 2: close-up of the left end, with the miter and bevel ----
    const r2 = { x: 0, y: 136, w: VW, h: VH - 136 };
    const span = Math.max(boardW, boardH) * 2.2;
    const focus = [...rings[0], [xLo + span * 0.55, boardH, 0], [xLo + span * 0.55, 0, boardW], [xLo, 0, boardW * 1.25], [xLo, boardH * 1.3, 0]];
    const v2 = panel(r2, focus, 90, 10, camera(34 * DEG, 38 * DEG));
    {
        const { P, path, g } = v2;
        el('line', { x1: 0, y1: r2.y, x2: VW, y2: r2.y, class: 'panel-sep' }, svg);
        // Angle wedge between two legs from a vertex, with the legs drawn past the board so the angle reads
        const wedge = (V, d1, d2, len, label, labelSide) => {
            const n1 = vnorm(d1), n2 = vnorm(d2);
            const arc = [V];
            for (let m = 0; m <= 16; m++) arc.push(vadd(V, vmul(vnorm(vadd(vmul(n1, 1 - m / 16), vmul(n2, m / 16))), len * 0.7)));
            el('path', { d: path(arc, true), class: 'angle-wedge' }, g);
            el('path', { d: path([V, vadd(V, vmul(n1, len))]), class: 'square-ref' }, g);
            el('path', { d: path([V, vadd(V, vmul(n2, len))]), class: 'cut-edge' }, g);
            const tip = P(vadd(V, vmul(vnorm(vadd(n1, n2)), len * 1.05)));
            const tx = Math.max(70, Math.min(VW - 70, tip[0] + (labelSide > 0 ? 4 : -4)));
            const ty = Math.max(r2.y + 12, Math.min(VH - 16, tip[1] + 3));
            el('text', { x: tx, y: ty, class: 'detail-label angle-text label-halo', 'text-anchor': labelSide > 0 ? 'start' : 'end', text: label }, svg);
        };
        // Miter: on the top face, between a square line off the fence and the cut
        const A = topL[0].p, B = topL[1].p;
        const w = B[2] - A[2];
        wedge(A, [0, 0, 1], vsub(B, A), w * 1.6, `miter ${formatDeg(rib.miter)}`, 1);
        // Bevel: on the end face, between plumb and the cut, through the middle of the end
        const Mb = vmul(vadd(botL[0].p, botL[1].p), 0.5), Mt = vmul(vadd(topL[0].p, topL[1].p), 0.5);
        wedge(Mb, [0, 1, 0], vsub(Mt, Mb), (Mt[1] - Mb[1]) * 2.2, `bevel ${formatDeg(rib.bevel)}`, -1);
        el('text', { x: VW - 6, y: VH - 6, class: 'detail-label subtle', 'text-anchor': 'end', text: 'left end, close up' }, svg);
    }
    el('text', { x: VW / 2, y: 11, class: 'detail-label subtle', 'text-anchor': 'middle', text: `to scale · ${flat ? 'lying flat, skin edge toward you' : 'on edge, skin face down, lower face toward you'} · far end mirrored` }, svg);
}

function xy([x, y], dx = 0, dy = 0) { return { x: x + dx, y: y + dy }; }
