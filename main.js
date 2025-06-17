const {
    app,
    BrowserWindow,
    globalShortcut,
    ipcMain,
    desktopCapturer,
    screen,
    clipboard,
    Menu,
    dialog,
    Tray,
    nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const OpenAI = require('openai');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const keytar = require('keytar');
require('dotenv').config();

// --- Global Variables ---
let tray = null;
let captureWindow = null;
let resultWindow = null;
let settingsWindow = null;
let lastCapturedBase64Image = null;
let lastSelectedGenerator = 'naturallanguage'; // Default generator, will be remembered per session
let store;

const appIconPath = path.join(__dirname, 'assets', 'icon.png');

// --- API Clients Initialization ---
let openai;
let genAI;
let selectedApiProvider; // Declared here, initialized in the function

function initializeApiClients() {
    // Stored settings are now the primary source of truth.
    // .env variables can act as a fallback for initial setup if needed.
    selectedApiProvider = store.get('apiProvider', process.env.API_PROVIDER || 'openai');
    console.log(`Initializing API clients. Active provider set to: ${selectedApiProvider}`);

    const storedOpenAIApiKey = store.get('openaiApiKey', process.env.OPENAI_API_KEY);
    if (storedOpenAIApiKey) {
        openai = new OpenAI({ apiKey: storedOpenAIApiKey });
        if (selectedApiProvider === 'openai') console.log("OpenAI client initialized as ACTIVE provider.");
    } else {
        openai = null;
        if (selectedApiProvider === 'openai') console.warn("Warning: OpenAI API Key is not configured in Settings or .env.");
    }

    const storedGoogleApiKey = store.get('googleApiKey', process.env.GOOGLE_API_KEY);
    if (storedGoogleApiKey) {
        genAI = new GoogleGenerativeAI(storedGoogleApiKey);
        if (selectedApiProvider === 'gemini') console.log("Google Generative AI client initialized as ACTIVE provider.");
    } else {
        genAI = null;
        if (selectedApiProvider === 'gemini') console.warn("Warning: Google (Gemini) API Key is not configured in Settings or .env.");
    }

    if (selectedApiProvider === 'local') {
        const localApiUrl = store.get('localServerUrl');
        if (localApiUrl) {
            console.log(`Local Server is ACTIVE provider. URL: ${localApiUrl}`);
        } else {
            console.warn("Warning: Local Server is selected, but URL is not configured in Settings.");
        }
    }
}

// --- App Lifecycle (app.whenReady) ---
app.whenReady().then(async () => { // It MUST be async

    // First, dynamically import and initialize electron-store
    try {
        const { default: Store } = await import('electron-store');
        store = new Store();
        console.log('electron-store initialized successfully.');
    } catch (error) {
        console.error('Fatal Error: Failed to load electron-store:', error);
        dialog.showErrorBox("Fatal Error", "Failed to load essential storage module (electron-store). The application must close.");
        app.quit();
        return; // Stop further execution
    }

    // Now that 'store' is guaranteed to be available, we can initialize our API clients.
    initializeApiClients();

    // The rest of the startup logic can now proceed safely
    let apiKeyError = null;
    if (selectedApiProvider === 'openai' && !openai) {
        apiKeyError = "OpenAI API key is not configured. Please set it via Settings.";
    } else if (selectedApiProvider === 'gemini' && !genAI) {
        apiKeyError = "Google API key is not configured. Please set it via Settings.";
    } else if (selectedApiProvider === 'local') {
        const localUrl = store.get('localServerUrl');
        if (!localUrl || localUrl.trim() === '') {
            apiKeyError = "Local Server is selected, but its URL is not configured. Please set it via Settings.";
        }
    }

    if (apiKeyError) {
        dialog.showErrorBox("API Configuration Error", `${apiKeyError} AI features may not work.`);
    }

    // This function sets up the hotkey, menu, and tray
    initializeApp();
});

// --- Function to Create Settings Window ---
function createSettingsWindow() {
    // If the window already exists (and is just hidden), show it again
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        console.log('Settings window already exists. Showing and focusing.');
        settingsWindow.show();
        settingsWindow.focus();
        return;
    }

    console.log('Creating new settings window.');
    settingsWindow = new BrowserWindow({
        width: 480,
        height: 400,
        title: 'Settings',
        icon: appIconPath,
        webPreferences: {
            preload: path.join(__dirname, 'preload_settings.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        resizable: true,
        minimizable: false,
        maximizable: false,
        // The following properties help it feel more like a settings dialog
        parent: null, // No parent window
        modal: false, // Not modal, allows interaction with other app parts if any
        show: false, // Don't show immediately, wait for ready-to-show
    });

    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

    // When the window is ready, then show it. This prevents a white flash.
    settingsWindow.once('ready-to-show', () => {
        settingsWindow.show();
    });

    // Intercept the 'close' event
    settingsWindow.on('close', (event) => {
        // Instead of letting the window close, we prevent the default action...
        event.preventDefault();
        // ...and just hide the window instead.
        settingsWindow.hide();
        console.log('Settings window hidden instead of closed.');
    });

    // The 'closed' event will now only fire when the whole app is quitting
    // and the window is force-closed, so we still nullify the variable.
    settingsWindow.on('closed', () => {
        console.log('Settings window has been fully closed.');
        settingsWindow = null;
    });
}

// --- Initialization: Hotkey, Menu, Tray ---
function initializeApp() {
    if (process.platform === 'darwin') {
        app.dock.hide();
    }

    // --- Application Menu ---
    const appMenuTemplate = [
        {
            label: app.name || 'File', // Use app.name on macOS, 'File' on others
            submenu: [
                { label: 'Settings...', click: createSettingsWindow, accelerator: 'CmdOrCtrl+,' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        // You can add an "Edit" menu for copy/paste if needed in settings, though often default works
        // { role: 'editMenu' }
    ];
    if (process.platform !== 'darwin') { // On Windows/Linux, 'File' is more common for the first menu
         appMenuTemplate.unshift({
             label: 'File',
             submenu: [
                { label: 'Settings...', click: createSettingsWindow, accelerator: 'Ctrl+,' },
                { type: 'separator' },
                { role: 'quit' }
            ]
         });
         // Remove the macOS specific app name menu if we added File first
         if (appMenuTemplate[1] && appMenuTemplate[1].label === app.name) {
             appMenuTemplate.splice(1,1);
         }
    }


    const appMenu = Menu.buildFromTemplate(appMenuTemplate);
    Menu.setApplicationMenu(appMenu);

    // --- Global Hotkey Registration (NOW DYNAMIC) ---
    const defaultHotkey = process.platform === 'darwin' ? 'Cmd+F12' : 'Ctrl+F12';
    const hotkey = store.get('captureHotkey', defaultHotkey); // Get stored or default hotkey
     registerGlobalHotkey(hotkey, defaultHotkey);

    // --- System Tray Icon Setup (MODIFIED to add Settings) ---
    const iconName = 'icon.png';
    const iconPath = path.join(__dirname, 'assets', iconName);

    if (!fs.existsSync(iconPath)) { /* ... error handling ... */ }
    else {
        let trayIconImage; // ... (your existing tray icon image loading logic) ...
        try {
            trayIconImage = nativeImage.createFromPath(iconPath);
            if (trayIconImage.isEmpty()) throw new Error('Loaded image is empty.');
            if (process.platform === 'darwin') {
                trayIconImage = trayIconImage.resize({ width: 16, height: 16 });
                trayIconImage.setTemplateImage(true);
            }
        } catch (e) { trayIconImage = null; }


        if (trayIconImage) {
            tray = new Tray(trayIconImage);
            const contextMenu = Menu.buildFromTemplate([
                { label: 'Capture Screen Area', click: () => toggleCaptureWindow() },
                { label: 'Settings...', click: createSettingsWindow }, // Added Settings
                { type: 'separator' },
                { label: 'Quit Screen Prompt', click: () => app.quit() }
            ]);
            tray.setToolTip('Screen Describer');
            tray.setContextMenu(contextMenu);
            console.log('System tray icon initialized with Settings option.');
        } else { /* ... error handling ... */ }
    }
}

// --- New Helper function for registering hotkeys ---
function registerGlobalHotkey(hotkeyToRegister, fallbackHotkey) {
    globalShortcut.unregisterAll(); // Unregister any previous hotkey first
    const registrationSuccess = globalShortcut.register(hotkeyToRegister, toggleCaptureWindow);

    if (!registrationSuccess) {
        console.error(`Failed to register global hotkey: "${hotkeyToRegister}". Trying fallback.`);
        dialog.showErrorBox("Hotkey Registration Failed", `Could not register the hotkey "${hotkeyToRegister}". It may be in use by another application. Reverting to "${fallbackHotkey}".`);
        // Attempt to register the fallback/default hotkey
        globalShortcut.register(fallbackHotkey, toggleCaptureWindow);
        store.set('captureHotkey', fallbackHotkey); // Save the fallback as the current hotkey
    } else {
        console.log(`Global shortcut "${hotkeyToRegister}" registered successfully.`);
    }
}

// --- Capture Window Management ---
function toggleCaptureWindow() {
    let providerError = null;
    if (selectedApiProvider === 'openai' && !openai) {
        providerError = `AI Provider (OpenAI) client not initialized. Check API key.`;
    } else if (selectedApiProvider === 'gemini' && !genAI) {
        providerError = `AI Provider (Gemini) client not initialized. Check API key.`;
    } else if (selectedApiProvider === 'local') {
        const localUrl = store.get('localServerUrl');
        if (!localUrl || localUrl.trim() === '') {
            providerError = `AI Provider (Local Server) URL is not configured. Please set it in Settings.`;
        }
    }
    if (providerError) {
        displayErrorInNewResultWindow(providerError);
        return;
    }

    if (captureWindow) {
        captureWindow.close();
    } else {
        createCaptureWindow();
    }
}

function createCaptureWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    captureWindow = new BrowserWindow({
        x: primaryDisplay.bounds.x, y: primaryDisplay.bounds.y,
        width: primaryDisplay.bounds.width, height: primaryDisplay.bounds.height,
        frame: false, transparent: true, alwaysOnTop: true,
        icon: appIconPath,
        webPreferences: { preload: path.join(__dirname, 'preload_capture.js'), contextIsolation: true, nodeIntegration: false, },
        skipTaskbar: true, focusable: true,
    });
    captureWindow.loadFile(path.join(__dirname, 'capture.html'));
    captureWindow.on('closed', () => { captureWindow = null; });
    captureWindow.once('ready-to-show', () => captureWindow.focus());
}

// --- Result Window Management ---
function createResultWindow(initialPromptContent, selectedModelForDropdown) {
    if (resultWindow && !resultWindow.isDestroyed()) {
        resultWindow.webContents.send('prompt:display-optimized-content', { prompt: initialPromptContent, selectedModel: selectedModelForDropdown });
        resultWindow.show();
        resultWindow.focus();
        return;
    }
    const primaryDisplay = screen.getPrimaryDisplay();
    const winWidth = 450, winHeight = 400;
    resultWindow = new BrowserWindow({
        width: winWidth, height: winHeight,
        x: primaryDisplay.bounds.x + primaryDisplay.bounds.width - winWidth - 20,
        y: primaryDisplay.bounds.y + 20,
        alwaysOnTop: true, resizable: false, frame: true,
        icon: appIconPath,
        webPreferences: { preload: path.join(__dirname, 'preload_result.js'), contextIsolation: true, nodeIntegration: false, },
        title: "AI-Generated Prompt", show: false,
    });
    resultWindow.loadFile(path.join(__dirname, 'result.html'));
    resultWindow.webContents.on('did-finish-load', () => {
        resultWindow.webContents.send('prompt:display-optimized-content', { prompt: initialPromptContent, selectedModel: selectedModelForDropdown });
        resultWindow.show();
    });

    // Intercept the 'close' event
    resultWindow.on('close', (event) => {
        // Instead of letting the window close, we prevent the default action...
        event.preventDefault();
        // ...and just hide the window instead.
        resultWindow.hide();
        console.log('Result window hidden instead of closed.');
    });

    // The 'closed' event will now only fire when the whole app is quitting
    // and the window is force-closed, so we still nullify the variable.
    resultWindow.on('closed', () => {
        console.log('Result window has been fully closed.');
        resultWindow = null;
    });
}

function displayErrorInNewResultWindow(errorMessage) {
    const fullMessage = `Error: ${errorMessage}`;
    // When creating/showing a window just for an error, pass the last selected generator
    // so the dropdown in the result window can be correctly set.
    // The renderer's onPromptOptimizationError will handle displaying the error message in the text area.
    if (resultWindow && !resultWindow.isDestroyed()) {
        resultWindow.webContents.send('prompt:optimization-error', fullMessage); // Send error to existing window
        resultWindow.webContents.send('prompt:display-optimized-content', { prompt: fullMessage, selectedModel: lastSelectedGenerator || 'midjourney' }); // Also set content
        resultWindow.focus();
    } else {
        createResultWindow(fullMessage, lastSelectedGenerator || 'midjourney');
    }
}

// --- Core Prompt Generation Logic ---
async function generateAndDisplayOptimizedPrompt(targetImageGenModel, imageBase64, activeResultWindow) {
    // If no specific target model passed (e.g. first call after capture), use the last selected or default.
    targetImageGenModel = targetImageGenModel || lastSelectedGenerator || 'midjourney';
    lastSelectedGenerator = targetImageGenModel; // Remember this selection

    const windowToUpdate = activeResultWindow || resultWindow;

    if (!imageBase64) {
        console.error("No image data available for prompt generation.");
        const errorMsg = "No image captured to generate prompt from.";
        if (windowToUpdate && !windowToUpdate.isDestroyed()) {
            windowToUpdate.webContents.send('prompt:optimization-error', errorMsg);
             windowToUpdate.webContents.send('prompt:display-optimized-content', { prompt: errorMsg, selectedModel: targetImageGenModel });
        } else {
            createResultWindow(errorMsg, targetImageGenModel);
        }
        return;
    }

    let loadingMessage = `Generating prompt for ${targetImageGenModel}...`;
    if (windowToUpdate && !windowToUpdate.isDestroyed()) {
        windowToUpdate.webContents.send('prompt:display-optimized-content', { prompt: loadingMessage, selectedModel: targetImageGenModel });
        if(!windowToUpdate.isVisible()) windowToUpdate.show();
        windowToUpdate.focus();
    } else {
        createResultWindow(loadingMessage, targetImageGenModel);
    }

    let optimizedPrompt = `Failed to generate prompt for ${targetImageGenModel}.`; // Default error prompt
    let metaPrompt = "";
    let anErrorOccurred = false;
    try {
        const systemPrompt = `You are a world-class visual analyst, a hybrid of a seasoned cinematographer, a master art historian, and a keen-eyed photographer. When given an image, your primary goal is to perform a deep, multi-faceted analysis and deconstruct the image into its core components with the thoughtful and detailed eye of a true artist.

First, analyze the provided image step-by-step. Internally, build a rich understanding of the following aspects (you will use this understanding to fulfill the final formatting instruction):

1.  **Subject & Narrative:**
    * What is the primary subject? What are they doing?
    * What is the story or narrative being told? What just happened, or what is about to happen?
    * Identify any key objects or secondary subjects.

2.  **Composition & Framing:**
    * How is the shot framed? (e.g., rule of thirds, leading lines, centered, symmetrical).
    * What is the camera angle and perspective? (e.g., eye-level, low-angle, high-angle, bird's-eye view, dutch angle).
    * What is the shot type? (e.g., extreme close-up, medium shot, full shot, wide landscape).

3.  **Lighting & Color:**
    * **Lighting Scheme:** Describe the lighting setup. Is it high-key (bright, few shadows), low-key (dark, high contrast), or natural? Identify the key light, fill light, and backlight if discernible. Note the quality of light (e.g., hard, direct shadows vs. soft, diffused light).
    * **Color Palette & Grading:** Identify the dominant and accent colors. Describe the overall color grading style (e.g., cinematic teal and orange, vintage sepia, vibrant Technicolor, desaturated and moody, high-contrast monochrome).

4.  **Camera & Lens Characteristics:**
    * **Lens & Sensor:** Infer the likely lens characteristics (e.g., "shallow depth of field suggesting a fast prime lens like an 85mm f/1.4 on a full-frame sensor," "deep focus of a wide-angle lens," "compression from a telephoto lens," "distortion from a fisheye lens").
    * **Medium:** Does it look like digital, or does it have artifacts suggesting a specific film stock (e.g., "the grain and color palette of Kodak Portra 400," "the look of vintage 16mm film")?

5.  **Mood & Emotion:**
    * What is the primary mood or atmosphere? (e.g., serene, tense, joyful, melancholic, futuristic, nostalgic).
    * If people are present, what are their apparent emotions?

6.  **Artistic Style & Era:**
    * What is the overall artistic style? (e.g., photorealistic, impressionistic painting, cyberpunk concept art, minimalist graphic design).
    * What decade or historical era does the style evoke?

After completing this internal analysis, you will follow the final instruction to format your knowledge into a specific output.`;

        let metaPromptAddon = ""; // This will hold the formatting instruction

        if (targetImageGenModel === 'midjourney') {
            metaPromptAddon = `FINAL INSTRUCTION: Now, using your detailed analysis, compose a Midjourney prompt. Combine the most evocative descriptive phrases and keywords into a coherent string. Prioritize visual description and mood. If a clear aspect ratio was inferred, append it (e.g., --ar 16:9). The output must ONLY be the final prompt string.`;
        } else if (targetImageGenModel === 'stablediffusion') {
            metaPromptAddon = `FINAL INSTRUCTION: Now, using your detailed analysis, compose a Stable Diffusion prompt. Emphasize keywords and structure it as a comma-separated list of tags and descriptive phrases. Start with quality tags like "masterpiece, best quality, absurdres". Use parentheses for emphasis on the primary subject or key styles, for example: (keyword:1.2). The output must ONLY be the positive prompt text.`;
        } else if (targetImageGenModel === 'naturallanguage') {
            metaPromptAddon = `FINAL INSTRUCTION: Now, using your detailed analysis, compose a descriptive, natural language prompt suitable for an advanced AI like DALL-E or Imagen. Write in full, evocative sentences that paint a clear picture for the AI, describing the scene, subjects, style, and mood in a narrative fashion. The output must ONLY be the final prompt paragraph.`;
        } else if (targetImageGenModel === 'cinematographer') {
            metaPromptAddon = `FINAL INSTRUCTION: Now, using your detailed analysis, format your findings into a detailed report for a human. Use Markdown headings for each section (e.g., "**Style & Narrative:**", "**Lighting Analysis:**", "**Camera & Lens:**"). Write in clear, professional, and insightful language. The output must be ONLY this formatted analysis.`;
        } else {
            throw new Error(`Unsupported target model for optimization: ${targetImageGenModel}`);
        }

        // Combine the two parts into the final prompt for the LLM
        const finalMetaPrompt = systemPrompt + "\n\n" + metaPromptAddon;

        console.log(`Final meta prompt created for ${targetImageGenModel}. Sending to LLM...`);

        // --- LLM Call (Cleaned up) ---
        // Define max tokens based on the target model.
        // This will eventually be replaced by a user-configurable setting from the store.
        // The Cinematographer analysis needs more room to be descriptive.
        const maxOutputTokens = targetImageGenModel === 'cinematographer' ? 1024 : 450;
        console.log(`Setting max output tokens to: ${maxOutputTokens}`);

        if (selectedApiProvider === 'openai' && openai) {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [{ role: "user", content: [ { type: "text", text: finalMetaPrompt }, { type: "image_url", image_url: { "url": `data:image/png;base64,${imageBase64}` } } ] }],
                max_tokens: maxOutputTokens,
                temperature: 0.6,
            });
            optimizedPrompt = response.choices[0]?.message?.content?.trim();
        } else if (selectedApiProvider === 'gemini' && genAI) {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
            const imagePart = { inlineData: { data: imageBase64, mimeType: "image/png" } };
            const result = await model.generateContent({
                contents: [{ role: "user", parts: [imagePart, { text: finalMetaPrompt }] }],
                generationConfig: { maxOutputTokens: maxOutputTokens, temperature: 0.6 }
            });
            optimizedPrompt = result.response.text()?.trim();
        } else if (selectedApiProvider === 'local') {
            let localApiUrlFromSettings = store.get('localServerUrl');
            if (!localApiUrlFromSettings || localApiUrlFromSettings.trim() === '') {
                throw new Error('Local Server URL is not configured in settings.');
            }
            localApiUrlFromSettings = localApiUrlFromSettings.trim();
            if (localApiUrlFromSettings.endsWith('/')) {
                localApiUrlFromSettings = localApiUrlFromSettings.slice(0, -1);
            }

            let apiPath = store.get('ollamaApiPath', '/api/generate');
            if (!apiPath || apiPath.trim() === '') {
                apiPath = '/api/generate'; // Default if empty
            }
            apiPath = apiPath.trim();
            if (!apiPath.startsWith('/')) {
                apiPath = '/' + apiPath;
            }
            const ollamaEndpoint = `${localApiUrlFromSettings}${apiPath}`;
            
            const modelName = store.get('ollamaModelName', 'llava:7b'); // Get from store, default if not found
            if (!modelName || modelName.trim() === '') {
                throw new Error('Ollama Model Name is not configured in settings for Local Server provider.');
            }
            console.log(`Using Local Server (Ollama) for prompt generation at: ${ollamaEndpoint} with model: ${modelName}`);
            
            let ollamaPayload = {
                model: modelName, // Use the model name from settings
                prompt: finalMetaPrompt, // Using the existing finalMetaPrompt variable
                images: [imageBase64], // Ollama expects an array of base64 images
                stream: false
            };

            const customOptionsString = store.get('ollamaCustomOptions', '');
            if (customOptionsString && customOptionsString.trim() !== '') {
                try {
                    const customOptions = JSON.parse(customOptionsString);
                    if (typeof customOptions === 'object' && customOptions !== null) {
                        ollamaPayload.options = customOptions;
                        console.log('Applying custom Ollama options:', customOptions);
                    } else {
                        console.warn('Custom Ollama options string did not parse to an object, ignoring:', customOptionsString);
                    }
                } catch (e) {
                    console.warn('Error parsing custom Ollama options JSON, ignoring:', e.message, customOptionsString);
                }
            }

            const response = await fetch(ollamaEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ollamaPayload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Local server (Ollama) request to ${ollamaEndpoint} failed with status ${response.status}: ${errorText}`);
            }
            const data = await response.json();
            optimizedPrompt = data.response?.trim(); // Ollama /api/generate non-streaming typically uses 'response'
        } else {
            throw new Error(`No valid AI API provider configured ('${selectedApiProvider}') or client initialized.`);
        }

        if (!optimizedPrompt) throw new Error(`LLM failed to produce an analysis for ${targetImageGenModel} from image.`);

        // Model-specific cleanups
        if (targetImageGenModel === 'midjourney') optimizedPrompt = optimizedPrompt.replace(/^\s*(\/imagine|optimized midjourney prompt|midjourney prompt)(\s+prompt:)?\s*/i, '').trim();
        else if (targetImageGenModel === 'stablediffusion') optimizedPrompt = optimizedPrompt.replace(/^stable diffusion prompt:\s*/i, '').trim();
        else if (targetImageGenModel === 'naturallanguage') optimizedPrompt = optimizedPrompt.replace(/^(natural language prompt|flux prompt):\s*/i, '').trim();
        
        console.log(`Optimized for ${targetImageGenModel} (image-aware): ${optimizedPrompt.substring(0,100)}...`);

    } catch (error) {
        console.error(`Error in generateAndDisplayOptimizedPrompt for ${targetImageGenModel} via ${selectedApiProvider}:`, error);
        optimizedPrompt = `Optimization Failed: ${error.message}`;
        anErrorOccurred = true;
    }

    const finalWindowToUpdate = activeResultWindow || resultWindow;
    if (finalWindowToUpdate && !finalWindowToUpdate.isDestroyed()) {
        if (anErrorOccurred) {
            finalWindowToUpdate.webContents.send('prompt:optimization-error', optimizedPrompt);
            finalWindowToUpdate.webContents.send('prompt:display-optimized-content', { prompt: optimizedPrompt, selectedModel: targetImageGenModel });
        } else {
            finalWindowToUpdate.webContents.send('prompt:display-optimized-content', { prompt: optimizedPrompt, selectedModel: targetImageGenModel });
        }
    } else if (anErrorOccurred) {
        console.error("Result window not available to display final error:", optimizedPrompt);
    }
}

// --- IPC Handlers for Hotkey Settings (NEW) ---
ipcMain.handle('settings:get-hotkey', async () => {
    const defaultHotkey = process.platform === 'darwin' ? 'Cmd+F12' : 'Ctrl+F12';
    return store.get('captureHotkey', defaultHotkey);
});

ipcMain.handle('settings:set-hotkey', async (event, newHotkey) => {
    // A simple validation for the hotkey format
    if (!newHotkey || newHotkey.split('+').length < 2) {
        return { success: false, message: 'Invalid hotkey. Must include a modifier (Ctrl/Cmd/Alt/Shift) and a key.' };
    }

    try {
        // Unregister all existing shortcuts to avoid conflicts
        globalShortcut.unregisterAll();

        const registrationSuccess = globalShortcut.register(newHotkey, toggleCaptureWindow);

        if (registrationSuccess) {
            store.set('captureHotkey', newHotkey);
            console.log(`Successfully registered new hotkey: ${newHotkey}`);
            return { success: true, message: 'Hotkey saved and activated successfully!' };
        } else {
            console.error(`Failed to register new hotkey: "${newHotkey}". Re-registering old one.`);
            // If the new hotkey fails, re-register the old one as a fallback
            const oldHotkey = store.get('captureHotkey', process.platform === 'darwin' ? 'Cmd+F12' : 'Ctrl+F12');
            globalShortcut.register(oldHotkey, toggleCaptureWindow); // Re-register the last known good hotkey
            return { success: false, message: `Failed to register "${newHotkey}". It may be in use by another app. Reverted to previous hotkey.` };
        }
    } catch (error) {
        console.error('Error setting new hotkey:', error);
        return { success: false, message: 'An error occurred while setting the hotkey.' };
    }
});

// --- IPC Handlers for Settings (REVISED) ---
ipcMain.handle('settings:get-settings', async () => {
    const defaultHotkey = process.platform === 'darwin' ? 'Cmd+F12' : 'Ctrl+F12';
    return {
        openaiApiKey: store.get('openaiApiKey', ''),
        googleApiKey: store.get('googleApiKey', ''),
        localServerUrl: store.get('localServerUrl', 'https://localhost:8000'),
        ollamaModelName: store.get('ollamaModelName', 'llava:7b'), // Added
        ollamaApiPath: store.get('ollamaApiPath', '/api/generate'), // Added
        ollamaCustomOptions: store.get('ollamaCustomOptions', ''), // Added
        apiProvider: store.get('apiProvider', 'openai'),
        hotkey: store.get('captureHotkey', defaultHotkey)
    };
});

ipcMain.handle('settings:save-settings', async (event, settings) => {
    try {
        // Save API Keys and Provider
        if (typeof settings.openaiApiKey === 'string') store.set('openaiApiKey', settings.openaiApiKey.trim());
        if (typeof settings.googleApiKey === 'string') store.set('googleApiKey', settings.googleApiKey.trim());
        if (typeof settings.localServerUrl === 'string') store.set('localServerUrl', settings.localServerUrl.trim());
        if (typeof settings.ollamaModelName === 'string') store.set('ollamaModelName', settings.ollamaModelName.trim()); // Added
        if (typeof settings.ollamaApiPath === 'string') store.set('ollamaApiPath', settings.ollamaApiPath.trim()); // Added
        if (typeof settings.ollamaCustomOptions === 'string') store.set('ollamaCustomOptions', settings.ollamaCustomOptions.trim()); // Added
        if (['openai', 'gemini', 'local'].includes(settings.apiProvider)) store.set('apiProvider', settings.apiProvider);
        
        // Re-initialize API clients to apply changes immediately
        initializeApiClients();

        // Save and set the new hotkey
        const oldHotkey = store.get('captureHotkey');
        const newHotkey = settings.hotkey;

        // Only re-register if the hotkey has actually changed
        if (oldHotkey !== newHotkey) {
            // A simple validation for the hotkey format
            if (!newHotkey || newHotkey.split('+').length < 2) {
                return { success: false, message: 'Invalid hotkey. Must include a modifier (Ctrl/Cmd/Alt/Shift) and a key.' };
            }
            
            globalShortcut.unregisterAll();
            const registrationSuccess = globalShortcut.register(newHotkey, toggleCaptureWindow);

            if (registrationSuccess) {
                store.set('captureHotkey', newHotkey);
                console.log(`Successfully registered new hotkey: ${newHotkey}`);
                return { success: true, message: 'Settings saved successfully!' };
            } else {
                console.error(`Failed to register new hotkey: "${newHotkey}". Re-registering old one.`);
                globalShortcut.register(oldHotkey, toggleCaptureWindow); // Re-register the last known good hotkey
                return { success: false, message: `Failed to register "${newHotkey}". It may be in use. Reverted to previous hotkey.` };
            }
        }
        
        return { success: true, message: 'API settings saved successfully!' };

    } catch (error) {
        console.error('Failed to save settings:', error);
        throw new Error('Failed to save settings.');
    }
});

// --- IPC Handlers ---
ipcMain.on('capture:close', () => {
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.close();
});

ipcMain.on('capture:coords', async (event, rect) => {
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.hide();
    console.log('Received capture coordinates:', rect);
    try {
        const primaryDisplayForCapture = screen.getPrimaryDisplay();
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: Math.round(primaryDisplayForCapture.size.width * primaryDisplayForCapture.scaleFactor), height: Math.round(primaryDisplayForCapture.size.height * primaryDisplayForCapture.scaleFactor) }
        });
        if (!sources || sources.length === 0) throw new Error('No screen sources found.');
        
        let source = sources.find(s => s.display_id && s.display_id === primaryDisplayForCapture.id.toString());
        if (!source) source = sources.find(s => { const p = s.id.split(':'); return p.length > 1 && p[0]==='screen' && p[1]===primaryDisplayForCapture.id.toString(); });
        if (!source && sources.length === 1) source = sources[0];
        else if (!source && sources.length > 0) source = sources[0]; // Default to first if multiple and no match
        if (!source) throw new Error('Primary display source not found.');

        if (source.thumbnail.isEmpty()) throw new Error('Selected source thumbnail is empty.');
        const fullScreenPng = await source.thumbnail.toPNG();
        if (!fullScreenPng || fullScreenPng.length === 0) throw new Error('Thumbnail toPNG() returned empty buffer.');

        const imgDimensions = await sharp(fullScreenPng).metadata();
        const validatedRect = {
            left: Math.max(0, Math.round(rect.x)), top: Math.max(0, Math.round(rect.y)),
            width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height))
        };
        validatedRect.width = Math.min(validatedRect.width, imgDimensions.width - validatedRect.left);
        validatedRect.height = Math.min(validatedRect.height, imgDimensions.height - validatedRect.top);
        if (validatedRect.width <=0 || validatedRect.height <=0) throw new Error(`Invalid validatedRect.`);

        const croppedImageBuffer = await sharp(fullScreenPng).extract(validatedRect).png().toBuffer();
        const base64Image = croppedImageBuffer.toString('base64');
        
        lastCapturedBase64Image = base64Image;

        if (captureWindow && !captureWindow.isDestroyed()) captureWindow.close();

        await generateAndDisplayOptimizedPrompt(null, lastCapturedBase64Image, null); // Pass null for targetModel to use lastSelectedGenerator, pass null for activeResultWindow

    } catch (error) {
        console.error('Error in capture:coords IPC:', error);
        displayErrorInNewResultWindow(`Capture Error: ${error.message}`);
        if (captureWindow && !captureWindow.isDestroyed()) captureWindow.close();
    }
});

ipcMain.on('prompt:request-new-optimization', async (event, newTargetModel) => {
    console.log(`Result window requested new optimization for: ${newTargetModel}`);
    if (!lastCapturedBase64Image) {
        event.sender.send('prompt:optimization-error', "No image has been captured in this session.");
        // Also update the content to reflect this state
        event.sender.send('prompt:display-optimized-content', { prompt: "No image captured. Please use hotkey to capture screen.", selectedModel: newTargetModel });
        return;
    }
    await generateAndDisplayOptimizedPrompt(newTargetModel, lastCapturedBase64Image, BrowserWindow.fromWebContents(event.sender));
});

ipcMain.on('result:copy-to-clipboard', (event, text) => {
    if (text) {
        clipboard.writeText(text);
        event.sender.send('result:copied-feedback', 'Copied!');
    }
});

ipcMain.on('result:close', () => {
    if (resultWindow && !resultWindow.isDestroyed()) {
        resultWindow.hide();
    }
});

// Function to store an API key
async function storeApiKey(service, account, key) {
  await keytar.setPassword(service, account, key);
}

// Function to retrieve an API key
async function getApiKey(service, account) {
  return await keytar.getPassword(service, account);
}

// Example usage
storeApiKey('ScreenPrompt', 'openai', 'your_openai_api_key_here');
getApiKey('ScreenPrompt', 'openai').then(key => console.log(key));

// Handle application quit
app.on('before-quit', (event) => {
    // Close all windows
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.destroy();
    }
    if (captureWindow && !captureWindow.isDestroyed()) {
        captureWindow.destroy();
    }
    if (resultWindow && !resultWindow.isDestroyed()) {
        resultWindow.destroy();
    }
    
    // Unregister all shortcuts
    globalShortcut.unregisterAll();
});

// Handle tray quit
function quitApp() {
    app.quit();
}

// Update the tray menu creation to use the quitApp function
function createTrayMenu() {
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Capture Screen Area', click: () => toggleCaptureWindow() },
        { label: 'Settings...', click: createSettingsWindow },
        { type: 'separator' },
        { label: 'Quit Screen Prompt', click: quitApp }
    ]);
    tray.setContextMenu(contextMenu);
}