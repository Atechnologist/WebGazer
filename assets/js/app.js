<script>
const videoElement = document.getElementById('webcam');
const calibDot = document.getElementById('calib-dot');
const gazePointer = document.getElementById('gaze-pointer');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const debugLog = document.getElementById('debug-console');

let calibrationStep = 0;
let isCalibrated = false;

// Fixed Target screen anchors mapping sequence coordinates
const screenTargets = [
    { x: 40, y: 40 },
    { x: window.innerWidth - 40, y: 40 },
    { x: 40, y: window.innerHeight - 40 },
    { x: window.innerWidth - 40, y: window.innerHeight - 40 }
];

function log(msg) { debugLog.innerText = "System Log: " + msg; }

async function initSystem() {
    try {
        log("Checking for WebGazer deployment configuration...");
        if (typeof webgazer === 'undefined') {
            throw new Error("WebGazer engine not found. Ensure script tags match dist paths.");
        }
        
        log("Configuring background tracking parameters...");
        
        // 1. Initialise WebGazer directly instead of managing custom loops
        await webgazer.setRegression('ridge') // Use WebGazer's powerful built-in ridge regression
            .setGazeListener((data, clock) => {
                if (isCalibrated && data) {
                    // Update pointer with smoothed coordinates out of the engine
                    gazePointer.style.left = `${data.x}px`;
                    gazePointer.style.top = `${data.y}px`;
                }
            })
            .saveDataAcrossSessions(false)
            .begin();

        // 2. Hide WebGazer's default canvas elements so your custom layout shows
        webgazer.showVideoPreview(false)
                 .showPredictionPoints(false);

        log("WebGazer engine active. Camera streaming synced.");
        statusText.innerText = "Hold your tablet or phone steady";
        startBtn.disabled = false;

    } catch (err) {
        log("Boot Error: " + err.message);
        statusText.innerText = "Setup stalled. Check browser console logs.";
        console.error(err);
    }
}

function startCalibration() {
    startBtn.style.display = 'none';
    statusText.innerText = "Stare at the red dot and TAP the screen to capture.";
    calibrationStep = 0;
    
    // Clear any previous regression points to ensure fresh calculations
    webgazer.clearData();
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
        log("Gaze tracking operational.");
    }
}

// Global window event listener mapping taps directly to the WebGazer system
const triggerEvent = 'ontouchstart' in window ? 'touchstart' : 'click';
window.addEventListener(triggerEvent, (e) => {
    if (calibrationStep >= 4 || isCalibrated || calibDot.style.display === 'none') return;
    if (e.target.id === 'start-btn') return;

    // Grab the current point coordinate targets
    const currentPoint = screenTargets[calibrationStep];

    log(`Calibrating point ${calibrationStep + 1} at X: ${currentPoint.x}, Y: ${currentPoint.y}`);
    
    // Feed the data straight into WebGazer's native mapping array
    webgazer.recordScreenPosition(currentPoint.x, currentPoint.y, 'click');

    calibrationStep++;
    showNextCalibrationDot();
});

// Initialise application sequence on load window
window.onload = initSystem;
</script>
