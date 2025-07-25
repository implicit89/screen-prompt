// --- Wait for the DOM to be fully loaded before running any scripts ---
document.addEventListener('DOMContentLoaded', () => {

    // --- Tab Switching Logic ---
    const tabLinks = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');

    function openTab(tabName) {
        // Hide all tab content
        tabContents.forEach(content => {
            content.style.display = 'none';
        });
        // Deactivate all tab links
        tabLinks.forEach(link => {
            link.classList.remove('active');
        });

        // Find the content and link to activate
        const activeContent = document.getElementById(tabName);
        const activeLink = document.querySelector(`.tab-link[data-tab='${tabName}']`);

        if (activeContent) activeContent.style.display = 'block';
        if (activeLink) activeLink.classList.add('active');
    }

    // Add click listeners to each tab button
    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            const tabName = link.getAttribute('data-tab');
            openTab(tabName);
        });
    });
    
    // --- Settings Handling Logic ---
    const openaiApiKeyInput = document.getElementById('openai-api-key');
    const googleApiKeyInput = document.getElementById('google-api-key');
    const localServerUrlInput = document.getElementById('local-server-url');
    const ollamaModelNameInput = document.getElementById('ollama-model-name'); // Added
    const ollamaApiPathInput = document.getElementById('ollama-api-path'); // Added
    const ollamaCustomOptionsInput = document.getElementById('ollama-custom-options'); // Added
    const saveSettingsButton = document.getElementById('save-settings');
    const statusMessage = document.getElementById('status-message');
    const providerRadios = document.querySelectorAll('input[name="api-provider"]');
    const hotkeyInput = document.getElementById('capture-hotkey');
    
    let newHotkeyString = ''; // Variable to hold a newly pressed hotkey combination

    // Load all settings when the window opens
    async function loadSettings() {
        try {
            const settings = await window.settingsAPI.getSettings();
            if (settings) {
                // API Keys and Provider
                openaiApiKeyInput.value = settings.openaiApiKey || '';
                googleApiKeyInput.value = settings.googleApiKey || '';
                localServerUrlInput.value = settings.localServerUrl || 'https://localhost:8000'; // Default value if not set
                ollamaModelNameInput.value = settings.ollamaModelName || 'llava:7b'; // Added, with default
                ollamaApiPathInput.value = settings.ollamaApiPath || '/api/generate'; // Added, with default
                ollamaCustomOptionsInput.value = settings.ollamaCustomOptions || ''; // Added, with default
                const activeProvider = settings.apiProvider || 'openai';
                const radioToCheck = document.getElementById(`provider-${activeProvider}`);
                if (radioToCheck) radioToCheck.checked = true;

                // Hotkey
                hotkeyInput.value = settings.hotkey || '';
                newHotkeyString = settings.hotkey || ''; // Initialize with saved value
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            statusMessage.textContent = 'Error loading settings.';
            statusMessage.className = 'error-message status-message';
        }
    }

    // Save all settings from both tabs
    saveSettingsButton.addEventListener('click', async () => {
        let selectedProvider = 'openai';
        providerRadios.forEach(radio => {
            if (radio.checked) selectedProvider = radio.value;
        });

        const settings = {
            openaiApiKey: openaiApiKeyInput.value.trim(),
            googleApiKey: googleApiKeyInput.value.trim(),
            localServerUrl: localServerUrlInput.value.trim(),
            ollamaModelName: ollamaModelNameInput.value.trim(), // Added
            ollamaApiPath: ollamaApiPathInput.value.trim(), // Added
            ollamaCustomOptions: ollamaCustomOptionsInput.value.trim(), // Added
            apiProvider: selectedProvider,
            hotkey: newHotkeyString || hotkeyInput.value
        };

        try {
            const result = await window.settingsAPI.saveSettings(settings);
            statusMessage.textContent = result.message;
            statusMessage.className = result.success ? 'status-message' : 'error-message status-message';
            // Reload settings to reflect saved state, e.g. if hotkey failed and reverted
            await loadSettings();
        } catch (error) {
            console.error('Error saving settings:', error);
            statusMessage.textContent = `Error: ${error.message}`;
            statusMessage.className = 'error-message status-message';
        } finally {
            newHotkeyString = hotkeyInput.value; // Reset temp hotkey to the now-saved value
            setTimeout(() => { statusMessage.textContent = ''; }, 4000);
        }
    });

    // --- Hotkey Input Logic ---
    hotkeyInput.addEventListener('keydown', (e) => {
        e.preventDefault();
        const keys = [];
        if (e.ctrlKey) keys.push('Ctrl');
        if (e.shiftKey) keys.push('Shift');
        if (e.altKey) keys.push('Alt');
        if (e.metaKey) keys.push('Cmd'); // Use Cmd for macOS consistently in display

        const mainKey = e.key.toUpperCase();
        if (!['CONTROL', 'SHIFT', 'ALT', 'META', 'OS'].includes(mainKey)) {
            const keyMap = { ' ': 'Space', 'ARROWUP': 'Up', 'ARROWDOWN': 'Down', 'ARROWLEFT': 'Left', 'ARROWRIGHT': 'Right' };
            keys.push(keyMap[mainKey] || mainKey);
        }

        if (keys.length > 1 && !['CONTROL', 'SHIFT', 'ALT', 'META', 'OS'].includes(keys[keys.length - 1])) {
            newHotkeyString = keys.join('+');
            hotkeyInput.value = newHotkeyString;
        } else {
            hotkeyInput.value = 'Include a modifier (e.g. Ctrl, Shift)...';
        }
    });

    hotkeyInput.addEventListener('focus', () => { hotkeyInput.value = 'Press a key combination...'; });
    hotkeyInput.addEventListener('blur', () => { 
        // When focus is lost, revert to displaying the currently saved hotkey
        // This prevents the "Press a key..." message from sticking
        loadSettings();
    });

    // --- Initial Actions on Load ---
    openTab('Model'); // Open the first tab by default
    loadSettings(); // Load settings from main process
});