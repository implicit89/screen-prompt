const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
    getSettings: () => ipcRenderer.invoke('settings:get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('settings:save-settings', settings)
});