const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('resultAPI', {
    // --- Existing ---
    copyToClipboard: (text) => ipcRenderer.send('result:copy-to-clipboard', text),
    onCopiedFeedback: (callback) => ipcRenderer.on('result:copied-feedback', (_event, message) => callback(message)),
    closeWindow: () => ipcRenderer.send('result:close'),

    // --- Corrected line for Optimized Prompts ---
    requestNewOptimizedPrompt: (targetModel) => ipcRenderer.send('prompt:request-new-optimization', targetModel), // Corrected here

    // Main sends this to populate the prompt area
    onOptimizedPromptReady: (callback) => ipcRenderer.on('prompt:display-optimized-content', (_event, data) => callback(data)), // data: { prompt, selectedModel }
    // Main sends this if an error occurs during optimization
    onPromptOptimizationError: (callback) => ipcRenderer.on('prompt:optimization-error', (_event, errorMessage) => callback(errorMessage))
});