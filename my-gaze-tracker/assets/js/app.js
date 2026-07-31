const videoElement = document.getElementById('webcam');
const calibDot = document.getElementById('calib-dot');
const gazePointer = document.getElementById('gaze-pointer');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const debugLog = document.getElementById('debug-console');

let calibrationStep = 0;
let isCalibrated = false;

// The ONLY place screenTargets should be declared and set
const screenTargets = [
    { x: Math.round(window.innerWidth * 0.15), y: Math.round(window.innerHeight * 0.15) }, // Top Left (15% in)
    { x: Math.round(window.innerWidth * 0.85), y: Math.round(window.innerHeight * 0.15) }, // Top Right
    { x: Math.round(window.innerWidth * 0.15), y: Math.round(window.innerHeight * 0.85) }, // Bottom Left
    { x: Math.round(window.innerWidth * 0.85), y: Math.round(window.innerHeight * 0.85) }  // Bottom Right
];

function log(msg) { debugLog.innerText = "System Log: " + msg; }

async function initSystem() {
    let checkAttempts = 0;
    while (typeof webgazer === 'undefined') {
        checkAttempts++;
        log(`Connecting to core module engine... (Attempt ${checkAttempts}/20)`);
        if (checkAttempts > 20) {
            log("Boot Error: webgazer.js failed to load. Check browser network tab (F12).");
            statusText.innerText = "Setup stalled. File missing or 404 error.";
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 500)); 
    }

    try {
        log("Configuring background tracking parameters...");
        await webgazer.setRegression('ridge')
            .setGazeListener((data, clock) => {
                if (isCalibrated && data) {
                    gazePointer.style.left = `${data.x}px`;
                    gazePointer.style.top = `${data.y}px`;
                }
            })
            .saveDataAcrossSessions(false)
            .begin();

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

function startCalibration(event) {
    if (event) event.stopPropagation(); // Blocks button tap propagation
    
    startBtn.style.display = 'none';
    statusText.innerText = "Stare at the red dot and TAP the screen to capture.";
    calibrationStep = 0;
    
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

const triggerEvent = 'ontouchstart' in window ? 'touchstart' : 'click';
window.addEventListener(triggerEvent, (e) => {
    if (calibrationStep >= 4 || isCalibrated || calibDot.style.display === 'none') return;
    if (e.target.id === 'start-btn') return;

    const currentPoint = screenTargets[calibrationStep];
    log(`Calibrating point ${calibrationStep + 1} at X: ${currentPoint.x}, Y: ${currentPoint.y}`);
    webgazer.recordScreenPosition(currentPoint.x, currentPoint.y, 'click');

    calibrationStep++;
    showNextCalibrationDot();
});

window.onload = () => {
    setTimeout(initSystem, 1000);
};
