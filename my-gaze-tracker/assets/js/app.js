const gazePointer = document.getElementById('gaze-pointer');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const debugLog = document.getElementById('debug-console');

// UI Panel Elements
const smoothRange = document.getElementById('smooth-range');
const smoothVal = document.getElementById('smooth-val');
const invertXCheck = document.getElementById('invert-x-check');
const relayTarget = document.getElementById('relay-button-target');
const heatmapCanvas = document.getElementById('heatmap-canvas');
const ctx = heatmapCanvas.getContext('2d');

// Physics / D3-style Relay Position State
let relayX = window.innerWidth / 2;
let relayY = window.innerHeight / 2;
let targetRelayX = window.innerWidth / 2;
let targetRelayY = window.innerHeight / 2;

// Dwell Capacitor State
let dwellProgress = 0;       
let isTriggered = false;
let isCoolingDown = false;
const dwellChargeRate = 3.5; 
const dwellDrainRate = 4.0;  

let invertX = false;
let isTrackingActive = false;

function log(msg) { 
    if(debugLog) debugLog.innerText = "System Log: " + msg; 
}

// Window Size Adaptability
window.addEventListener('resize', () => {
    heatmapCanvas.width = window.innerWidth;
    heatmapCanvas.height = window.innerHeight;
});

// Settings Listeners
window.updateSettings = function() {
    invertX = invertXCheck.checked;
    log(`Config changed: InvertX=${invertX}`);
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

        log("Booting official WebGazer engine...");
        
        // Start WebGazer and set up the gaze listener callback loop
        webgazer.setGazeListener((data, timestamp) => {
            if (!data || !isTrackingActive) return;

            let x = data.x;
            let y = data.y;

            if (invertX) {
                x = window.innerWidth - x;
            }

            processGazeMapping(x, y, timestamp);
        }).begin();

        // Configure WebGazer UI visibility (hide native red dot so we use our custom one)
        webgazer.showPredictionPoints(false);
        webgazer.showVideoPreview(true); // Set to false if you prefer hiding the webcam preview box

        statusText.innerText = "WebGazer active. Click Start Calibration to begin.";
        startBtn.disabled = false;
        log("WebGazer engine initialized successfully.");

    } catch (err) {
        log("Fatal Boot Error: " + err.message);
        statusText.innerText = "Setup stalled. Ensure HTTPS connection.";
        console.error(err);
    }
}

// Calibration Handler (WebGazer handles its own point collection or standard clicks)
window.startCalibration = function(event) {
    if (event) event.stopPropagation();
    startBtn.style.display = 'none';
    statusText.innerText = "Look around the screen and interact to calibrate.";
    
    isTrackingActive = true;
    gazePointer.style.display = 'block';
    relayTarget.classList.add('active-ready');
    log("Gaze tracking and relay activation live.");
};

// --- GAZE MAPPING & D3 COLLISION SIMULATION ---
function processGazeMapping(x, y, timestamp) {
    // Update custom pointer position
    gazePointer.style.left = `${x}px`;
    gazePointer.style.top = `${y}px`;

    // Target destination for the sliding relay button (D3 force style)
    targetRelayX = x;
    targetRelayY = y;

    // Smooth spring interpolation
    relayX += (targetRelayX - relayX) * 0.15;
    relayY += (targetRelayY - relayY) * 0.15;

    // Clamp bounds to keep the button safely on screen
    const margin = 80;
    relayX = Math.max(margin, Math.min(window.innerWidth - margin, relayX));
    relayY = Math.max(margin, Math.min(window.innerHeight - margin, relayY));

    relayTarget.style.left = `${relayX}px`;
    relayTarget.style.top = `${relayY}px`;

    renderHeatmapFootprint(x, y);
    checkRelayActivation();
}

function renderHeatmapFootprint(x, y) {
    ctx.fillStyle = 'rgba(255, 51, 102, 0.04)';
    ctx.beginPath();
    ctx.arc(x, y, 35, 0, 2 * Math.PI);
    ctx.fill();
}

function checkRelayActivation() {
    if (isCoolingDown) return;

    const relayRect = relayTarget.getBoundingClientRect();
    const gazePointerRect = gazePointer.getBoundingClientRect();

    // Check collision overlap between gaze pointer and the button element
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

// --- BLE & HARDWARE WEBHOOK INTEGRATION ---
let bleDevice = null;
//let bleCharacteristic = null; // Declared once globally

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
        log("Connected to Atom Lite via BLE.");
    } catch (err) {
        const statusEl = document.getElementById('connectionStatus');
        if (statusEl) statusEl.innerText = "Status: Failed";
        console.error("BLE Connection error:", err);
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
