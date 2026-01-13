document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('calculator-form');
    const resultsDiv = document.getElementById('results');

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        calculateCornerAngle();
    });

    // Auto-calculate on input change
    form.querySelectorAll('input, select').forEach(input => {
        input.addEventListener('change', () => {
            if (form.checkValidity()) {
                calculateCornerAngle();
            }
        });
    });

    setupHighlighting();

    // Initial calculation
    calculateCornerAngle();
});

function calculateCornerAngle() {
    // Get inputs
    const radiusValue = parseFloat(document.getElementById('radius').value);
    const radiusUnit = document.getElementById('radius-unit').value;
    const heightValue = parseFloat(document.getElementById('height').value);
    const heightUnit = document.getElementById('height-unit').value;
    const chordInches = parseFloat(document.getElementById('chord').value);

    // Convert to inches
    const radiusInches = radiusUnit === 'ft' ? radiusValue * 12 : radiusValue;
    const heightInches = heightUnit === 'ft' ? heightValue * 12 : heightValue;

    // Validate: height must be less than or equal to radius
    if (heightInches > radiusInches) {
        document.getElementById('results').classList.add('hidden');
        alert('Height cannot exceed radius');
        return;
    }

    // Calculate arc angle α from height
    // h = R × (1 - cos(α))
    // cos(α) = 1 - h/R
    // α = arccos(1 - h/R)
    const cosAlpha = 1 - heightInches / radiusInches;
    const alpha = Math.acos(cosAlpha);

    // Calculate top radius (horizontal distance at top)
    // top_radius = R × sin(α)
    const topRadius = radiusInches * Math.sin(alpha);

    // Validate: chord must be less than 2 × top_radius (can't be wider than diameter)
    if (chordInches > 2 * topRadius) {
        document.getElementById('results').classList.add('hidden');
        alert('Top straight line distance is too large for this radius and height combination');
        return;
    }

    // Calculate corner angle from chord
    // chord = 2 × top_radius × sin(θ/2)
    // sin(θ/2) = chord / (2 × top_radius)
    // θ = 2 × arcsin(chord / (2 × top_radius))
    const sinHalfTheta = chordInches / (2 * topRadius);
    const cornerAngle = 2 * Math.asin(sinHalfTheta);
    const cornerAngleDegrees = cornerAngle * (180 / Math.PI);

    // Update results
    document.getElementById('top-radius').textContent = formatInches(topRadius);
    document.getElementById('corner-angle').textContent = cornerAngleDegrees.toFixed(1) + '°';

    document.getElementById('results').classList.remove('hidden');

    // Update visualization
    updateVisualization(radiusInches, heightInches, topRadius, cornerAngle);
}

function formatInches(inches) {
    const wholeInches = Math.floor(inches);
    const fraction = inches - wholeInches;

    // Convert to 16ths
    const sixteenths = Math.round(fraction * 16);

    if (sixteenths === 0) {
        return wholeInches + '"';
    } else if (sixteenths === 16) {
        return (wholeInches + 1) + '"';
    } else {
        // Reduce fraction
        let num = sixteenths;
        let den = 16;
        while (num % 2 === 0 && den % 2 === 0) {
            num /= 2;
            den /= 2;
        }
        return wholeInches + ' ' + num + '/' + den + '"';
    }
}

function updateVisualization(radius, height, topRadius, cornerAngle) {
    // Side view
    const svgSize = 200;
    const padding = 15;
    const drawArea = svgSize - 2 * padding;

    // Scale to fit
    const scale = drawArea / radius;

    // Origin (toe) at bottom-left
    const originX = padding;
    const originY = svgSize - padding;

    // Calculate arc angle
    const alpha = Math.acos(1 - height / radius);

    // Arc end point (top of ramp)
    const arcEndX = originX + topRadius * scale;
    const arcEndY = originY - height * scale;
    const radiusScaled = radius * scale;

    // Arc path from toe to top
    const arcPath = document.getElementById('viz-arc');
    arcPath.setAttribute('d',
        `M ${originX} ${originY} ` +
        `A ${radiusScaled} ${radiusScaled} 0 0 0 ${arcEndX} ${arcEndY}`
    );

    // Center of circle is above the toe
    const centerX = originX;
    const centerY = originY - radius * scale;

    // Radius line from center to midpoint of arc
    const midAlpha = alpha / 2;
    const midArcX = originX + radius * Math.sin(midAlpha) * scale;
    const midArcY = originY - radius * (1 - Math.cos(midAlpha)) * scale;

    const radiusLine = document.getElementById('viz-radius');
    radiusLine.setAttribute('x1', centerX);
    radiusLine.setAttribute('y1', centerY);
    radiusLine.setAttribute('x2', midArcX);
    radiusLine.setAttribute('y2', midArcY);

    // Radius label
    const radiusLabel = document.getElementById('viz-radius-label');
    radiusLabel.setAttribute('x', (centerX + midArcX) / 2 - 10);
    radiusLabel.setAttribute('y', (centerY + midArcY) / 2);

    // Height line (vertical from ground to top of ramp)
    const heightLine = document.getElementById('viz-height');
    heightLine.setAttribute('x1', arcEndX);
    heightLine.setAttribute('y1', originY);
    heightLine.setAttribute('x2', arcEndX);
    heightLine.setAttribute('y2', arcEndY);

    // Height label
    const heightLabel = document.getElementById('viz-height-label');
    heightLabel.setAttribute('x', arcEndX + 5);
    heightLabel.setAttribute('y', (originY + arcEndY) / 2);

    // Top radius line (horizontal from toe to top)
    const topRadiusLine = document.getElementById('viz-top-radius');
    topRadiusLine.setAttribute('x1', originX);
    topRadiusLine.setAttribute('y1', arcEndY);
    topRadiusLine.setAttribute('x2', arcEndX);
    topRadiusLine.setAttribute('y2', arcEndY);

    // Ground line
    const groundLine = document.getElementById('viz-ground');
    groundLine.setAttribute('y1', originY);
    groundLine.setAttribute('y2', originY);

    // Top view
    updateTopView(topRadius, cornerAngle, radius);
}

function updateTopView(topRadius, cornerAngle, transitionRadius) {
    const topView = document.getElementById('top-view');
    const padding = 20;
    const viewSize = 200 - 2 * padding;

    // Toe point at bottom center
    const toeX = 100;
    const toeY = 190;

    // Calculate the bounds we need to show
    // The arc spans from -cornerAngle/2 to +cornerAngle/2 (centered)
    // We need to show the chord endpoints
    const halfAngle = cornerAngle / 2;

    // Chord endpoints at topRadius distance
    const leftX = topRadius * Math.sin(-halfAngle);
    const leftY = -topRadius * Math.cos(-halfAngle);  // negative because Y goes up in our coord
    const rightX = topRadius * Math.sin(halfAngle);
    const rightY = -topRadius * Math.cos(halfAngle);

    // Find bounding box
    const maxX = Math.max(Math.abs(leftX), Math.abs(rightX));
    const maxY = Math.max(Math.abs(leftY), Math.abs(rightY));

    // Scale to fit
    const scaleX = (viewSize / 2) / maxX;
    const scaleY = (viewSize - 20) / Math.max(maxY, 1);
    const scale = Math.min(scaleX, scaleY) * 0.85;

    // Convert to SVG coordinates
    const toSvg = (x, y) => ({
        x: toeX + x * scale,
        y: toeY + y * scale  // y is already negative for "up"
    });

    // Edge lines from toe to chord endpoints
    const leftPoint = toSvg(leftX, leftY);
    const rightPoint = toSvg(rightX, rightY);

    const edgeLeft = document.getElementById('viz-edge-left');
    edgeLeft.setAttribute('x1', toeX);
    edgeLeft.setAttribute('y1', toeY);
    edgeLeft.setAttribute('x2', leftPoint.x);
    edgeLeft.setAttribute('y2', leftPoint.y);

    const edgeRight = document.getElementById('viz-edge-right');
    edgeRight.setAttribute('x1', toeX);
    edgeRight.setAttribute('y1', toeY);
    edgeRight.setAttribute('x2', rightPoint.x);
    edgeRight.setAttribute('y2', rightPoint.y);

    // Arc at top (from leftPoint to rightPoint)
    const scaledRadius = topRadius * scale;
    const largeArc = cornerAngle > Math.PI ? 1 : 0;
    const topArc = document.getElementById('viz-top-arc');
    topArc.setAttribute('d', `M ${leftPoint.x} ${leftPoint.y} A ${scaledRadius} ${scaledRadius} 0 ${largeArc} 1 ${rightPoint.x} ${rightPoint.y}`);

    // Chord line
    const chordLine = document.getElementById('viz-chord');
    chordLine.setAttribute('x1', leftPoint.x);
    chordLine.setAttribute('y1', leftPoint.y);
    chordLine.setAttribute('x2', rightPoint.x);
    chordLine.setAttribute('y2', rightPoint.y);

    // Corner angle arc (small arc near toe point)
    const angleArcRadius = 25;
    const angleStartX = toeX + angleArcRadius * Math.sin(-halfAngle);
    const angleStartY = toeY - angleArcRadius * Math.cos(-halfAngle);
    const angleEndX = toeX + angleArcRadius * Math.sin(halfAngle);
    const angleEndY = toeY - angleArcRadius * Math.cos(halfAngle);

    const cornerAngleArc = document.getElementById('viz-corner-angle');
    const angleArcLarge = cornerAngle > Math.PI ? 1 : 0;
    cornerAngleArc.setAttribute('d', `M ${angleStartX} ${angleStartY} A ${angleArcRadius} ${angleArcRadius} 0 ${angleArcLarge} 1 ${angleEndX} ${angleEndY}`);

    // Angle label
    const angleLabel = document.getElementById('viz-angle-label');
    const labelAngle = 0;  // Point straight up
    angleLabel.setAttribute('x', toeX);
    angleLabel.setAttribute('y', toeY - angleArcRadius - 5);
    angleLabel.setAttribute('text-anchor', 'middle');
    angleLabel.textContent = (cornerAngle * 180 / Math.PI).toFixed(1) + '°';

    // Toe point
    const toe = document.getElementById('viz-toe');
    toe.setAttribute('cx', toeX);
    toe.setAttribute('cy', toeY);
}

function setupHighlighting() {
    const highlightElements = document.querySelectorAll('[data-highlight]');
    const sideView = document.getElementById('side-view');
    const topView = document.getElementById('top-view');

    highlightElements.forEach(el => {
        const highlightClass = 'highlight-' + el.dataset.highlight;

        el.addEventListener('mouseenter', () => {
            sideView.classList.add(highlightClass);
            topView.classList.add(highlightClass);
        });

        el.addEventListener('mouseleave', () => {
            sideView.classList.remove(highlightClass);
            topView.classList.remove(highlightClass);
        });
    });
}
