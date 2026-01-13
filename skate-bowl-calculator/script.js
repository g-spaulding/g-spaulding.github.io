document.getElementById('calculator-form').addEventListener('submit', function(e) {
    e.preventDefault();
    calculateRibs();
});

function calculateRibs() {
    // Get inputs
    const radiusValue = parseFloat(document.getElementById('radius').value);
    const radiusUnit = document.getElementById('radius-unit').value;
    const cornerAngleDeg = parseFloat(document.getElementById('corner-angle').value);
    const numSections = parseInt(document.getElementById('num-sections').value);
    const ribSpacing = parseFloat(document.getElementById('rib-spacing').value);
    const maxHeightValue = parseFloat(document.getElementById('max-height').value);
    const heightUnit = document.getElementById('height-unit').value;
    const supportThickness = parseFloat(document.getElementById('support-thickness').value);
    const ribThickness = parseFloat(document.getElementById('rib-thickness').value);

    // Convert to inches
    const radius = radiusUnit === 'ft' ? radiusValue * 12 : radiusValue;
    const maxHeight = heightUnit === 'ft' ? maxHeightValue * 12 : maxHeightValue;

    // Validate
    if (maxHeight > radius) {
        alert('Maximum height cannot exceed the radius.');
        return;
    }

    // Calculate angle between supports (fan angle)
    const fanAngleDeg = cornerAngleDeg / numSections;
    const fanAngleRad = fanAngleDeg * Math.PI / 180;
    const cornerAngleRad = cornerAngleDeg * Math.PI / 180;

    // Calculate the angle at the top cutoff
    // Height h = R × (1 - cos(α)), so α = arccos(1 - h/R)
    const alphaMax = Math.acos(1 - maxHeight / radius);

    // Layout calculations
    // Top radius = horizontal distance from toe to top of ramp
    const topRadius = radius * Math.sin(alphaMax);
    // Top straight line distance = chord across entire corner at top
    const topChord = 2 * topRadius * Math.sin(cornerAngleRad / 2);

    // Total arc length from bottom (toe) to top (cutoff)
    const totalArcLength = radius * alphaMax;

    // Support thickness to deduct per rib
    // Total deduction across corner = (numSections - 1) × supportThickness
    // Per rib = that total / numSections
    const thicknessPerRib = (numSections - 1) * supportThickness / numSections;

    // Calculate rib positions (from top, measuring to bottom edge of rib)
    // First rib: ribThickness down from top
    // Subsequent ribs: ribThickness + n × ribSpacing
    const ribs = [];
    let distanceFromTop = ribThickness;

    while (distanceFromTop < totalArcLength) {
        // Arc length from bottom = totalArcLength - distanceFromTop
        const arcFromBottom = totalArcLength - distanceFromTop;

        // Angle from bottom: arcLength = R × α, so α = arcLength / R
        const alpha = arcFromBottom / radius;

        // Height at this position: h = R × (1 - cos(α))
        const height = radius * (1 - Math.cos(alpha));

        // Horizontal distance from toe: d = R × sin(α)
        const horizDist = radius * Math.sin(alpha);

        // Rib length: 2 × d × tan(θ/2) - thickness deduction for shared supports
        const rawLength = 2 * horizDist * Math.tan(fanAngleRad / 2);
        const ribLength = rawLength - thicknessPerRib;

        // Compound miter angles
        // The rib meets a surface that is:
        // - Angled θ/2 horizontally (due to fan-out)
        // - Sloped at angle α (tangent to curve)
        //
        // From the saw's perspective:
        // Bevel (blade tilt) = arctan(tan(θ/2) × cos(α))
        // Miter (table rotation) = arcsin(sin(θ/2) × sin(α))
        const bevelRad = Math.atan(Math.tan(fanAngleRad / 2) * Math.cos(alpha));
        const miterRad = Math.asin(Math.sin(fanAngleRad / 2) * Math.sin(alpha));

        const miterDeg = miterRad * 180 / Math.PI;
        const bevelDeg = bevelRad * 180 / Math.PI;

        ribs.push({
            number: ribs.length + 1,
            distanceFromTop: distanceFromTop,
            arcFromBottom: arcFromBottom,
            height: height,
            length: ribLength,
            miter: miterDeg,
            bevel: bevelDeg
        });

        distanceFromTop += ribSpacing;
    }

    const geometry = {
        radius: radius,
        maxHeight: maxHeight,
        alphaMax: alphaMax,
        cornerAngleRad: cornerAngleRad,
        fanAngleRad: fanAngleRad,
        numSections: numSections,
        topRadius: topRadius,
        topChord: topChord,
        fanAngleDeg: fanAngleDeg
    };

    displayResults(ribs, {
        angleBetweenSupports: fanAngleDeg,
        topRadius: topRadius,
        topChord: topChord
    });

    updateVisualization(geometry, ribs);
}

function displayResults(ribs, layout) {
    const resultsDiv = document.getElementById('results');
    const tbody = document.querySelector('#results-table tbody');

    // Clear previous results
    tbody.innerHTML = '';

    if (ribs.length === 0) {
        resultsDiv.classList.add('hidden');
        alert('No ribs fit within the specified dimensions.');
        return;
    }

    // Display layout info
    document.getElementById('angle-between-supports').textContent = `${layout.angleBetweenSupports.toFixed(1)}°`;
    document.getElementById('top-radius').textContent = formatInches(layout.topRadius);
    document.getElementById('top-chord').textContent = formatInches(layout.topChord);

    // Add rows
    ribs.forEach(rib => {
        const row = document.createElement('tr');
        row.dataset.ribNumber = rib.number;
        row.innerHTML = `
            <td>${rib.number}</td>
            <td>${formatInches(rib.distanceFromTop)}</td>
            <td>${formatInches(rib.length)}</td>
            <td>${rib.miter.toFixed(1)}°</td>
            <td>${rib.bevel.toFixed(1)}°</td>
        `;
        tbody.appendChild(row);
    });

    // Set up row hover highlighting
    setupRibRowHighlighting();

    resultsDiv.classList.remove('hidden');
}

function formatInches(inches) {
    return `${formatFraction(inches)}"`;
}

function formatFraction(inches) {
    // Round to nearest 1/16th
    const sixteenths = Math.round(inches * 16);
    const whole = Math.floor(sixteenths / 16);
    const remainder = sixteenths % 16;

    if (remainder === 0) {
        return `${whole}`;
    }

    // Simplify fraction
    let num = remainder;
    let den = 16;
    while (num % 2 === 0 && den % 2 === 0) {
        num /= 2;
        den /= 2;
    }

    if (whole === 0) {
        return `${num}/${den}`;
    }
    return `${whole}-${num}/${den}`;
}

function updateVisualization(geo, ribs) {
    // Side view dimensions
    const svgSize = 200;
    const padding = 15;
    const drawArea = svgSize - 2 * padding;

    // Scale factor to fit the ramp in the view
    const scale = drawArea / geo.radius;

    // Origin for side view (bottom-left of the ramp curve)
    const originX = padding;
    const originY = svgSize - padding;

    // Draw the arc (quarter circle from toe up to max height)
    const arcPath = document.getElementById('viz-arc');
    const arcEndX = originX + geo.topRadius * scale;
    const arcEndY = originY - geo.maxHeight * scale;
    const radiusScaled = geo.radius * scale;

    // SVG arc: A rx ry x-axis-rotation large-arc-flag sweep-flag x y
    arcPath.setAttribute('d',
        `M ${originX} ${originY} ` +
        `A ${radiusScaled} ${radiusScaled} 0 0 0 ${arcEndX} ${arcEndY}`
    );

    // Radius line (from center of circle to a point on the arc)
    const vizRadius = document.getElementById('viz-radius');
    const centerX = originX;
    const centerY = originY - geo.radius * scale;
    // Draw to midpoint of arc
    const midAlpha = geo.alphaMax / 2;
    const midArcX = originX + geo.radius * Math.sin(midAlpha) * scale;
    const midArcY = originY - geo.radius * (1 - Math.cos(midAlpha)) * scale;
    vizRadius.setAttribute('x1', centerX);
    vizRadius.setAttribute('y1', centerY);
    vizRadius.setAttribute('x2', midArcX);
    vizRadius.setAttribute('y2', midArcY);

    // Radius label
    const vizRadiusLabel = document.getElementById('viz-radius-label');
    vizRadiusLabel.setAttribute('x', (centerX + midArcX) / 2 - 12);
    vizRadiusLabel.setAttribute('y', (centerY + midArcY) / 2 + 8);

    // Height line (vertical from ground to top of ramp)
    const vizHeight = document.getElementById('viz-height');
    vizHeight.setAttribute('x1', arcEndX);
    vizHeight.setAttribute('y1', originY);
    vizHeight.setAttribute('x2', arcEndX);
    vizHeight.setAttribute('y2', arcEndY);

    // Height label
    const vizHeightLabel = document.getElementById('viz-height-label');
    vizHeightLabel.setAttribute('x', arcEndX + 5);
    vizHeightLabel.setAttribute('y', (originY + arcEndY) / 2);

    // Top radius line (horizontal from toe to top)
    const vizTopRadius = document.getElementById('viz-top-radius');
    vizTopRadius.setAttribute('x1', originX);
    vizTopRadius.setAttribute('y1', arcEndY);
    vizTopRadius.setAttribute('x2', arcEndX);
    vizTopRadius.setAttribute('y2', arcEndY);

    // Draw ribs on side view
    const vizRibs = document.getElementById('viz-ribs');
    vizRibs.innerHTML = '';
    ribs.forEach(rib => {
        const alpha = rib.arcFromBottom / geo.radius;
        const ribX = originX + geo.radius * Math.sin(alpha) * scale;
        const ribY = originY - geo.radius * (1 - Math.cos(alpha)) * scale;

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', ribX);
        circle.setAttribute('cy', ribY);
        circle.setAttribute('r', 3);
        circle.setAttribute('fill', '#e83e8c');
        circle.setAttribute('id', `viz-rib-${rib.number}`);
        vizRibs.appendChild(circle);
    });

    // Top view
    const topOriginX = 100; // Center of view
    const topOriginY = 185; // Bottom (toe point)
    // Scale to fit - need to account for both width (chord) and height (topRadius)
    const halfCornerAngle = geo.cornerAngleRad / 2;
    const viewWidth = geo.topRadius * Math.sin(halfCornerAngle) * 2; // chord width
    const viewHeight = geo.topRadius; // full radius for height
    const scaleForWidth = 180 / viewWidth;
    const scaleForHeight = 150 / viewHeight;
    const topScale = Math.min(scaleForWidth, scaleForHeight); // Use smaller scale to fit both

    // Draw supports (fan lines)
    const vizSupports = document.getElementById('viz-supports');
    vizSupports.innerHTML = '';
    const halfCorner = geo.cornerAngleRad / 2;
    for (let i = 0; i <= geo.numSections; i++) {
        const angle = -halfCorner + (i * geo.fanAngleRad);
        const lineEndX = topOriginX + Math.sin(angle) * geo.topRadius * topScale;
        const lineEndY = topOriginY - Math.cos(angle) * geo.topRadius * topScale;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', topOriginX);
        line.setAttribute('y1', topOriginY);
        line.setAttribute('x2', lineEndX);
        line.setAttribute('y2', lineEndY);
        line.setAttribute('stroke', '#999');
        line.setAttribute('stroke-width', '1');
        vizSupports.appendChild(line);
    }

    // Top arc
    const vizTopArc = document.getElementById('viz-top-arc');
    const topArcRadius = geo.topRadius * topScale;
    const startAngle = -halfCorner;
    const endAngle = halfCorner;
    const startX = topOriginX + Math.sin(startAngle) * topArcRadius;
    const startY = topOriginY - Math.cos(startAngle) * topArcRadius;
    const endX = topOriginX + Math.sin(endAngle) * topArcRadius;
    const endY = topOriginY - Math.cos(endAngle) * topArcRadius;
    const largeArc = geo.cornerAngleRad > Math.PI ? 1 : 0;
    vizTopArc.setAttribute('d',
        `M ${startX} ${startY} A ${topArcRadius} ${topArcRadius} 0 ${largeArc} 1 ${endX} ${endY}`
    );

    // Top chord
    const vizChord = document.getElementById('viz-chord');
    vizChord.setAttribute('x1', startX);
    vizChord.setAttribute('y1', startY);
    vizChord.setAttribute('x2', endX);
    vizChord.setAttribute('y2', endY);

    // Corner angle arc (small arc near toe to show the angle)
    const vizCornerAngle = document.getElementById('viz-corner-angle');
    const angleArcRadius = 30;
    const angleStartX = topOriginX + Math.sin(startAngle) * angleArcRadius;
    const angleStartY = topOriginY - Math.cos(startAngle) * angleArcRadius;
    const angleEndX = topOriginX + Math.sin(endAngle) * angleArcRadius;
    const angleEndY = topOriginY - Math.cos(endAngle) * angleArcRadius;
    vizCornerAngle.setAttribute('d',
        `M ${angleStartX} ${angleStartY} A ${angleArcRadius} ${angleArcRadius} 0 0 1 ${angleEndX} ${angleEndY}`
    );

    // Angle label
    const vizAngleLabel = document.getElementById('viz-angle-label');
    vizAngleLabel.setAttribute('x', topOriginX - 15);
    vizAngleLabel.setAttribute('y', topOriginY - angleArcRadius - 5);
    vizAngleLabel.textContent = `${Math.round(geo.cornerAngleRad * 180 / Math.PI)}°`;

    // Isometric 3D view
    updateIsometricView(geo, ribs);
}

function updateIsometricView(geo, ribs) {
    // Isometric projection - view from front-left, looking at the curved ramp surface
    // We want to see the curve rising up from the toe

    // The bowl geometry:
    // - Toe is at origin (0,0,0)
    // - Supports fan out in the XZ plane
    // - Height (Y) goes up
    // - With 90° corner, middle of bowl faces +Z direction

    // We'll view from: front-left-below, looking toward the bowl
    // This means looking from negative Z, negative X, and seeing Y go up

    const project3D = (x, y, z) => {
        // Dimetric-style projection for better depth perception
        // Rotate model around Y, then tilt to view from above
        const angleY = Math.PI / 5 + Math.PI / 2;  // Rotate around vertical axis (+90°)
        const angleX = Math.PI / 4;  // Tilt to view from above (45°)

        // Rotate around Y axis
        const x1 = x * Math.cos(angleY) - z * Math.sin(angleY);
        const z1 = x * Math.sin(angleY) + z * Math.cos(angleY);
        const y1 = y;

        // Rotate around X axis (tilt forward)
        const y2 = y1 * Math.cos(angleX) - z1 * Math.sin(angleX);
        const z2 = y1 * Math.sin(angleX) + z1 * Math.cos(angleX);
        const x2 = x1;

        // Project to 2D (orthographic)
        return {
            x: x2,
            y: -y2  // Flip Y for screen coordinates
        };
    };

    // Scale and offset to fit in viewBox
    const isoScale = 1.3;
    const offsetX = 125;
    const offsetY = 150;

    const project = (x, y, z) => {
        const p = project3D(x, y, z);
        return { x: p.x * isoScale + offsetX, y: p.y * isoScale + offsetY };
    };

    // Generate points along each support's curve
    const numCurvePoints = 20;
    const supportCurves = [];
    const halfCorner = geo.cornerAngleRad / 2;

    for (let s = 0; s <= geo.numSections; s++) {
        const angle = -halfCorner + (s * geo.fanAngleRad);
        const curve = [];

        for (let i = 0; i <= numCurvePoints; i++) {
            const alpha = (i / numCurvePoints) * geo.alphaMax;
            const height = geo.radius * (1 - Math.cos(alpha));
            const horizDist = geo.radius * Math.sin(alpha);

            // 3D position: x = horizDist * sin(angle), z = horizDist * cos(angle), y = height
            const x = horizDist * Math.sin(angle);
            const z = horizDist * Math.cos(angle);
            const y = height;

            curve.push({ x, y, z, alpha });
        }
        supportCurves.push(curve);
    }

    // Draw bowl surface (filled polygons between supports)
    const vizSurface = document.getElementById('viz-iso-surface');
    vizSurface.innerHTML = '';

    for (let s = 0; s < geo.numSections; s++) {
        const curve1 = supportCurves[s];
        const curve2 = supportCurves[s + 1];

        // Create a polygon for this section
        const points = [];

        // Go up curve1
        for (let i = 0; i <= numCurvePoints; i++) {
            const p = project(curve1[i].x, curve1[i].y, curve1[i].z);
            points.push(`${p.x},${p.y}`);
        }

        // Go down curve2
        for (let i = numCurvePoints; i >= 0; i--) {
            const p = project(curve2[i].x, curve2[i].y, curve2[i].z);
            points.push(`${p.x},${p.y}`);
        }

        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', points.join(' '));
        polygon.setAttribute('fill', `hsl(200, 20%, ${75 - s * 3}%)`);
        polygon.setAttribute('stroke', '#999');
        polygon.setAttribute('stroke-width', '0.5');
        vizSurface.appendChild(polygon);
    }

    // Draw support frame lines
    const vizIsoSupports = document.getElementById('viz-iso-supports');
    vizIsoSupports.innerHTML = '';

    supportCurves.forEach((curve, idx) => {
        const pathPoints = curve.map(pt => {
            const p = project(pt.x, pt.y, pt.z);
            return `${p.x},${p.y}`;
        });

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        path.setAttribute('points', pathPoints.join(' '));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#666');
        path.setAttribute('stroke-width', '1.5');
        vizIsoSupports.appendChild(path);
    });

    // Draw ribs
    const vizIsoRibs = document.getElementById('viz-iso-ribs');
    vizIsoRibs.innerHTML = '';

    ribs.forEach(rib => {
        const alpha = rib.arcFromBottom / geo.radius;

        for (let s = 0; s < geo.numSections; s++) {
            const angle1 = -halfCorner + (s * geo.fanAngleRad);
            const angle2 = -halfCorner + ((s + 1) * geo.fanAngleRad);

            const horizDist = geo.radius * Math.sin(alpha);
            const height = geo.radius * (1 - Math.cos(alpha));

            const x1 = horizDist * Math.sin(angle1);
            const z1 = horizDist * Math.cos(angle1);
            const x2 = horizDist * Math.sin(angle2);
            const z2 = horizDist * Math.cos(angle2);

            const p1 = project(x1, height, z1);
            const p2 = project(x2, height, z2);

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', p1.x);
            line.setAttribute('y1', p1.y);
            line.setAttribute('x2', p2.x);
            line.setAttribute('y2', p2.y);
            line.setAttribute('stroke', '#e83e8c');
            line.setAttribute('stroke-width', '1.5');
            line.setAttribute('class', `iso-rib-${rib.number}`);
            vizIsoRibs.appendChild(line);
        }
    });

    // Draw deck edge (top arc)
    const vizIsoDeck = document.getElementById('viz-iso-deck');
    const deckPoints = [];
    for (let s = 0; s <= geo.numSections; s++) {
        const curve = supportCurves[s];
        const topPt = curve[curve.length - 1];
        const p = project(topPt.x, topPt.y, topPt.z);
        deckPoints.push(`${p.x},${p.y}`);
    }
    vizIsoDeck.setAttribute('d', 'M ' + deckPoints.join(' L '));
}

// Rib row hover highlighting
function setupRibRowHighlighting() {
    document.querySelectorAll('#results-table tbody tr').forEach(row => {
        row.addEventListener('mouseenter', () => {
            const ribNumber = row.dataset.ribNumber;
            // Highlight dot in side view
            const dot = document.getElementById(`viz-rib-${ribNumber}`);
            if (dot) {
                dot.setAttribute('r', '6');
                dot.setAttribute('fill', '#ff0066');
            }
            // Highlight lines in isometric view
            document.querySelectorAll(`.iso-rib-${ribNumber}`).forEach(line => {
                line.setAttribute('stroke', '#ff0066');
                line.setAttribute('stroke-width', '3');
            });
        });

        row.addEventListener('mouseleave', () => {
            const ribNumber = row.dataset.ribNumber;
            // Reset dot in side view
            const dot = document.getElementById(`viz-rib-${ribNumber}`);
            if (dot) {
                dot.setAttribute('r', '3');
                dot.setAttribute('fill', '#e83e8c');
            }
            // Reset lines in isometric view
            document.querySelectorAll(`.iso-rib-${ribNumber}`).forEach(line => {
                line.setAttribute('stroke', '#e83e8c');
                line.setAttribute('stroke-width', '1.5');
            });
        });
    });
}

// Hover highlighting
function setupHighlighting() {
    const sideView = document.getElementById('side-view');
    const topView = document.getElementById('top-view');
    const isoView = document.getElementById('iso-view');

    document.querySelectorAll('[data-highlight]').forEach(el => {
        el.addEventListener('mouseenter', () => {
            const highlightType = el.dataset.highlight;
            sideView.classList.add(`highlight-${highlightType}`);
            topView.classList.add(`highlight-${highlightType}`);
            isoView.classList.add(`highlight-${highlightType}`);
        });

        el.addEventListener('mouseleave', () => {
            const highlightType = el.dataset.highlight;
            sideView.classList.remove(`highlight-${highlightType}`);
            topView.classList.remove(`highlight-${highlightType}`);
            isoView.classList.remove(`highlight-${highlightType}`);
        });
    });
}

// Calculate on page load with default values
document.addEventListener('DOMContentLoaded', () => {
    calculateRibs();
    setupHighlighting();
});
