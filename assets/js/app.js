<script>
const videoElement = document.getElementById('webcam');
const calibDot = document.getElementById('calib-dot');
const gazePointer = document.getElementById('gaze-pointer');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const debugLog = document.getElementById('debug-console');

let model = null;
let currentFeatures = null;
let calibrationStep = 0;
let isCalibrated = false;

const screenTargets = [
    { x: 40, y: 40 },
    { x: window.innerWidth - 40, y: 40 },
    { x: 40, y: window.innerHeight - 40 },
    { x: window.innerWidth - 40, y: window.innerHeight - 40 }
];
let eyeGrid = { tl: null, tr: null, bl: null, br: null };
const smoothingBuffer = [];
const SMOOTH_FRAMES = 5;

function log(msg) { debugLog.innerText = "System Log: " + msg; }

async function initSystem() {
    try {
        log("Checking for TensorFlow deployment...");
        if (typeof tf === 'undefined') {
            throw new Error("Master script blocked by network rules.");
        }
        
        log("Booting hardware web acceleration...");
        await tf.ready(); 
        log(`Active Engine: ${tf.getBackend()}`);
        
        log("Downloading neural face mesh patterns...");
        model = await facemesh.load({ maxFaces: 1 });
        
        log("Opening front camera feed...");
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, 
            audio: false 
        });
        videoElement.srcObject = stream;
        
        videoElement.onloadedmetadata = () => {
            log("Camera stream active. Pipeline verified.");
            statusText.innerText = "Hold your tablet or phone steady";
            startBtn.disabled = false;
            trackFrameLoop();
        };
    } catch (err) {
        log("Boot Error: " + err.message);
        statusText.innerText = "Setup stalled. Ensure page runs via HTTPS.";
    }
}

async function trackFrameLoop() {
    if (model && videoElement.readyState >= 2) {
        try {
            const predictions = await model.estimateFaces(videoElement);
            
            if (predictions.length === 0) {
                log("Searching for eyes / face context...");
            } else {
                log(isCalibrated ? "Gaze tracking active." : "Tracking active. Ready to calibrate.");
                const mesh = predictions[0].scaledMesh;
                
                // Adjusted landmark matrices for robust eye center tracking
                // 33: Left eye outer corner, 133: Left eye inner corner, 159: Upper eyelid midpoint
                const outer = mesh[33]; 
                const inner = mesh[133];
                const iris = mesh[159]; 

                if (outer && inner && iris) {
                    const eyeCenterX = (inner[0] + outer[0]) / 2;
                    const eyeCenterY = (inner[1] + outer[1]) / 2;
                    const eyeWidth = Math.hypot(outer[0] - inner[0], outer[1] - inner[1]);
                    
                    // Normalize horizontal/vertical pupil offset relative to current eye size
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
            log("Frame Skip: " + e.message);
        }
    }
    requestAnimationFrame(trackFrameLoop);
}

function startCalibration() {
    startBtn.style.display = 'none';
    statusText.innerText = "Stare at the red dot and TAP the screen to capture.";
    calibrationStep = 0;
    showNextCalibrationDot();
}

function showNextCalibrationDot() {
    if (calibrationStep < 4) {
        calibDot.style.display = 'block';
        calibDot.style.left = `${screenTargets[calibrationStep].x}px`;
        calibDot.style.top = `${screenTargets[calibrationStep].y}px`;
    } else {
        calibDot.style.display = 'none';
        document.getElementById('ui-overlay').style.display = 'none';
        isCalibrated = true;
        gazePointer.style.display = 'block';
    }
}

const triggerEvent = 'ontouchstart' in window ? 'touchstart' : 'click';
window.addEventListener(triggerEvent, (e) => {
    if (calibrationStep >= 4 || isCalibrated || calibDot.style.display === 'none') return;
    if (e.target.id === 'start-btn') return;
    if (!currentFeatures) return; // Prevent capture if tracking frame is dropped

    const keys = ['tl', 'tr', 'bl', 'br'];
    eyeGrid[keys[calibrationStep]] = { x: currentFeatures[0], y: currentFeatures[1] };
    
    calibrationStep++;
    showNextCalibrationDot();
});

function processGazeMapping(ex, ey) {
    const { tl, tr, bl, br } = eyeGrid;

    // Use safe linear interpolation based on calibration corners
    const tx = (ex - tl.x) / ((tr.x - tl.x) || 0.001);
    const ty = (ey - tl.y) / ((bl.y - tl.y) || 0.001);

    const u = Math.max(0, Math.min(1, tx));
    const v = Math.max(0, Math.min(1, ty));

    // Bilinear map extrapolation onto target viewport pixel space
    let targetX = (1 - u) * (1 - v) * screenTargets[0].x + u * (1 - v) * screenTargets[1].x + (1 - u) * v * screenTargets[2].x + u * v * screenTargets[3].x;
    let targetY = (1 - u) * (1 - v) * screenTargets[0].y + u * (1 - v) * screenTargets[1].y + (1 - u) * v * screenTargets[2].y + u * v * screenTargets[3].y;

    // Apply moving average smoothing configuration
    smoothingBuffer.push({ x: targetX, y: targetY });
    if (smoothingBuffer.length > SMOOTH_FRAMES) smoothingBuffer.shift();

    const avgX = smoothingBuffer.reduce((sum, p) => sum + p.x, 0) / smoothingBuffer.length;
    const avgY = smoothingBuffer.reduce((sum, p) => sum + p.y, 0) / smoothingBuffer.length;

    // Render tracker point updates directly onto view layer
    gazePointer.style.left = `${avgX}px`;
    gazePointer.style.top = `${avgY}px`;
}

// Initialise application sequence on load window
window.onload = initSystem;
</script>
