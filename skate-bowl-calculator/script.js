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
    vizRadiusLabel.setAttribute('x', (centerX + midArcX) / 2 - 10);
    vizRadiusLabel.setAttribute('y', (centerY + midArcY) / 2);

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
}

// Rib row hover highlighting
function setupRibRowHighlighting() {
    document.querySelectorAll('#results-table tbody tr').forEach(row => {
        row.addEventListener('mouseenter', () => {
            const ribNumber = row.dataset.ribNumber;
            const dot = document.getElementById(`viz-rib-${ribNumber}`);
            if (dot) {
                dot.setAttribute('r', '6');
                dot.setAttribute('fill', '#ff0066');
            }
        });

        row.addEventListener('mouseleave', () => {
            const ribNumber = row.dataset.ribNumber;
            const dot = document.getElementById(`viz-rib-${ribNumber}`);
            if (dot) {
                dot.setAttribute('r', '3');
                dot.setAttribute('fill', '#e83e8c');
            }
        });
    });
}

// Hover highlighting
function setupHighlighting() {
    const sideView = document.getElementById('side-view');
    const topView = document.getElementById('top-view');

    document.querySelectorAll('[data-highlight]').forEach(el => {
        el.addEventListener('mouseenter', () => {
            const highlightType = el.dataset.highlight;
            sideView.classList.add(`highlight-${highlightType}`);
            topView.classList.add(`highlight-${highlightType}`);
        });

        el.addEventListener('mouseleave', () => {
            const highlightType = el.dataset.highlight;
            sideView.classList.remove(`highlight-${highlightType}`);
            topView.classList.remove(`highlight-${highlightType}`);
        });
    });
}

// Calculate on page load with default values
document.addEventListener('DOMContentLoaded', () => {
    calculateRibs();
    setupHighlighting();
});
