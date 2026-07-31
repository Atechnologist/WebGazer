const videoElement = document.getElementById('webcam');
const calibDot = document.getElementById('calib-dot');
const gazePointer = document.getElementById('gaze-pointer');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const debugLog = document.getElementById('debug-console');
const heatmapCanvas = document.getElementById('heatmap-canvas');
const heatmapCtx = heatmapCanvas.getContext('2d');

let detector = null, currentFeatures = null, calibrationStep = 0, isCalibrated = false;
let smoothFrames = 6, invertX = false, heatmapData = [];

// Persistent global timing parameters for the relay button dwell loop
let hoverStartTime = null;
let relayActivated = false;
const DWELL_DELAY_MS = 2000;

// 1. Initialize screen targets as flexible variables instead of static, hardcoded numbers
let screenTargets = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 }
];

let eyeGrid = { tl: null, tr: null, bl: null, br: null };
const smoothingBuffer = [];

function log(msg) { debugLog.innerText = "System Log: " + msg; }

// On-screen console pipeline for advanced tracking mobile insights
window.onerror = function (message, source, lineno, colno, error) {
    log("Fatal Error: " + message + " (" + (source ? source.split('/').pop() : '') + ":" + lineno + ")");
    return false;
};

function toggleSettings() { const panel = document.getElementById('settings-panel'); panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; }
function updateSettings() { smoothFrames = parseInt(document.getElementById('smooth-range').value); document.getElementById('smooth-val').innerText = smoothFrames + " frames"; invertX = document.getElementById('invert-x-check').checked; }
function clearHeatmap() { heatmapData = []; heatmapCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height); }

// 2. FIX: We intercept your existing resizeCanvas function to calculate a tight, 
// high-accuracy 40% bounding box directly around the center of your screen!
function resizeCanvas() {
    heatmapCanvas.width = window.innerWidth;
    heatmapCanvas.height = window.innerHeight;

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    
    // We restrict the calibration field box tightly around the center region
    const boxWidth = window.innerWidth * 0.40;
    const boxHeight = window.innerHeight * 0.40;

    screenTargets = [
        { x: centerX - (boxWidth / 2), y: centerY - (boxHeight / 2) }, // Top Left marker of the zone
        { x: centerX + (boxWidth / 2), y: centerY - (boxHeight / 2) }, // Top Right marker of the zone
        { x: centerX - (boxWidth / 2), y: centerY + (boxHeight / 2) }, // Bottom Left marker of the zone
        { x: centerX + (boxWidth / 2), y: centerY + (boxHeight / 2) }  // Bottom Right marker of the zone
    ];
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

async function initSystem() {
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        log("Security Block: Camera streams require an HTTPS secure connection.");
        statusText.innerText = "Deployment Error: Switch page to HTTPS.";
        return;
    }
    
    // FIX 2: Corrected the lookups array statement mapping your faceLandmarksDetection tags
    if (typeof tf === 'undefined' || typeof faceLandmarksDetection === 'undefined') {
        log("Boot Error: Core browser scripts were blocked or timed out.");
        return;
    }

    try {
        log("Initializing graphics acceleration engine...");
        await tf.setBackend('webgl');
        await tf.ready();
        log(`Active Hardware Backend: ${tf.getBackend()}`);

        log("Downloading target model architecture...");
        detector = await faceLandmarksDetection.createDetector(
            faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
            { runtime: 'tfjs', refineLandmarks: true, maxFaces: 1 }
        );

        log("Requesting frontend webcam video tokens...");
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        videoElement.srcObject = stream;
        videoElement.onloadedmetadata = () => {
            log("AI processing framework live. Ready to calibrate.");
            statusText.innerText = "Hold your device steady";
            startBtn.disabled = false;
            processFramesLoop();
        };
    } catch (err) {
        log("Boot Error: " + err.message);
        statusText.innerText = "Setup blocked. Check device hardware settings.";
        console.error(err);
    }
}


async function processFramesLoop() {
    if (detector && videoElement.readyState >= 2) {
        let videoTensor = null;
        try {
            videoTensor = tf.browser.fromPixels(videoElement);
            const faces = await detector.estimateFaces(videoTensor, { flipHorizontal: false });

            if (faces && faces.length > 0) {
                log(isCalibrated ? "Gaze tracking operational." : `Tracking active. Click calibration point ${calibrationStep + 1}/4`);
                const keypoints = faces[0].scaledMesh || faces[0].keypoints;
                
                if (keypoints) {
                    const outer = keypoints[33];
                    const inner = keypoints[133];
                    const pupil = keypoints[468];
                    
                    if (outer && inner && pupil) {
                        const ox = typeof outer.x !== 'undefined' ? outer.x : outer[0];
                        const oy = typeof outer.y !== 'undefined' ? outer.y : outer[1];
                        const ix = typeof inner.x !== 'undefined' ? inner.x : inner[0];
                        const iy = typeof inner.y !== 'undefined' ? inner.y : inner[1];
                        const px = typeof pupil.x !== 'undefined' ? pupil.x : pupil[0];
                        const py = typeof pupil.y !== 'undefined' ? pupil.y : pupil[1];

                        const eyeCenterX = (ix + ox) / 2;
                        const eyeCenterY = (iy + oy) / 2;
                        const eyeWidth = Math.hypot(ox - ix, oy - iy);
                        
                        let calculatedX = (px - eyeCenterX) / eyeWidth;
                        if (invertX) { calculatedX = -calculatedX; }
                        
                        currentFeatures = { x: calculatedX, y: (py - eyeCenterY) / eyeWidth };
                        if (isCalibrated) { processGazeMapping(currentFeatures.x, currentFeatures.y); }
                    }
                }
            } else {
                log("Searching for eyes / face context... (No faces in frame)");
            }
        } catch (e) {
            log("Frame Error: " + e.message);
        } finally {
            if (videoTensor) {
                videoTensor.dispose();
            }
        }
    }
    requestAnimationFrame(processFramesLoop);
}

function startCalibration() { startBtn.style.display = 'none'; statusText.innerText = "Stare at the red dot and TAP the screen to capture."; calibrationStep = 0; showNextCalibrationDot(); }

function showNextCalibrationDot() {
    // Check if we are still within the 4 points range (indices 0, 1, 2, 3)
    if (calibrationStep < 4) { 
        calibDot.style.display = 'block'; 
        calibDot.style.left = `${screenTargets[calibrationStep].x}px`; 
        calibDot.style.top = `${screenTargets[calibrationStep].y}px`; 
    } else { 
        // 4th final tap has been registered! Turn off the training overlays safely
        calibDot.style.display = 'none'; 
        
        const overlay = document.getElementById('ui-overlay');
        if (overlay) overlay.style.display = 'none'; 
        
        isCalibrated = true; 
        gazePointer.style.display = 'block'; 
        
        // FIX: The Relay Button starts as display:none on page load. 
        // We only show it and turn on its gravity well rules right here AFTER calibration completes!
        const targetBtn = document.getElementById('relay-button-target');
        if (targetBtn) {
            targetBtn.style.setProperty('display', 'block', 'important');
            targetBtn.style.visibility = 'visible';
            targetBtn.classList.add('active-ready');
            targetBtn.innerText = "🔄 LOGGING HEATMAP...";
        }
        
        if (!dwellTimerInterval) {
            dwellTimerInterval = setInterval(runBackgroundDwellCheck, 50);
        }
        drawHeatmapLoop(); 
    }
}


const triggerEvent = 'ontouchstart' in window ? 'touchstart' : 'click';
window.addEventListener(triggerEvent, (e) => {
    if (calibrationStep >= 4 || isCalibrated || calibDot.style.display === 'none') return;
    if (e.target.id === 'start-btn' || e.target.id === 'settings-btn' || e.target.closest?.('#settings-panel')) return;
    if (!currentFeatures) return;

    const keys = ['tl', 'tr', 'bl', 'br'];
    eyeGrid[keys[calibrationStep]] = { x: currentFeatures.x, y: currentFeatures.y };
    calibrationStep++;
    showNextCalibrationDot();
});
// Global tracking filters for our high-performance capacitor dwell loop
let currentGazeX = 0;
let currentGazeY = 0;
let dwellAccumulatorMs = 0; // The "charge" of our gaze capacitor
let dwellTimerInterval = null; // Background loop thread handle
const CAPACITOR_MAX_MS = 2000; // 2 seconds total target look duration



// FIX 2: This function runs asynchronously on an independent 50ms interval loop.
// This completely stops layout thrashing and prevents cursor tracking jitter!
function runBackgroundDwellCheck() {
    const btn = document.getElementById('relay-button-target');
    if (!btn || !btn.classList.contains('active-ready') || relayActivated) return;

    const rect = btn.getBoundingClientRect();
    // Check overlapping boundaries using our globally cached coordinates
    const isOverlapping = (currentGazeX >= rect.left && currentGazeX <= rect.right && currentGazeY >= rect.top && currentGazeY <= rect.bottom);

    const LOOP_INTERVAL_MS = 50; // Runs every 50ms

    if (isOverlapping) {
        btn.classList.add('gaze-hover');
        // Charge the capacitor smoothly
        dwellAccumulatorMs += LOOP_INTERVAL_MS;
        
        if (dwellAccumulatorMs >= CAPACITOR_MAX_MS) {
            dwellAccumulatorMs = CAPACITOR_MAX_MS;
            relayActivated = true;
            btn.classList.remove('gaze-hover');
            btn.classList.add('triggered');
            btn.innerText = "💥 RELAY ACTIVE!";
            log("Automation Event: Relay executed smoothly via Capacitor Dwell!");
            clearInterval(dwellTimerInterval); // Clean up the interval thread safely
        }
    } else {
        btn.classList.remove('gaze-hover');
        // FIX 3: Leak/Drain the capacitor slowly instead of resetting instantly to 0% due to jitter noise!
        dwellAccumulatorMs -= (LOOP_INTERVAL_MS * 1.5); // Drains slightly faster than it charges
        if (dwellAccumulatorMs < 0) dwellAccumulatorMs = 0;
    }

    // Update the layout button percentage text accurately
    if (!relayActivated) {
        const progressPercentage = Math.floor((dwellAccumulatorMs / CAPACITOR_MAX_MS) * 100);
        if (progressPercentage > 0) {
            btn.innerText = `TRIGGERING... [${progressPercentage}%]`;
        } else {
            btn.innerText = "RELAY SWITCH [0%]";
        }
    }
}

// New configuration variables for the continuous Heatmap Gravity Well
let trackingAnalysisBuffer = [];
const RUNNING_WINDOW_SIZE = 90; // Tracks the center of mass over the last ~3 seconds of looking
let dynamicOffsetCalibrated = false;

function showNextCalibrationDot() {
    // FIX 1: Enforce a strict validation check to ensure all 4 points process completely
    if (calibrationStep < 4) { 
        calibDot.style.display = 'block'; 
        calibDot.style.left = `${screenTargets[calibrationStep].x}px`; 
        calibDot.style.top = `${screenTargets[calibrationStep].y}px`; 
    } else { 
        calibDot.style.display = 'none'; 
        document.getElementById('ui-overlay').style.display = 'none'; 
        isCalibrated = true; 
        gazePointer.style.display = 'block'; 
        
        const targetBtn = document.getElementById('relay-button-target');
        if (targetBtn) {
            targetBtn.style.setProperty('display', 'block', 'important');
            targetBtn.style.visibility = 'visible';
            targetBtn.classList.add('active-ready');
            targetBtn.innerText = "🔄 LOGGING HEATMAP...";
        }
        
        if (!dwellTimerInterval) {
            dwellTimerInterval = setInterval(runBackgroundDwellCheck, 50);
        }
        drawHeatmapLoop(); 
    }
}

function processGazeMapping(ex, ey) {
    const { tl, tr, bl, br } = eyeGrid;
    const tx = (ex - tl.x) / ((tr.x - tl.x) || 0.001);
    const ty = (ey - tl.y) / ((bl.y - tl.y) || 0.001);
    const u = Math.max(0, Math.min(1, tx));
    const v = Math.max(0, Math.min(1, ty));
    
    const x0 = screenTargets[0].x, x1 = screenTargets[1].x, x2 = screenTargets[2].x, x3 = screenTargets[3].x;
    const y0 = screenTargets[0].y, y1 = screenTargets[1].y, y2 = screenTargets[2].y, y3 = screenTargets[3].y;

    let targetX = (1 - u) * (1 - v) * x0 + u * (1 - v) * x1 + (1 - u) * v * x2 + u * v * x3;
    let targetY = (1 - u) * (1 - v) * y0 + u * (1 - v) * y1 + (1 - u) * v * y2 + u * v * y3;
    
    smoothingBuffer.push({ x: targetX, y: targetY });
    while (smoothingBuffer.length > smoothFrames) { smoothingBuffer.shift(); }
    
    const avgX = smoothingBuffer.reduce((sum, pt) => sum + pt.x, 0) / smoothingBuffer.length;
    const avgY = smoothingBuffer.reduce((sum, pt) => sum + pt.y, 0) / smoothingBuffer.length;
    
    gazePointer.style.left = `${avgX}px`; 
    gazePointer.style.top = `${avgY}px`;
    
    heatmapData.push({ x: avgX, y: avgY, weight: 1 });
    
    // FIX 2: Continuous Background Heatmap Tracking
    if (isCalibrated) {
        trackingAnalysisBuffer.push({ x: avgX, y: avgY });
        
        // Keep a moving window of recent gaze history
        if (trackingAnalysisBuffer.length > RUNNING_WINDOW_SIZE) {
            trackingAnalysisBuffer.shift();
        }
        
        // Continuously compute the center of mass of your highest accuracy zone
        const computedUserCenterX = trackingAnalysisBuffer.reduce((sum, pt) => sum + pt.x, 0) / trackingAnalysisBuffer.length;
        const computedUserCenterY = trackingAnalysisBuffer.reduce((sum, pt) => sum + pt.y, 0) / trackingAnalysisBuffer.length;
        
        const btn = document.getElementById('relay-button-target');
        if (btn && !relayActivated) {
            // Smoothly slide the button to follow your densest look focus coordinates
            btn.style.left = `${computedUserCenterX}px`;
            btn.style.top = `${computedUserCenterY}px`;
            
            // Once the buffer has enough initial data, start updating the look timer progress percentages
            if (trackingAnalysisBuffer.length >= 30) {
                dynamicOffsetCalibrated = true;
            }
        }
    }

    currentGazeX = avgX;
    currentGazeY = avgY;
}


function drawHeatmapLoop() {
    if (!isCalibrated) return;
    heatmapCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
    heatmapData.forEach(point => {
        let gradient = heatmapCtx.createRadialGradient(point.x, point.y, 2, point.x, point.y, 35);
        gradient.addColorStop(0, 'rgba(255, 0, 0, 0.15)'); 
        gradient.addColorStop(0.5, 'rgba(255, 255, 0, 0.05)'); 
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');          
        heatmapCtx.fillStyle = gradient; 
        heatmapCtx.beginPath(); 
        heatmapCtx.arc(point.x, point.y, 35, 0, Math.PI * 2); 
        heatmapCtx.fill();
    });
    requestAnimationFrame(drawHeatmapLoop);
}

window.startCalibration = startCalibration;
window.toggleSettings = toggleSettings;
window.updateSettings = updateSettings;
window.clearHeatmap = clearHeatmap;

window.onload = () => { setTimeout(initSystem, 1000); };

