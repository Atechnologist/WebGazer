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
const gravityWindowSize = 90; 
let relayX = window.innerWidth / 2;
let relayY = window.innerHeight / 2;

// Dwell Capacitor & Trigger State Properties
let dwellProgress = 0;       
let isTriggered = false;
let isCoolingDown = false;
const dwellChargeRate = 2.5; 
const dwellDrainRate = 1.5;  

// Core Architecture Properties
let model = null;
let currentFeatures = null;
let calibrationStep = 0;
let isCalibrated = false;
let calibrationMode = 5; // Configurable: change to 9 for 9-point calibration
let screenTargets = [];
let calibrationSamples = []; // Replaces rigid 4-point eyeGrid

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

// Setup multi-point calibration layout
function setupCalibrationTargets(mode = 5) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const padX = w * 0.15;
    const padY = h * 0.15;

    if (mode === 5) {
        screenTargets = [
            { x: padX, y: padY },                 // Top-Left
            { x: w - padX, y: padY },             // Top-Right
            { x: w / 2, y: h / 2 },               // Center
            { x: padX, y: h - padY },             // Bottom-Left
            { x: w - padX, y: h - padY }          // Bottom-Right
        ];
    } else {
        screenTargets = [
            { x: padX, y: padY },                 // Top-Left
            { x: w / 2, y: padY },               // Top-Center
            { x: w - padX, y: padY },             // Top-Right
            { x: padX, y: h / 2 },               // Mid-Left
            { x: w / 2, y: h / 2 },               // Center
            { x: w - padX, y: h / 2 },           // Mid-Right
            { x: padX, y: h - padY },             // Bottom-Left
            { x: w / 2, y: h - padY },           // Bottom-Center
            { x: w - padX, y: h - padY }          // Bottom-Right
        ];
    }
}

function log(msg) { debugLog.innerText = "System Log: " + msg; }

window.addEventListener('resize', () => {
    heatmapCanvas.width = window.innerWidth;
    heatmapCanvas.height = window.innerHeight;
    setupCalibrationTargets(calibrationMode);
});

window.updateSettings = function() {
    smoothingFrames = parseInt(smoothRange.value);
    smoothVal.innerText = `${smoothingFrames} frames`;
    invertX = invertXCheck.checked;
    log(`Config changed: Smoothing=${smoothingFrames}, InvertX=${invertX}`);
};

window.toggleSettings = function() {
    const panel = document.getElementById('settings-panel');
    panel.style.display = (panel.style.display === 'block') ? 'none' : 'block';
};

window.clearHeatmap = function() {
    ctx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
    log("Heatmap surface buffer cleared.");
};

async function initSystem() {
    try {
        heatmapCanvas.width = window.innerWidth;
        heatmapCanvas.height = window.innerHeight;
        setupCalibrationTargets(calibrationMode);

        log("Evaluating TensorFlow engine deployment...");
        if (typeof tf === 'undefined' || typeof facemesh === 'undefined') {
            throw new Error("Core script files blocked by network rules.");
        }
        
        await tf.ready();
        log(`Active Engine Backend: ${tf.getBackend()}`);
        
        model = await facemesh.load({ maxFaces: 1 });
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, 
            audio: false 
        });
        videoElement.srcObject = stream;
        
        videoElement.onloadedmetadata = () => {
            log("Camera pipeline active. Application verified.");
            statusText.innerText = "Hold steady and click Start Calibration";
            startBtn.disabled = false;
            trackFrameLoop();
        };
    } catch (err) {
        log("Fatal Boot Error: " + err.message);
        statusText.innerText = "Setup stalled. Ensure page runs via secure HTTPS link.";
        console.error(err);
    }
}

async function trackFrameLoop() {
    if (model && videoElement.readyState >= 2) {
        try {
            const predictions = await model.estimateFaces(videoElement);
            
            if (predictions.length > 0) {
                const mesh = predictions[0].scaledMesh;
                const outer = mesh[33]; 
                const inner = mesh[133];
                const iris = mesh[159]; 

                if (outer && inner && iris) {
                    const eyeCenterX = (inner[0] + outer[0]) / 2;
                    const eyeCenterY = (inner[1] + outer[1]) / 2;
                    const eyeWidth = Math.hypot(outer[0] - inner[0], outer[1] - inner[1]);
                    
                    currentFeatures = [
                        (iris[0] - eyeCenterX) / eyeWidth,
                        (iris[1] - eyeCenterY) / eyeWidth
                    ];

                    if (isCalibrated) {
                        processGazeMapping(currentFeatures[0], currentFeatures[1]);
                    }
                }
            }
        } catch (e) {
            log("Frame Processing Skip: " + e.message);
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
    calibrationSamples = []; // Reset dataset storage
    showNextCalibrationDot();
};

function showNextCalibrationDot() {
    if (calibrationStep < screenTargets.length) {
        calibDot.style.display = 'block';
        calibDot.style.left = `${screenTargets[calibrationStep].x}px`;
        calibDot.style.top = `${screenTargets[calibrationStep].y}px`;
        log(`Displaying calibration point ${calibrationStep + 1} of ${screenTargets.length}`);
    } else {
        calibDot.style.display = 'none';
        document.getElementById('ui-overlay').style.display = 'none';
        isCalibrated = true;
        gazePointer.style.display = 'block';
        relayTarget.classList.add('active-ready');
        log("Calibration complete. Gaze tracking active.");
    }
}

const triggerEvent = 'ontouchstart' in window ? 'touchstart' : 'click';
window.addEventListener(triggerEvent, (e) => {
    if (calibrationStep >= screenTargets.length || isCalibrated || calibDot.style.display === 'none') return;
    if (e.target.id === 'start-btn' || e.target.id === 'settings-btn' || e.target.closest('#settings-panel')) return;
    if (!currentFeatures) return;

    const target = screenTargets[calibrationStep];
    calibrationSamples.push({
        targetX: target.x,
        targetY: target.y,
        featureX: currentFeatures[0],
        featureY: currentFeatures[1]
    });
    
    log(`Captured Calibration Sample ${calibrationStep + 1}`);
    calibrationStep++;
    showNextCalibrationDot();
});

// Robust Weighted Regression Mapping (Inverse Distance Weighting) for multi-point targets
function processGazeMapping(ex, ey, timestamp) {
    if (calibrationSamples.length === 0) return;

    let totalWeight = 0;
    let sumX = 0;
    let sumY = 0;
    const p = 2.0; // Distance decay power

    for (let sample of calibrationSamples) {
        const dx = ex - sample.featureX;
        const dy = ey - sample.featureY;
        const dist = Math.hypot(dx, dy);

        if (dist === 0) {
            sumX = sample.targetX;
            sumY = sample.targetY;
            totalWeight = 1;
            break;
        }

        const weight = 1 / Math.pow(dist, p);
        totalWeight += weight;
        sumX += sample.targetX * weight;
        sumY += sample.targetY * weight;
    }

    let targetX = sumX / totalWeight;
    let targetY = sumY / totalWeight;

    if (invertX) {
        targetX = window.innerWidth - targetX;
    }

    const avgX = filterX.filter(targetX, timestamp);
    const avgY = filterY.filter(targetY, timestamp);

    gazePointer.style.left = `${avgX}px`;
    gazePointer.style.top = `${avgY}px`;

    gravityBuffer.push({ x: avgX, y: avgY });
    if (gravityBuffer.length >= gravityWindowSize) {
        gravityBuffer.shift();
        const centerMassX = gravityBuffer.reduce((sum, p) => sum + p.x, 0) / gravityBuffer.length;
        const centerMassY = gravityBuffer.reduce((sum, p) => sum + p.y, 0) / gravityBuffer.length;
        
        relayX += (centerMassX - relayX) * 0.05;
        relayY += (centerMassY - relayY) * 0.05;
        
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
        }, 2500);
    } else if (!isTriggered) {
        const percent = Math.floor(dwellProgress);
        relayTarget.innerText = `RELAY SWITCH [${percent}%]`;
    }
}

window.onload = () => {
    setTimeout(initSystem, 1000);
};

let bleDevice, bleCharacteristic;

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
        console.log("Connected to Atom Lite via BLE");
    } catch (err) {
        const statusEl = document.getElementById('connectionStatus');
        if (statusEl) statusEl.innerText = "Status: Failed";
        console.error("BLE Connection error:", err);
    }
}

async function triggerHardwareRelay() {
    if (!bleCharacteristic) {
        console.warn("BLE not connected. Please pair device first.");
        return;
    }

    try {
        const encoder = new TextEncoder();
        await bleCharacteristic.writeValue(encoder.encode("RELAY_TOGGLE"));
        console.log("💥 Relay trigger command sent over BLE");
    } catch (err) {
        console.error("Failed to write BLE characteristic:", err);
    }
}
// --- Diagnostic Testing Logic ---

// 1. Fixed Target Dwell Timer Logic
const fixedBtn = document.getElementById('test-fixed-btn');
const statusText = document.getElementById('diagnostic-status');
let dwellTimeAccumulator = 0;
const requiredDwell = 800; // milliseconds required to trigger
let lastFrameTime = performance.now();

function evaluateDiagnostics(gazeX, gazaY) {
    if (!fixedBtn) return;

    const rect = fixedBtn.getBoundingClientRect();
    const isInsideFixed = (
        gazeX >= rect.left && gazeX <= rect.right &&
        gazaY >= rect.top && gazaY <= rect.bottom
    );

    const now = performance.now();
    const deltaTime = now - lastFrameTime;
    lastFrameTime = now;

    if (isInsideFixed) {
        dwellTimeAccumulator += deltaTime;
        const progress = Math.min(100, (dwellTimeAccumulator / requiredDwell) * 100);
        fixedBtn.style.background = `linear-gradient(90deg, #2ed573 ${progress}%, #333 ${progress}%)`;
        statusText.innerText = `Status: Fixating... (${Math.round(progress)}%)`;

        if (dwellTimeAccumulator >= requiredDwell) {
            statusText.innerText = "Status: SUCCESS! Fixed Target Triggered.";
            fixedBtn.style.borderColor = "#2ed573";
            // Optional: Reset after success
            setTimeout(() => { dwellTimeAccumulator = 0; }, 1000);
        }
    } else {
        dwellTimeAccumulator = Math.max(0, dwellTimeAccumulator - (deltaTime * 1.5)); // Decay faster when looking away
        const progress = (dwellTimeAccumulator / requiredDwell) * 100;
        fixedBtn.style.background = `#333`;
        if (dwellTimeAccumulator === 0) {
            statusText.innerText = "Status: Ready for test (Looking away)";
            fixedBtn.style.borderColor = "#555";
        }
    }
}

// 2. Moving Target Animation Logic (Smooth horizontal sweep)
const movingBtn = document.getElementById('test-moving-btn');
let animationStartTime = performance.now();

function animateMovingTarget(currentTime) {
    if (!movingBtn) return;
    const elapsed = (currentTime - animationStartTime) / 1000; // seconds
    
    // Sine wave movement across the screen width (leaves 100px padding on edges)
    const screenWidth = window.innerWidth - 100;
    const x = Math.sin(elapsed * 1.5) * (screenWidth / 2) + (screenWidth / 2);
    const y = 150 + Math.cos(elapsed * 0.8) * 50; // slight vertical wave

    movingBtn.style.left = `${x}px`;
    movingBtn.style.top = `${y}px`;

    requestAnimationFrame(animateMovingTarget);
}

// Start the moving target animation loop
requestAnimationFrame(animateMovingTarget);
