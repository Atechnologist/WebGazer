const videoElement = document.getElementById('webcam');
const calibDot = document.getElementById('calib-dot');
const gazePointer = document.getElementById('gaze-pointer');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const debugLog = document.getElementById('debug-console');

// UI Panel Interactive Elements
const smoothRange = document.getElementById('smooth-range');
const smoothVal = document.getElementById('smooth-val');
const invertXCheck = document.getElementById('invert-x-check');
const relayTarget = document.getElementById('relay-button-target');
const heatmapCanvas = document.getElementById('heatmap-canvas');
const ctx = heatmapCanvas.getContext('2d');

// Gravity Well Dynamic Positioning State
let gravityBuffer = [];
const gravityWindowSize = 45; // Shortened window for faster, more responsive sliding
let relayX = window.innerWidth / 2;
let relayY = window.innerHeight / 2;

// Dwell Capacitor & Trigger State Properties (Speeded up drain/reset)
let dwellProgress = 0;       // 0 to 100%
let isTriggered = false;
let isCoolingDown = false;
const dwellChargeRate = 3.5; // Faster fill speed
const dwellDrainRate = 4.0;  // Much faster drain when looking away so it resets instantly

// Core Architecture Properties
let model = null;
let currentFeatures = null;
let calibrationStep = 0;
let isCalibrated = false;

// Custom Configuration Parameters State
let smoothingFrames = 6;
let invertX = false;

// --- ONE-EURO FILTER GLOBAL INSTANCES ---
class LowPassFilter {
    constructor(alpha, initval = 0) {
        this.y = initval;
        this.s = initval;
        this.initialized = false;
        this.setAlpha(alpha);
    }
    setAlpha(alpha) {
        if (alpha <= 0 || alpha > 1) throw new Error("Alpha must be in (0, 1]");
        this.alpha = alpha;
    }
    filter(value, alpha = this.alpha) {
        if (!this.initialized) {
            this.s = value;
            this.initialized = true;
        } else {
            this.s = this.alpha * value + (1 - this.alpha) * this.s;
        }
        return this.s;
    }
    lastValue() { return this.s; }
}

class OneEuroFilter {
    constructor(freq, mincutoff = 1.0, beta = 0.0, dcutoff = 1.0) {
        this.freq = freq;
        this.mincutoff = mincutoff;
        this.beta = beta;
        this.dcutoff = dcutoff;
        this.x_filter = new LowPassFilter(this.alpha(mincutoff));
        this.dx_filter = new LowPassFilter(this.alpha(dcutoff));
        this.last_time = null;
    }
    alpha(cutoff) {
        const te = 1.0 / this.freq;
        const tau = 1.0 / (2 * Math.PI * cutoff);
        return 1.0 / (1.0 + tau / te);
    }
    filter(value, timestamp = null) {
        if (this.last_time && timestamp) {
            this.freq = 1.0 / Math.max(1e-4, (timestamp - this.last_time) / 1000.0);
        }
        this.last_time = timestamp;
        const prev_x = this.x_filter.lastValue();
        const dx = (value - prev_x) * this.freq;
        const edx = this.dx_filter.filter(dx, this.alpha(this.dcutoff));
        const cutoff = this.mincutoff + this.beta * Math.abs(edx);
        return this.x_filter.filter(value, this.alpha(cutoff));
    }
}

const filterX = new OneEuroFilter(60, 1.0, 0.007, 1.0);
const filterY = new OneEuroFilter(60, 1.0, 0.007, 1.0);

const screenTargets = [
    { x: Math.round(window.innerWidth * 0.15), y: Math.round(window.innerHeight * 0.15) },
    { x: Math.round(window.innerWidth * 0.85), y: Math.round(window.innerHeight * 0.15) },
    { x: Math.round(window.innerWidth * 0.15), y: Math.round(window.innerHeight * 0.85) },
    { x: Math.round(window.innerWidth * 0.85), y: Math.round(window.innerHeight * 0.85) }
];

let eyeGrid = { tl: null, tr: null, bl: null, br: null };

function log(msg) { if(debugLog) debugLog.innerText = "System Log: " + msg; }

window.addEventListener('resize', () => {
    heatmapCanvas.width = window.innerWidth;
    heatmapCanvas.height = window.innerHeight;
});

window.updateSettings = function() {
    smoothingFrames = parseInt(smoothRange.value);
    smoothVal.innerText = `${smoothingFrames} frames`;
    invertX = invertXCheck.checked;
    log(`Config changed: Smoothing=${smoothingFrames}, InvertX=${invertX}`);
};

window.toggleSettings = function() {
    const panel = document.getElementById('settings-panel');
    if (panel) panel.style.display = (panel.style.display === 'block') ? 'none' : 'block';
};

window.clearHeatmap = function() {
    ctx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
    log("Heatmap surface buffer cleared.");
};

async function initSystem() {
    try {
        heatmapCanvas.width = window.innerWidth;
        heatmapCanvas.height = window.innerHeight;

        if (typeof tf === 'undefined' || typeof facemesh === 'undefined') {
            throw new Error("Core script files blocked by network rules.");
        }
        
        await tf.ready();
        model = await facemesh.load({ maxFaces: 1 });
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, 
            audio: false 
        });
        videoElement.srcObject = stream;
        
        videoElement.onloadedmetadata = () => {
            statusText.innerText = "Hold your device steady";
            startBtn.disabled = false;
            trackFrameLoop();
        };
    } catch (err) {
        log("Fatal Boot Error: " + err.message);
        statusText.innerText = "Setup stalled. Ensure page runs via secure HTTPS link.";
    }
}

async function trackFrameLoop() {
    if (model && videoElement.readyState >= 2) {
        try {
            const predictions = await model.estimateFaces(videoElement);
            if (predictions.length > 0) {
                const mesh = predictions[0].scaledMesh;
                const outer = mesh[33], inner = mesh[133], iris = mesh[159]; 

                if (outer && inner && iris) {
                    const eyeCenterX = (inner[0] + outer[0]) / 2;
                    const eyeCenterY = (inner[1] + outer[1]) / 2;
                    const eyeWidth = Math.hypot(outer[0] - inner[0], outer[1] - inner[1]);
                    
                    currentFeatures = [
                        (iris[0] - eyeCenterX) / eyeWidth,
                        (iris[1] - eyeCenterY) / eyeWidth
                    ];

                    if (isCalibrated) {
                        processGazeMapping(currentFeatures[0], currentFeatures[1], performance.now());
                    }
                }
            }
        } catch (e) {
            // Skip frame error cleanly
        }
    }
    requestAnimationFrame(trackFrameLoop);
}

window.startCalibration = function(event) {
    if (event) event.stopPropagation(); 
    startBtn.style.display = 'none';
    statusText.innerText = "Stare at the red dot and TAP the screen to capture.";
    calibrationStep = 0;
    isCalibrated = false;
    showNextCalibrationDot();
};

function showNextCalibrationDot() {
    if (calibrationStep < 4) {
        calibDot.style.display = 'block';
        calibDot.style.left = `${screenTargets[calibrationStep].x}px`;
        calibDot.style.top = `${screenTargets[calibrationStep].y}px`;
    } else {
        calibDot.style.display = 'none';
        const overlay = document.getElementById('ui-overlay');
        if (overlay) overlay.style.display = 'none';
        isCalibrated = true;
        gazePointer.style.display = 'block';
        relayTarget.classList.add('active-ready');
        log("System Gaze Processing active.");
    }
}

const triggerEvent = 'ontouchstart' in window ? 'touchstart' : 'click';
window.addEventListener(triggerEvent, (e) => {
    if (calibrationStep >= 4 || isCalibrated || calibDot.style.display === 'none') return;
    if (e.target.id === 'start-btn' || e.target.id === 'settings-btn' || e.target.closest('#settings-panel')) return;
    if (!currentFeatures) return;

    const keys = ['tl', 'tr', 'bl', 'br'];
    eyeGrid[keys[calibrationStep]] = { x: currentFeatures[0], y: currentFeatures[1] };
    calibrationStep++;
    showNextCalibrationDot();
});

// --- CORRECTED GRAVITY WELL WITH BOUNDING & CORRECT DIRECTION ---
function processGazeMapping(ex, ey, timestamp) {
    const { tl, tr, bl, br } = eyeGrid;
    if (!tl || !tr || !bl || !br) return;

    let tx = (ex - tl.x) / ((tr.x - tl.x) || 0.001);
    let ty = (ey - tl.y) / ((bl.y - tl.y) || 0.001);

    if (invertX) {
        tx = 1 - tx;
    }

    const u = Math.max(0, Math.min(1, tx));
    const v = Math.max(0, Math.min(1, ty));

    let targetX = (1 - u) * (1 - v) * screenTargets[0].x + u * (1 - v) * screenTargets[1].x + (1 - u) * v * screenTargets[2].x + u * v * screenTargets[3].x;
    let targetY = (1 - u) * (1 - v) * screenTargets[0].y + u * (1 - v) * screenTargets[1].y + (1 - u) * v * screenTargets[2].y + u * v * screenTargets[3].y;

    const avgX = filterX.filter(targetX, timestamp);
    const avgY = filterY.filter(targetY, timestamp);

    gazePointer.style.left = `${avgX}px`;
    gazePointer.style.top = `${avgY}px`;

    gravityBuffer.push({ x: avgX, y: avgY });
    if (gravityBuffer.length > gravityWindowSize) {
        gravityBuffer.shift();
    }

    if (gravityBuffer.length >= 15) {
        const centerMassX = gravityBuffer.reduce((sum, p) => sum + p.x, 0) / gravityBuffer.length;
        const centerMassY = gravityBuffer.reduce((sum, p) => sum + p.y, 0) / gravityBuffer.length;
        
        // Corrected pull direction (positive delta matches gaze vector naturally)
        relayX += (centerMassX - relayX) * 0.12;
        relayY += (centerMassY - relayY) * 0.12;
        
        // Clamp bounds so the button stays strictly on screen and never goes off-screen
        const margin = 80;
        relayX = Math.max(margin, Math.min(window.innerWidth - margin, relayX));
        relayY = Math.max(margin, Math.min(window.innerHeight - margin, relayY));
        
        relayTarget.style.left = `${relayX}px`;
        relayTarget.style.top = `${relayY}px`;
    }

    renderHeatmapFootprint(avgX, avgY);
    checkRelayActivation(avgX, avgY);
}

function renderHeatmapFootprint(x, y) {
    ctx.fillStyle = 'rgba(255, 51, 102, 0.04)';
    ctx.beginPath();
    ctx.arc(x, y, 35, 0, 2 * Math.PI);
    ctx.fill();
}

function checkRelayActivation(gazeX, gazeY) {
    if (isCoolingDown) return;

    const relayRect = relayTarget.getBoundingClientRect();
    const isGazing = (
        gazeX >= relayRect.left &&
        gazeX <= relayRect.right &&
        gazeY >= relayRect.top &&
        gazeY <= relayRect.bottom
    );

    if (isGazing) {
        dwellProgress = Math.min(100, dwellProgress + dwellChargeRate);
        relayTarget.classList.add('gaze-hover');
    } else {
        // Fast drain rate guarantees quick capacitor reset when looking away
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
        }, 1500); // Shorter cooldown window
    } else if (!isTriggered) {
        const percent = Math.floor(dwellProgress);
        relayTarget.innerText = `RELAY SWITCH [${percent}%]`;
    }
}

window.onload = () => {
    setTimeout(initSystem, 1000);
};

let bleDevice = null;
let bleCharacteristic = null;

async function connectBLE() {
    try {
        const statusEl = document.getElementById('connectionStatus');
        if (statusEl) statusEl.innerText = "Status: Scanning...";

        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'atom-relay-node' }],
            optionalServices: ['12345678-1234-1234-1234-1234567890ab']
        });

        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService('12345678-1234-1234-1234-1234567890ab');
        bleCharacteristic = await service.getCharacteristic('87654321-4321-4321-4321-ba9876543210');

        if (statusEl) statusEl.innerText = "Status: Connected";
    } catch (err) {
        const statusEl = document.getElementById('connectionStatus');
        if (statusEl) statusEl.innerText = "Status: Failed";
    }
}

async function triggerHardwareRelay() {
    if (bleCharacteristic) {
        try {
            const encoder = new TextEncoder();
            await bleCharacteristic.writeValue(encoder.encode("RELAY_TOGGLE"));
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
