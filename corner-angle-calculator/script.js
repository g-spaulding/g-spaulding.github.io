const { DEG, toInches, formatInches, formatLong, formatDeg, profile, el, clear, pts, fitter, dim } = BowlGeo;
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
    const form = $('calculator-form');
    const saveUrl = BowlGeo.syncFormWithUrl(form);
    const update = () => {
        const torus = $('corner-shape').value === 'torus';
        document.querySelectorAll('.torus-only').forEach(n => n.classList.toggle('hidden', !torus));
        calculate();
        saveUrl();
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', e => { e.preventDefault(); update(); });
    update();
    BowlGeo.setupHighlighting();
});

function showError(msg) {
    $('error').textContent = msg || '';
    $('error').classList.toggle('hidden', !msg);
    $('results').classList.toggle('stale', !!msg);
}

function calculate() {
    const num = id => parseFloat($(id).value);
    const R = toInches(num('radius'), $('radius-unit').value);
    const H = toInches(num('height'), $('height-unit').value);
    const chord = toInches(num('chord'), $('chord-unit').value);
    const torus = $('corner-shape').value === 'torus';
    const coping = toInches(num('coping-radius'), $('coping-unit').value);

    if (!(R > 0) || !(H > 0)) return showError('Enter a transition radius and height.');
    if (!(chord > 0)) return showError('Enter the coping chord.');

    const sphereTop = profile(R, H, 0).topU;
    let r0 = 0;
    if (torus) {
        if (!(coping >= sphereTop - 1e-9)) {
            return showError(`The coping radius can't be smaller than ${formatInches(sphereTop)}, the tight-corner radius for this transition.`);
        }
        r0 = coping - sphereTop;
    }
    const prof = profile(R, H, r0);
    const top = prof.topU;

    if (chord > 2 * top) {
        return showError(`A ${formatInches(chord)} chord is wider than the coping circle's diameter (${formatInches(2 * top)}). Check the measurements${torus ? ' or the coping radius' : ', or try a wide corner'}.`);
    }
    showError(null);

    // chord = 2·r·sin(θ/2)
    const theta = 2 * Math.asin(chord / (2 * top));
    const sagitta = top * (1 - Math.cos(theta / 2));

    $('corner-angle').textContent = formatDeg(theta);
    $('top-radius').innerHTML = formatLong(top);
    $('toe-radius').innerHTML = formatLong(r0);
    $('sagitta').innerHTML = formatLong(sagitta);
    $('arc-length').innerHTML = formatLong(top * theta);

    const p = new URLSearchParams({
        radius: $('radius').value, 'radius-unit': $('radius-unit').value,
        'max-height': $('height').value, 'height-unit': $('height-unit').value,
        'corner-angle': (theta / DEG).toFixed(1),
        'corner-shape': torus ? 'torus' : 'sphere',
        'coping-radius': $('coping-radius').value, 'coping-unit': $('coping-unit').value
    });
    $('rib-link').href = '../skate-bowl-calculator/?' + p.toString();

    drawSide(prof);
    drawTop(prof, theta, sagitta);
}

function drawSide(prof) {
    const svg = $('side-view');
    clear(svg);
    const f = fitter([[0, 0], [prof.topU + prof.R * 0.12, prof.H + prof.R * 0.1], [-prof.R * 0.05, 0]], 220, 200, 14);
    const P = ([u, y]) => f(u, y);
    el('line', { x1: 0, y1: P([0, 0])[1], x2: 220, y2: P([0, 0])[1], class: 'ground' }, svg);
    const a0 = P([0, 0]), a1 = P([0, prof.H + prof.R * 0.05]);
    el('line', { x1: a0[0], y1: a0[1], x2: a1[0], y2: a1[1], class: 'axis' }, svg);
    el('polyline', { points: pts([[0, 0], ...prof.samples(60).map(p => [p.u, p.y])].map(P)), class: 'surface' }, svg);
    const mid = prof.at(Math.min(prof.arcLen, prof.total) * 0.55);
    dim(svg, P([prof.r0, prof.R]), P([mid.u, mid.y]), 'R', 'dim-radius', 6);
    const hx = prof.topU + prof.R * 0.06;
    dim(svg, P([hx, 0]), P([hx, prof.H]), 'H', 'dim-height', 7);
    const ty = prof.H + prof.R * 0.05;
    dim(svg, P([0, ty]), P([prof.topU, ty]), formatInches(prof.topU), 'dim-top-radius', -6);
    if (prof.r0 > 0) dim(svg, P([0, 0]), P([prof.r0, 0]), '', 'dim-toe', 0);
}

function drawTop(prof, theta, sagitta) {
    const svg = $('top-view');
    clear(svg);
    const half = theta / 2;
    const top = prof.topU;
    const XY = (u, psi) => [u * Math.sin(psi), u * Math.cos(psi)];
    const wallLen = top * 0.4;
    const bound = [[0, 0]];
    const walls = [-1, 1].map(side => {
        const psi = side * half;
        const t = [side * Math.cos(psi), -side * Math.sin(psi)];
        const c = XY(top, psi);
        const e = [c[0] + t[0] * wallLen, c[1] + t[1] * wallLen];
        bound.push(c, e);
        return { c, e };
    });
    for (let k = 0; k <= 16; k++) bound.push(XY(top, -half + theta * k / 16));
    const f = fitter(bound, 220, 200, 14);
    const P = ([x, y]) => f(x, y);
    const arc = (u, cls, steps = 48) => {
        const list = [];
        for (let k = 0; k <= steps; k++) list.push(P(XY(u, -half + theta * k / steps)));
        el('polyline', { points: pts(list), class: cls }, svg);
    };
    walls.forEach(({ c, e }) => {
        el('line', { x1: P(c)[0], y1: P(c)[1], x2: P(e)[0], y2: P(e)[1], class: 'wall-edge' }, svg);
        const o = P([0, 0]), cc = P(c);
        el('line', { x1: o[0], y1: o[1], x2: cc[0], y2: cc[1], class: 'support' }, svg);
    });
    arc(top, 'coping');
    if (prof.r0 > 0) arc(prof.r0, 'toe-line');
    dim(svg, P(walls[0].c), P(walls[1].c), '', 'dim-chord', 0);
    // Sagitta
    const chordMid = [0, top * Math.cos(half)];
    dim(svg, P(chordMid), P([0, top]), '', 'dim-sagitta', 0);
    const rr = P(XY(top, 0));
    el('line', { x1: P([0, 0])[0], y1: P([0, 0])[1], x2: rr[0], y2: rr[1], class: 'top-radius-line' }, svg);
    const angR = Math.min(top * 0.22, 26 / f.scale);
    arc(angR, 'angle-arc', 24);
    const lab = P(XY(angR * 1.6, 0));
    el('text', { x: lab[0] + 4, y: lab[1] + 3, class: 'angle-label', text: formatDeg(theta) }, svg);
    const o = P([0, 0]);
    el('circle', { cx: o[0], cy: o[1], r: 2.2, class: 'center-dot' }, svg);
}
