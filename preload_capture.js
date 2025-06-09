const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('captureAPI', {
    sendCoordinates: (rect) => ipcRenderer.send('capture:coords', rect),
    closeWindow: () => ipcRenderer.send('capture:close'),
    // It's better to handle Escape key directly in the renderer for immediate response
});