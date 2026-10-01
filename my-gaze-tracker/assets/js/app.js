const gazePointer = document.getElementById('gaze-pointer');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const debugLog = document.getElementById('debug-console');

// UI Panel Elements
const invertXCheck = document.getElementById('invert-x-check');
const mouseCalibCheck = document.getElementById('mouse-calib-check');
const relayTarget = document.getElementById('relay-button-target');
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
let calibrationPoints = [];
let currentCalibIndex = 0;

function log(msg) { 
    if(debugLog) debugLog.innerText = "System Log: " + msg; 
}

window.addEventListener('resize', () => {
    heatmapCanvas.width = window.innerWidth;
    heatmapCanvas.height = window.innerHeight;
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

        if (typeof webgazer === 'undefined') {
            throw new Error("WebGazer library is not loaded. Check your HTML script tag or ad-blockers.");
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

        // Respect initial checkbox setting on boot for continuous mouse regression
        const useMouse = mouseCalibCheck ? mouseCalibCheck.checked : false;
        if (typeof webgazer.applyMouseEventRegression === 'function') {
            webgazer.applyMouseEventRegression(useMouse);
        }

        // Keep video preview active for user feedback, hide default prediction dots
        webgazer.showPredictionPoints(false);
        webgazer.showVideoPreview(true);

        statusText.innerText = "WebGazer ready. Click Start Calibration.";
        startBtn.disabled = false;
        log(`WebGazer engine initialized successfully. Mouse calibration: ${useMouse}`);

    } catch (err) {
        log("Fatal Boot Error: " + err.message);
        statusText.innerText = "Setup stalled. Ensure HTTPS/localhost and check console.";
        console.error(err);
    }
}

// --- OFFICIAL WEBGAZER STYLE 9-POINT CALIBRATION ---
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
        if (relayTarget) relayTarget.style.display = 'flex';
        statusText.innerText = "Calibration Complete! Relay active.";
        log("Calibration complete. Tracking live.");
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

// --- GAZE MAPPING & GRAVITY WELL FOLLOWER ---
// Keeps a rolling buffer of recent gaze points to calculate a stable center of mass
let gazeGravityBuffer = [];
const maxBufferSize = 15;

function processGazeMapping(x, y, timestamp) {
    // 1. Smooth the green gaze pointer position
    const currentGazeX = parseFloat(gazePointer.style.left) || x;
    const currentGazeY = parseFloat(gazePointer.style.top) || y;
    const smoothedGazeX = currentGazeX + (x - currentGazeX) * 0.2;
    const smoothedGazeY = currentGazeY + (y - currentGazeY) * 0.2;

    gazePointer.style.left = `${smoothedGazeX}px`;
    gazePointer.style.top = `${smoothedGazeY}px`;

    // 2. Add points to the gravity buffer for center-of-mass calculation
    gazeGravityBuffer.push({x: smoothedGazeX, y: smoothedGazeY});
    if (gazeGravityBuffer.length > maxBufferSize) {
        gazeGravityBuffer.shift();
    }

    // 3. Compute the center of mass (the "gravity well") from the buffer
    let avgX = gazeGravityBuffer.reduce((sum, pt) => sum + pt.x, 0) / gazeGravityBuffer.length;
    let avgY = gazeGravityBuffer.reduce((sum, pt) => sum + pt.y, 0) / gazeGravityBuffer.length;

    // 4. Make the Relay Button smoothly drift toward this center of mass instead of chasing raw jittery coordinates
    if (relayTarget) {
        const currentRelayX = parseFloat(relayTarget.style.left) || window.innerWidth / 2;
        const currentRelayY = parseFloat(relayTarget.style.top) || window.innerHeight / 2;
        
        const smoothRelayX = currentRelayX + (avgX - currentRelayX) * 0.08;
        const smoothRelayY = currentRelayY + (avgY - currentRelayY) * 0.08;

        // Boundary clamping so it never runs away off-screen
        const margin = 100;
        const boundedX = Math.max(margin, Math.min(window.innerWidth - margin, smoothRelayX));
        const boundedY = Math.max(margin, Math.min(window.innerHeight - margin, smoothRelayY));

        relayTarget.style.left = `${boundedX}px`;
        relayTarget.style.top = `${boundedY}px`;
    }

    renderHeatmapFootprint(smoothedGazeX, smoothedGazeY);
    checkRelayActivation();
}
function renderHeatmapFootprint(x, y) {
    ctx.fillStyle = 'rgba(255, 51, 102, 0.04)';
    ctx.beginPath();
    ctx.arc(x, y, 35, 0, 2 * Math.PI);
    ctx.fill();
}

function checkRelayActivation() {
    if (isCoolingDown || !relayTarget) return;

    const relayRect = relayTarget.getBoundingClientRect();
    const gazePointerRect = gazePointer.getBoundingClientRect();

    const isColliding = !(
        gazePointerRect.right < relayRect.left || 
        gazePointerRect.left > relayRect.right || 
        gazePointerRect.bottom < relayRect.top || 
        gazePointerRect.top > relayRect.bottom
    );

    if (isColliding) {
        dwellProgress = Math.min(100, dwellProgress + dwellChargeRate);
        relayTarget.classList.add('gaze-hover');
    } else {
        dwellProgress = Math.max(0, dwellProgress - dwellDrainRate);
        relayTarget.classList.remove('gaze-hover');
    }

    if (dwellProgress >= 100 && !isTriggered) {
        isTriggered = true;
        isCoolingDown = true;
        
        relayTarget.classList.remove('gaze-hover');
        relayTarget.classList.add('triggered');
        relayTarget.innerText = "💥 RELAY ACTIVE!";
        log("Relay trigger fired successfully!");

        triggerHardwareRelay();

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

// --- HARDWARE WEBHOOK & BLE TRIGGER FALLBACK ---
async function triggerHardwareRelay() {
    if (typeof window.bleCharacteristic !== 'undefined' && window.bleCharacteristic) {
        try {
            const encoder = new TextEncoder();
            await window.bleCharacteristic.writeValue(encoder.encode("RELAY_TOGGLE"));
            log("💥 Relay command sent over BLE");
            return;
        } catch (err) {
            console.error("BLE write failed, falling back to network webhook:", err);
        }
    }
    
    try {
        const targetUrl = 'http://atom-relay-node.local/buttons/web_pulse_button/press';
        const img = new Image();
        img.src = `${targetUrl}?timestamp=${Date.now()}`;
        log("Hardware webhook dispatched via beacon.");
    } catch (err) {
        log("Webhook Error: Failed to reach ESPHome device.");
    }
}
