const videoElement = document.getElementById('webcam');
const calibDot = document.getElementById('calib-dot');
const gazePointer = document.getElementById('gaze-pointer');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const debugLog = document.getElementById('debug-console');

let faceMeshModel = null;
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
const SMOOTH_FRAMES = 6;

function log(msg) { debugLog.innerText = "System Log: " + msg; }

async function initSystem() {
    try {
        log("Booting native Google FaceMesh engine...");
        
        faceMeshModel = new FaceMesh({
            locateFile: (file) => `https://jsdelivr.net{file}`
        });

        faceMeshModel.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true, // Crucial parameter enabling detailed eye tracking vectors
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        faceMeshModel.onResults(onFaceMeshResults);

        log("Requesting physical webcam streaming tokens...");
        const camera = new Camera(videoElement, {
            onFrame: async () => {
                await faceMeshModel.send({ image: videoElement });
            },
            width: 640,
            height: 480
        });

        await camera.start();
        log("Webcam stream operational. AI pipeline verified.");
        statusText.innerText = "Hold your tablet or phone steady";
        startBtn.disabled = false;

    } catch (err) {
        log("Boot Error: " + err.message);
        statusText.innerText = "Setup stalled. Page must run over HTTPS.";
        console.error(err);
    }
}

function onFaceMeshResults(results) {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        log("Searching for eyes / face context...");
        return;
    }

    log(isCalibrated ? "Gaze tracking operational." : "Tracking active. Ready to calibrate.");
    const landmarks = results.multiFaceLandmarks[0];

    // Targeted high-accuracy facial landmark anchors mapping vectors:
    // Index 33: Left eye outer corner, 133: Left eye inner corner, 468: Left pupil center position
    const outer = landmarks[33];
    const inner = landmarks[133];
    const pupil = landmarks[468];

    if (outer && inner && pupil) {
        const eyeCenterX = (inner.x + outer.x) / 2;
        const eyeCenterY = (inner.y + outer.y) / 2;
        const eyeWidth = Math.hypot(outer.x - inner.x, outer.y - inner.y);

        // Normalize pupil offset deviations relative to changing head positions
        currentFeatures = {
            x: (pupil.x - eyeCenterX) / eyeWidth,
            y: (pupil.y - eyeCenterY) / eyeWidth
        };

        if (isCalibrated) {
            processGazeMapping(currentFeatures.x, currentFeatures.y);
        }
    }
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
    if (!currentFeatures) return; 

    const keys = ['tl', 'tr', 'bl', 'br'];
    eyeGrid[keys[calibrationStep]] = { x: currentFeatures.x, y: currentFeatures.y };
    
    calibrationStep++;
    showNextCalibrationDot();
});

function processGazeMapping(ex, ey) {
    const { tl, tr, bl, br } = eyeGrid;

    // Linear mapping calculations across custom grid calibrations
    const tx = (ex - tl.x) / ((tr.x - tl.x) || 0.001);
    const ty = (ey - tl.y) / ((bl.y - tl.y) || 0.001);

    const u = Math.max(0, Math.min(1, tx));
    const v = Math.max(0, Math.min(1, ty));

    // Bilinear map extrapolation onto target viewport coordinates
    let targetX = (1 - u) * (1 - v) * screenTargets[0].x + u * (1 - v) * screenTargets[1].x + (1 - u) * v * screenTargets[2].x + u * v * screenTargets[3].x;
    let targetY = (1 - u) * (1 - v) * screenTargets[0].y + u * (1 - v) * screenTargets[1].y + (1 - u) * v * screenTargets[2].y + u * v * screenTargets[3].y;

    // Apply moving average smoothing modifications
    smoothingBuffer.push({ x: targetX, y: targetY });
    if (smoothingBuffer.length > SMOOTH_FRAMES) smoothingBuffer.shift();

    const avgX = smoothingBuffer.reduce((sum, p) => sum + p.x, 0) / smoothingBuffer.length;
    const avgY = smoothingBuffer.reduce((sum, p) => sum + p.y, 0) / smoothingBuffer.length;

    // Render coordinates changes directly onto tracker pointer layout layer
    gazePointer.style.left = `${avgX}px`;
    gazePointer.style.top = `${avgY}px`;
}

window.onload = () => {
    setTimeout(initSystem, 1000);
};
