const gazePointer = document.getElementById('gaze-pointer');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const debugLog = document.getElementById('debug-console');

// UI Panel Elements
const invertXCheck = document.getElementById('invert-x-check');
const mouseCalibCheck = document.getElementById('mouse-calib-check');
const relayTarget = document.getElementById('relay-button-target');
const gazeGrid = document.getElementById('gaze-grid');
const heatmapCanvas = document.getElementById('heatmap-canvas');
const ctx = heatmapCanvas.getContext('2d');

// Dwell Capacitor State
let dwellProgress = 0;       
let isTriggered = false;
let isCoolingDown = false;
const dwellChargeRate = 3.5; 
const dwellDrainRate = 4.0;  

let invertX = false;
let isTrackingActive = false;

// Calibration State Variables
let currentCalibIndex = 0;

// D3 HUD Elements
let d3Svg, hudLine;

function log(msg) { 
    if(debugLog) debugLog.innerText = "System Log: " + msg; 
}

window.addEventListener('resize', () => {
    heatmapCanvas.width = window.innerWidth;
    heatmapCanvas.height = window.innerHeight;
    if (d3Svg) {
        d3Svg.attr('width', window.innerWidth).attr('height', window.innerHeight);
    }
});

window.updateSettings = function() {
    invertX = invertXCheck.checked;
    log(`Config changed: InvertX=${invertX}`);
};

window.updateMouseRegression = function() {
    const useMouse = mouseCalibCheck ? mouseCalibCheck.checked : false;
    if (typeof webgazer !== 'undefined' && typeof webgazer.applyMouseEventRegression === 'function') {
        webgazer.applyMouseEventRegression(useMouse);
        log(`Continuous mouse calibration: ${useMouse ? 'ENABLED' : 'DISABLED'}`);
    }
};

window.toggleSettings = function() {
    const panel = document.getElementById('settings-panel');
    if (panel) panel.style.display = (panel.style.display === 'block') ? 'none' : 'block';
};

window.clearHeatmap = function() {
    ctx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
    log("Heatmap surface buffer cleared.");
};

// --- INITIALIZE OFFICIAL WEBGAZER ENGINE ---
async function initSystem() {
    try {
        heatmapCanvas.width = window.innerWidth;
        heatmapCanvas.height = window.innerHeight;

        initD3Hud();

        if (typeof webgazer === 'undefined') {
            throw new Error("WebGazer library is not loaded. Check script tags or CDNs.");
        }

        log("Booting official WebGazer engine...");
        
        await webgazer.setGazeListener((data, timestamp) => {
            if (!data || !isTrackingActive) return;

            let x = data.x;
            let y = data.y;

            if (invertX) {
                x = window.innerWidth - x;
            }

            processGazeMapping(x, y, timestamp);
        }).begin();

        const useMouse = mouseCalibCheck ? mouseCalibCheck.checked : false;
        if (typeof webgazer.applyMouseEventRegression === 'function') {
            webgazer.applyMouseEventRegression(useMouse);
        }

        webgazer.showPredictionPoints(false);
        webgazer.showVideoPreview(true);

        statusText.innerText = "WebGazer ready. Click Start Calibration.";
        startBtn.disabled = false;
        log(`WebGazer engine initialized successfully. Mouse calibration: ${useMouse}`);

    } catch (err) {
        log("Fatal Boot Error: " + err.message);
        statusText.innerText = "Setup stalled. Check console.";
        console.error(err);
    }
}

// --- D3.JS HUD VECTOR TETHER SETUP ---
function initD3Hud() {
    if (typeof d3 === 'undefined') return;

    d3Svg = d3.select('body')
        .append('svg')
        .attr('id', 'd3-hud-overlay')
        .attr('width', window.innerWidth)
        .attr('height', window.innerHeight)
        .style('position', 'fixed')
        .style('top', '0')
        .style('left', '0')
        .style('pointer-events', 'none')
        .style('z-index', '988');

    hudLine = d3Svg.append('line')
        .attr('class', 'gaze-hud-tether')
        .attr('stroke', 'rgba(0, 255, 153, 0.3)')
        .attr('stroke-width', '2')
        .attr('stroke-dasharray', '4,4');
}

// --- CALIBRATION ROUTINE ---
window.startCalibration = function(event) {
    if (event) event.stopPropagation();
    startBtn.style.display = 'none';
    statusText.innerText = "Calibration Mode: Click each red dot 5 times while looking at it.";
    log("Starting interactive 9-point calibration routine.");
    setupCalibrationGrid();
};

function setupCalibrationGrid() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    
    const coords = [
        {x: w * 0.1, y: h * 0.1}, {x: w * 0.5, y: h * 0.1}, {x: w * 0.9, y: h * 0.1},
        {x: w * 0.1, y: h * 0.5}, {x: w * 0.5, y: h * 0.5}, {x: w * 0.9, y: h * 0.5},
        {x: w * 0.1, y: h * 0.9}, {x: w * 0.5, y: h * 0.9}, {x: w * 0.9, y: h * 0.9}
    ];

    currentCalibIndex = 0;
    spawnCalibrationPoint(coords);
}

function spawnCalibrationPoint(coords) {
    if (currentCalibIndex >= coords.length) {
        const dot = document.getElementById('calib-dot');
        if (dot) dot.style.display = 'none';
        
        isTrackingActive = true;
        gazePointer.style.display = 'block';
        if (gazeGrid) gazeGrid.style.display = 'block';
        statusText.innerText = "Calibration Complete! Precision Grid & Relay active.";
        log("Calibration complete. Precision grid active.");
        return;
    }

    const pt = coords[currentCalibIndex];
    const dot = document.getElementById('calib-dot');
    if (!dot) return;

    dot.style.left = `${pt.x}px`;
    dot.style.top = `${pt.y}px`;
    dot.style.display = 'flex';
    dot.style.justifyContent = 'center';
    dot.style.alignItems = 'center';
    
    let clickCount = 0;
    dot.innerText = "5";

    dot.onclick = (e) => {
        e.stopPropagation();
        clickCount++;
        webgazer.recordScreenPosition(pt.x, pt.y, 'click');
        dot.innerText = `${5 - clickCount}`;
        
        if (clickCount >= 5) {
            dot.onclick = null;
            dot.style.display = 'none';
            currentCalibIndex++;
            setTimeout(() => spawnCalibrationPoint(coords), 300);
        }
    };
}

// --- GAZE MAPPING & IMPLICIT SELF-CALIBRATION ---
function processGazeMapping(x, y, timestamp) {
    const currentGazeX = parseFloat(gazePointer.style.left) || x;
    const currentGazeY = parseFloat(gazePointer.style.top) || y;
    const smoothedGazeX = currentGazeX + (x - currentGazeX) * 0.2;
    const smoothedGazeY = currentGazeY + (y - currentGazeY) * 0.2;

    gazePointer.style.left = `${smoothedGazeX}px`;
    gazePointer.style.top = `${smoothedGazeY}px`;

    renderHeatmapFootprint(smoothedGazeX, smoothedGazeY);
    checkRelayActivation(smoothedGazeX, smoothedGazeY);
}

function renderHeatmapFootprint(x, y) {
    ctx.fillStyle = 'rgba(255, 51, 102, 0.03)';
    ctx.beginPath();
    ctx.arc(x, y, 35, 0, 2 * Math.PI);
    ctx.fill();
}

async function checkRelayActivation(gazeX, gazeY) {
    if (!relayTarget) return;

    const relayRect = relayTarget.getBoundingClientRect();
    const relayCenterX = relayRect.left + relayRect.width / 2;
    const relayCenterY = relayRect.top + relayRect.height / 2;

    // Update D3 HUD Tether Line
    if (hudLine && isTrackingActive) {
        hudLine
            .attr('x1', gazeX)
            .attr('y1', gazeY)
            .attr('x2', relayCenterX)
            .attr('y2', relayCenterY);
    }

    // Implicit Micro-Calibration for Outer Grid Anchors
    const anchors = document.querySelectorAll('.anchor-node');
    anchors.forEach(anchor => {
        const rect = anchor.getBoundingClientRect();
        if (
            gazeX >= rect.left && gazeX <= rect.right &&
            gazeY >= rect.top && gazeY <= rect.bottom
        ) {
            const targetX = rect.left + rect.width / 2;
            const targetY = rect.top + rect.height / 2;
            if (typeof webgazer !== 'undefined' && typeof webgazer.recordScreenPosition === 'function') {
                webgazer.recordScreenPosition(targetX, targetY, 'cluster');
            }
        }
    });

    if (isCoolingDown) return;

    // Center Emergency Relay Collision Check
    const padding = 30;
    const isCollidingCenter = (
        gazeX >= (relayRect.left - padding) && gazeX <= (relayRect.right + padding) &&
        gazeY >= (relayRect.top - padding) && gazeY <= (relayRect.bottom + padding)
    );

    if (isCollidingCenter) {
        dwellProgress = Math.min(100, dwellProgress + dwellChargeRate);
        relayTarget.classList.add('gaze-hover');
        if (hudLine) {
            hudLine.attr('stroke', '#ff3366').attr('stroke-width', '4').attr('stroke-dasharray', null);
        }
    } else {
        dwellProgress = Math.max(0, dwellProgress - dwellDrainRate);
        relayTarget.classList.remove('gaze-hover');
        if (hudLine) {
            hudLine.attr('stroke', 'rgba(0, 255, 153, 0.3)').attr('stroke-width', '2').attr('stroke-dasharray', '4,4');
        }
    }

    if (dwellProgress >= 100 && !isTriggered) {
        isTriggered = true;
        isCoolingDown = true;
        
        relayTarget.classList.remove('gaze-hover');
        relayTarget.classList.add('triggered');
        relayTarget.innerText = "💥 RELAY ACTIVE!";
        log("Dwell reached 100%! Firing hardware trigger...");

        await triggerHardwareRelay();

        setTimeout(() => {
            dwellProgress = 0;
            isTriggered = false;
            isCoolingDown = false;
            relayTarget.classList.remove('triggered');
            relayTarget.innerText = "RELAY SWITCH [0%]";
            log("Relay capacitor reset.");
        }, 1500);
    } else if (!isTriggered) {
        const percent = Math.floor(dwellProgress);
        relayTarget.innerText = `RELAY SWITCH [${percent}%]`;
    }
}

window.onload = () => {
    setTimeout(initSystem, 1000);
};

// --- HARDWARE BLE & WEBHOOK TRIGGER ---
async function triggerHardwareRelay() {
    if (typeof bleCharacteristic !== 'undefined' && bleCharacteristic) {
        try {
            const encoder = new TextEncoder();
            await bleCharacteristic.writeValue(encoder.encode("RELAY_TOGGLE"));
            log("💥 Relay command sent successfully over BLE!");
            return;
        } catch (error) {
            console.error("BLE write failed:", error);
            log("BLE write error: " + error.message);
            bleCharacteristic = null;
        }
    } else {
        log("Warning: BLE characteristic is not initialized/connected.");
    }
    
    try {
        const targetUrl = 'http://atom-relay-node.local/buttons/web_pulse_button/press';
        const img = new Image();
        img.src = `${targetUrl}?timestamp=${Date.now()}`;
        log("Atom Lite hardware webhook dispatched.");
    } catch (err) {
        log("Webhook Error: Failed to reach Atom Lite device.");
    }
}
