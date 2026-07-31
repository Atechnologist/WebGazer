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

// Core Architecture Properties
let detector = null;
let currentFeatures = null;
let calibrationStep = 0;
let isCalibrated = false;

// Custom Configuration Parameters State
let smoothingFrames = 6;
let invertX = false;

// Interactive Percentage Inset Coordinates 
const screenTargets = [
    { x: Math.round(window.innerWidth * 0.15), y: Math.round(window.innerHeight * 0.15) }, // Top Left
    { x: Math.round(window.innerWidth * 0.85), y: Math.round(window.innerHeight * 0.15) }, // Top Right
    { x: Math.round(window.innerWidth * 0.15), y: Math.round(window.innerHeight * 0.85) }, // Bottom Left
    { x: Math.round(window.innerWidth * 0.85), y: Math.round(window.innerHeight * 0.85) }  // Bottom Right
];

// Linear Algebra Mapping Interpolation Matrix Grid Coordinates
let eyeGrid = { tl: null, tr: null, bl: null, br: null };
const smoothingBuffer = [];

function log(msg) { debugLog.innerText = "System Log: " + msg; }

// Window Size Adaptability Adjuster Configuration
window.addEventListener('resize', () => {
    heatmapCanvas.width = window.innerWidth;
    heatmapCanvas.height = window.innerHeight;
});

// Settings Control Panel Interactivity Listeners
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

// Initialisation Pipeline Routine Execution
async function initSystem() {
    try {
        // Match width and height parameters against active display environment boundaries
        heatmapCanvas.width = window.innerWidth;
        heatmapCanvas.height = window.innerHeight;

        log("Evaluating TensorFlow script stack deployment...");
        if (typeof tf === 'undefined' || typeof faceLandmarksDetection === 'undefined') {
            throw new Error("Core TensorFlow modules blocked or failed CDN download pipelines.");
        }
        
        log("Booting hardware web acceleration backend...");
        await tf.ready();
        
        log("Compiling MediaPipe Face Mesh neural pattern matrix...");
        // Loads the updated high-accuracy faceMesh model framework via global scopes
        detector = await faceLandmarksDetection.createDetector(
            faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh, 
            { runtime: 'mediapipe', solutionPath: 'https://jsdelivr.net', maxFaces: 1 }
        );
        
        log("Connecting to video capture stream pipeline...");
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, 
            audio: false 
        });
        videoElement.srcObject = stream;
        
        videoElement.onloadedmetadata = () => {
            log("Hardware channels operational. Environment verified.");
            statusText.innerText = "Hold your tablet or phone steady";
            startBtn.disabled = false;
            trackFrameLoop();
        };
    } catch (err) {
        log("Fatal Error: " + err.message);
        statusText.innerText = "Setup stalled. Ensure page runs via secure HTTPS pipeline.";
        console.error(err);
    }
}

// Processing Execution Tracking Context Frames Loop
async function trackFrameLoop() {
    if (detector && videoElement.readyState >= 2) {
        try {
            const faces = await detector.estimateFaces(videoElement, { flipHorizontal: false });
            
            if (faces.length === 0) {
                log("Searching for tracking profile landmarks context...");
            } else {
                // MediaPipe Keypoint Index Parsing Maps: 
                // 33 = Left eye outer corner, 133 = Left eye inner corner, 468 = Pupil/Iris center point
                const keypoints = faces[0].keypoints;
                const outer = keypoints[33]; 
                const inner = keypoints[133];
                const iris = keypoints[468]; 

                if (outer && inner && iris) {
                    const eyeCenterX = (inner.x + outer.x) / 2;
                    const eyeCenterY = (inner.y + outer.y) / 2;
                    const eyeWidth = Math.hypot(outer.x - inner.x, outer.y - inner.y);
                    
                    // Isolate normalized mathematical metrics representing gaze vector offsets
                    currentFeatures = [
                        (iris.x - eyeCenterX) / eyeWidth,
                        (iris.y - eyeCenterY) / eyeWidth
                    ];

                    if (isCalibrated) {
                        processGazeMapping(currentFeatures[0], currentFeatures[1]);
                    } else {
                        log("Tracking active. Ready for point initialization mapping calibration.");
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
    if (event) event.stopPropagation(); // FIXED: Blocks button click event bubbling down to first target tap!
    
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
        log(`Displaying dot ${calibrationStep + 1} for positioning calibration loop.`);
    } else {
        calibDot.style.display = 'none';
        document.getElementById('ui-overlay').style.display = 'none';
        isCalibrated = true;
        gazePointer.style.display = 'block';
        log("System Gaze Processing active.");
    }
}

// Capturing Interactive Event Trigger Maps
const triggerEvent = 'ontouchstart' in window ? 'touchstart' : 'click';
window.addEventListener(triggerEvent, (e) => {
    if (calibrationStep >= 4 || isCalibrated || calibDot.style.display === 'none') return;
    if (e.target.id === 'start-btn' || e.target.id === 'settings-btn' || e.target.closest('#settings-panel')) return;
    if (!currentFeatures) return; // Drop capture inputs if the tracking context is missing

    const keys = ['tl', 'tr', 'bl', 'br'];
    eyeGrid[keys[calibrationStep]] = { x: currentFeatures[0], y: currentFeatures[1] };
    
    log(`Captured Point ${calibrationStep + 1} Matrix mapping values.`);
    calibrationStep++;
    showNextCalibrationDot();
});

// Mathematical Coordinate Normalization Transformation Layer Map Engine
function processGazeMapping(ex, ey) {
    const { tl, tr, bl, br } = eyeGrid;

    // Linear mapping calculations across interpolation points matrix
    let tx = (ex - tl.x) / ((tr.x - tl.x) || 0.001);
    let ty = (ey - tl.y) / ((bl.y - tl.y) || 0.001);

    // Apply X-Axis Inversion constraint toggles directly if selected inside properties layout
    if (invertX) {
        tx = 1 - tx;
    }

    const u = Math.max(0, Math.min(1, tx));
    const v = Math.max(0, Math.min(1, ty));

    // Bilinear vector interpolation equation calculating pixel results across space
    let targetX = (1 - u) * (1 - v) * screenTargets[0].x + u * (1 - v) * screenTargets[1].x + (1 - u) * v * screenTargets[2].x + u * v * screenTargets[3].x;
    let targetY = (1 - u) * (1 - v) * screenTargets[0].y + u * (1 - v) * screenTargets[1].y + (1 - u) * v * screenTargets[2].y + u * v * screenTargets[3].y;

    // Add calculations into tracking buffer array
    smoothingBuffer.push({ x: targetX, y: targetY });
    while (smoothingBuffer.length > smoothingFrames) {
        smoothingBuffer.shift();
    }

    // Process average results extracting smooth pointer rendering updates
    const avgX = smoothingBuffer.reduce((sum, p) => sum + p.x, 0) / smoothingBuffer.length;
    const avgY = smoothingBuffer.reduce((sum, p) => sum + p.y, 0) / smoothingBuffer.length;

    // Update pointer element tracking parameters on view layers
    gazePointer.style.left = `${avgX}px`;
    gazePointer.style.top = `${avgY}px`;

    // Process and draw the alpha heatmap footprints overlay track
    renderHeatmapFootprint(avgX, avgY);

    // Evaluate Relay Interactivity Trigger collision states
    checkRelayActivation(avgX, avgY);
}

function renderHeatmapFootprint(x, y) {
    ctx.fillStyle = 'rgba(255, 51, 102, 0.04)'; // Subtle alpha value to allow blending build effects
    ctx.beginPath();
    ctx.arc(x, y, 35, 0, 2 * Math.PI);
    ctx.fill();
}

function checkRelayActivation(gazeX, gazeY) {
    const relayRect = relayTarget.getBoundingClientRect();
    
    // Check if the current gaze vectors fall inside the target button borders
    const isGazing = (
        gazeX >= relayRect.left &&
        gazeX <= relayRect.right &&
        gazeY >= relayRect.top &&
        gazeY <= relayRect.bottom
    );

    if (isGazing) {
        relayTarget.style.background = '#00ffcc';
        relayTarget.style.color = '#111';
        relayTarget.innerText = "RELAY ACTIVE [100%]";
    } else {
        relayTarget.style.background = 'transparent';
        relayTarget.style.color = '#00ffcc';
        relayTarget.innerText = "RELAY SWITCH [0%]";
    }
}

// Delayed initialization setup execution mapping routines on window initialization context
window.onload = () => {
    setTimeout(initSystem, 1000);
};
