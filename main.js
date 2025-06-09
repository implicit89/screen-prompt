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
    if ((selectedApiProvider === 'openai' && !openai) || (selectedApiProvider === 'gemini' && !genAI)) {
        displayErrorInNewResultWindow(`AI Provider (${selectedApiProvider}) client not initialized. Check API key.`);
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
        if (targetImageGenModel === 'midjourney') {
            metaPrompt = `You are an expert Midjourney prompt engineer.
Carefully analyze the provided image. Based on its visual content, composition, subject matter, and any discernible artistic style, create an optimized and highly effective Midjourney prompt.
Your generated Midjourney prompt should:
1.  Faithfully represent the key elements, objects, and overall scene depicted in the image. Do not invent significant details or subjects that are not present or strongly implied in the image.
2.  Be highly descriptive of what is visually present. Specifically try to infer and include details about:
    a.  **Emotions and Mood:** If the image clearly portrays specific emotions in subjects (e.g., joyful, pensive, surprised) or an overall distinct mood (e.g., serene, mysterious, energetic, melancholic), incorporate these observations.
    b.  **Colour Grading and Lighting:** Describe the prominent color palette, any apparent color grading style (e.g., "warm vintage tones," "cool cinematic blues," "vibrant neon palette," "desaturated and moody," "monochromatic with high contrast"), and key lighting characteristics (e.g., "soft diffused daylight," "dramatic chiaroscuro," "golden hour glow," "artificial studio lighting").
    c.  **Apparent Camera Type/Shot Style:** If the image's quality, perspective, depth of field, or artifacts suggest a particular camera type or shot style (e.g., "shot on a vintage film camera," "crisp DSLR quality," "smartphone photo aesthetic," "wide-angle architectural shot," "intimate macro detail," "dynamic action shot," "security camera footage style," "drone's eye view"), include such a description. If a specific camera isn't obvious, you can suggest a general photographic quality (e.g., "professional photograph quality") if appropriate, or omit this if the image is clearly illustrative or abstract.
3.  Incorporate common Midjourney keywords for overall visual quality or specific desired aesthetics ONLY IF they genuinely enhance the accurate representation of the image's actual content and the inferred details from point 2. Prioritize faithfulness to the image over imposing excessive stylization if the image itself is simple or mundane.
4.  Include relevant Midjourney parameters. If the image's shape or content strongly suggests a specific aspect ratio (e.g., wide, square, portrait), try to include an appropriate --ar parameter (like --ar 16:9, --ar 1:1, --ar 2:3, etc.). If no specific aspect ratio is clearly evident from the image, do not add an --ar parameter. Do not add a version parameter.
5.  **Style Description:** Clearly specify the style of the image, such as "anime," "realistic," "illustration," "cartoon," etc., to ensure the prompt accurately reflects the desired output style.
The output must be ONLY the Midjourney prompt itself, with no conversational text, preambles, or explanations.`;

        } else if (targetImageGenModel === 'stablediffusion') {
            metaPrompt = `You are an expert Midjourney prompt engineer.
Carefully analyze the provided image. Based on its visual content, composition, subject matter, and any discernible artistic style, create an optimized and highly effective Midjourney prompt.
Your generated Midjourney prompt should:
1.  Faithfully represent the key elements, objects, and overall scene depicted in the image. Do not invent significant details or subjects that are not present or strongly implied in the image.
2.  Be highly descriptive of what is visually present. Specifically try to infer and include details about:
    a.  **Emotions and Mood:** If the image clearly portrays specific emotions in subjects (e.g., joyful, pensive, surprised) or an overall distinct mood (e.g., serene, mysterious, energetic, melancholic), incorporate these observations.
    b.  **Colour Grading and Lighting:** Describe the prominent color palette, any apparent color grading style (e.g., "warm vintage tones," "cool cinematic blues," "vibrant neon palette," "desaturated and moody," "monochromatic with high contrast"), and key lighting characteristics (e.g., "soft diffused daylight," "dramatic chiaroscuro," "golden hour glow," "artificial studio lighting").
    c.  **Apparent Camera Type/Shot Style:** If the image's quality, perspective, depth of field, or artifacts suggest a particular camera type or shot style (e.g., "shot on a vintage film camera," "crisp DSLR quality," "smartphone photo aesthetic," "wide-angle architectural shot," "intimate macro detail," "dynamic action shot," "security camera footage style," "drone's eye view"), include such a description. If a specific camera isn't obvious, you can suggest a general photographic quality (e.g., "professional photograph quality") if appropriate, or omit this if the image is clearly illustrative or abstract.
3.  Incorporate common Midjourney keywords for overall visual quality or specific desired aesthetics ONLY IF they genuinely enhance the accurate representation of the image's actual content and the inferred details from point 2. Prioritize faithfulness to the image over imposing excessive stylization if the image itself is simple or mundane.
4.  Include relevant Midjourney parameters. If the image's shape or content strongly suggests a specific aspect ratio (e.g., wide, square, portrait), try to include an appropriate --ar parameter (like --ar 16:9, --ar 1:1, --ar 2:3, etc.). If no specific aspect ratio is clearly evident from the image, do not add an --ar parameter. Do not add a version parameter.
5.  **Style Description:** Clearly specify the style of the image, such as "anime," "realistic," "illustration," "cartoon," etc., to ensure the prompt accurately reflects the desired output style.
The output must be ONLY the Midjourney prompt itself, with no conversational text, preambles, or explanations.`;

        } else if (targetImageGenModel === 'naturallanguage') {
            metaPrompt = `You are an expert prompt engineer for advanced image generation models that excel at understanding natural language (such as DALL-E, Google's Imagen, or similar).
Carefully analyze the provided image. Create a clear, descriptive, and coherent prompt based on its visual content, suitable for achieving a high-fidelity image with such models.
Your generated prompt should:
1.  ACCURATELY and FAITHFULLY describe the main subjects, objects, the overall scene, and any actions taking place in the image. Do not invent elements not present.
2.  Use natural, descriptive language, forming well-constructed sentences or evocative phrases. Clearly articulate details such as:
    a.  **Emotions and Mood:** If the image conveys clear emotions (e.g., "a portrait filled with quiet joy," "a landscape exuding serene tranquility") or a distinct atmosphere, express this.
    b.  **Colour & Lighting:** Describe the key colors, the interplay of light and shadow, and any specific lighting conditions or color grading style (e.g., "bathed in the soft, warm light of early morning," "dramatic, high-contrast lighting typical of film noir," "a palette of vibrant, tropical colors").
    c.  **Camera Perspective & Style:** Describe the apparent viewpoint, shot type, or photographic style (e.g., "an intimate eye-level shot focusing on the subject's gaze," "a sweeping bird's-eye view of the city," "captured in a candid, documentary photography style," "macro photography revealing the intricate patterns of a flower"). If uncertain, aim for a "clear, high-quality photograph" style unless the image implies an illustrative or artistic medium.
    d.  **Artistic Style:** If the image exhibits a recognizable artistic style (e.g., "rendered in the style of impressionist oil painting," "a clean, minimalist vector illustration," "looks like a hyperrealistic 3D model," "vintage sci-fi book cover art"), identify and include it. If no strong artistic style is present, focus on achieving a clear, realistic depiction.
3.  Focus on a well-composed and comprehensive description rather than excessive keyword stuffing. The prompt should be easy for an advanced AI to understand and follow.
4.  If the image's dimensions clearly suggest a particular aspect ratio (e.g., "a panoramic vista," "a tall, slender portrait format"), you may note this descriptively.
The output must be ONLY the prompt text itself, without any conversational text or explanations.`;

} else if (targetImageGenModel === 'cinematographer') {
    metaPrompt = `You are a seasoned cinematographer and film analyst with decades of experience on set and in post-production.
Carefully analyze the provided image with the detailed eye of a true artist and technician. Provide a comprehensive visual breakdown of the shot.
Your analysis must be structured with the following sections, providing insightful and well-reasoned inferences based on the visual evidence. Frame your analysis as an expert assessment, using phrases like "appears to be," "likely," "suggests," or "is reminiscent of."

**Shot Achievement & Style:**
Describe the overall style of the shot (e.g., film noir, high-key commercial, gritty documentary, magical realism). What decade or era does the visual language feel like it's from? How was this shot likely achieved technically (e.g., dolly shot, handheld, tripod with a long exposure, drone footage)?

**Lighting Analysis:**
Based on shadows, highlights, and reflections, infer the lighting setup.
- **Setup:** Describe a plausible setup (e.g., "classic three-point lighting," "a single, large softbox," "natural light from a window augmented with a bounce card").
- **Quality & Temp:** Describe the light quality (e.g., hard, soft, diffused) and infer the likely color temperature (e.g., "warm tungsten tones around 3200K," "cool daylight at 5600K," "mixed lighting with practical neon lamps").
- **Power:** Give a conceptual indication of power (e.g., "low-wattage practicals," "powerful HMI for simulating sunlight").

**Camera & Lens Analysis:**
- **Sensor Size:** What sensor format does the image's depth of field, grain structure, and overall feel suggest (e.g., "looks like a full-frame sensor for shallow depth of field," "reminiscent of a Super 35 cinema camera," "could be a high-end Micro Four Thirds," "feels like a 1-inch sensor from a professional camcorder").
- **Lens Choice:** What focal length and type of lens were likely used? (e.g., "a wide-angle lens around 24mm to capture the expansive scene," "a prime lens around 85mm for a flattering portrait," "a macro lens for the extreme detail," "a telephoto lens to compress the background").

**Budget Estimation:**
Provide a rough, conceptual budget range required to professionally recreate this single shot, considering the inferred lighting, camera, and potential location/set dressing. Categorize it (e.g., "Micro-Budget/Indie (~$0 - $5k)," "Professional Commercial (~$10k - $50k)," "High-End Cinema (~$100k+ for the setup)"). Justify your estimation briefly.

The output must be the full, well-formatted analysis, not a single-line prompt. Use Markdown for headings.`;
        
        } else {
            throw new Error(`Unsupported target image generator model: ${targetImageGenModel}`);
        }

        console.log(`Meta-prompt for ${targetImageGenModel} (image-aware, using ${selectedApiProvider}): ... (log snippet)`);

        const maxTokensForAnalysis = 700; // Increased for a detailed breakdown
        if (selectedApiProvider === 'openai' && openai) {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [{ role: "user", content: [ { type: "text", text: metaPrompt }, { type: "image_url", image_url: { "url": `data:image/png;base64,${imageBase64}` } } ] }],
                max_tokens: maxTokensForAnalysis, // Use more tokens for this task
                temperature: 0.6, // Allow for more descriptive creativity
            });
            optimizedPrompt = response.choices[0]?.message?.content?.trim();
        } else if (selectedApiProvider === 'gemini' && genAI) {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
            const imagePart = { inlineData: { data: imageBase64, mimeType: "image/png" } };
            const result = await model.generateContent({
                contents: [{ role: "user", parts: [imagePart, { text: metaPrompt }] }],
                generationConfig: { maxOutputTokens: maxTokensForAnalysis, temperature: 0.6 } // Use more tokens
            });
            optimizedPrompt = result.response.text()?.trim();
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

    const finalWindowToUpdate = activeResultWindow || resultWindow; // Re-check as window might have been created
    if (finalWindowToUpdate && !finalWindowToUpdate.isDestroyed()) {
        if (anErrorOccurred) {
            finalWindowToUpdate.webContents.send('prompt:optimization-error', optimizedPrompt); // Send error message
             // Also update content to show error, and ensure dropdown is correct
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
        apiProvider: store.get('apiProvider', 'openai'),
        hotkey: store.get('captureHotkey', defaultHotkey)
    };
});

ipcMain.handle('settings:save-settings', async (event, settings) => {
    try {
        // Save API Keys and Provider
        if (typeof settings.openaiApiKey === 'string') store.set('openaiApiKey', settings.openaiApiKey);
        if (typeof settings.googleApiKey === 'string') store.set('googleApiKey', settings.googleApiKey);
        if (['openai', 'gemini'].includes(settings.apiProvider)) store.set('apiProvider', settings.apiProvider);
        
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