const selectionBox = document.getElementById('selection-box');
let isDrawing = false;
let startX, startY;

// Get the device pixel ratio for accurate coordinate scaling
// This is important because renderer coordinates are in CSS pixels,
// while desktopCapturer and sharp expect physical pixels.
const dpr = window.devicePixelRatio || 1;

document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Only main mouse button
    isDrawing = true;
    startX = e.clientX;
    startY = e.clientY;
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block';
    e.preventDefault(); // Prevent any default drag behavior
});

document.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const newX = Math.min(currentX, startX);
    const newY = Math.min(currentY, startY);

    selectionBox.style.left = newX + 'px';
    selectionBox.style.top = newY + 'px';
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
    e.preventDefault();
});

document.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || !isDrawing) return;
    isDrawing = false;
    selectionBox.style.display = 'none';

    const rect = {
        x: parseFloat(selectionBox.style.left) * dpr,
        y: parseFloat(selectionBox.style.top) * dpr,
        width: parseFloat(selectionBox.style.width) * dpr,
        height: parseFloat(selectionBox.style.height) * dpr
    };

    // Only send if selection has a valid area
    if (rect.width > 0 && rect.height > 0) {
        window.captureAPI.sendCoordinates(rect);
    } else {
        // If it was just a click or tiny drag, close without capturing
        window.captureAPI.closeWindow();
    }
    e.preventDefault();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        window.captureAPI.closeWindow();
    }
});

// Prevent context menu on the overlay
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Initial focus for Escape key to work immediately
window.focus();