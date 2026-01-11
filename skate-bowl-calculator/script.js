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

    displayResults(ribs, {
        angleBetweenSupports: fanAngleDeg,
        topRadius: topRadius,
        topChord: topChord
    });
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
        row.innerHTML = `
            <td>${rib.number}</td>
            <td>${formatInches(rib.distanceFromTop)}</td>
            <td>${formatInches(rib.length)}</td>
            <td>${rib.miter.toFixed(1)}°</td>
            <td>${rib.bevel.toFixed(1)}°</td>
        `;
        tbody.appendChild(row);
    });

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

// Calculate on page load with default values
document.addEventListener('DOMContentLoaded', calculateRibs);
