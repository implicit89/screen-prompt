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
require('dotenv').config();

let tray = null;
let captureWindow = null;
let resultWindow = null;
let lastCapturedBase64Image = null;

// --- API Clients Initialization ---
let openai;
let genAI; // Google Generative AI client

const selectedApiProvider = process.env.API_PROVIDER ? process.env.API_PROVIDER.toLowerCase() : 'openai';

if (selectedApiProvider === 'openai') {
    if (process.env.OPENAI_API_KEY) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        console.log("OpenAI client initialized.");
    } else {
        console.error("ERROR: API_PROVIDER is 'openai' but OPENAI_API_KEY is not set.");
    }
} else if (selectedApiProvider === 'gemini') {
    if (process.env.GOOGLE_API_KEY) {
        genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        console.log("Google Generative AI client initialized.");
    } else {
        console.error("ERROR: API_PROVIDER is 'gemini' but GOOGLE_API_KEY is not set.");
    }
} else {
    console.error(`ERROR: Invalid API_PROVIDER specified: '${selectedApiProvider}'. Defaulting to no API client.`);
}

// --- App Lifecycle and Error Handling for API Keys ---
app.whenReady().then(() => {
    let apiKeyError = null;
    if (selectedApiProvider === 'openai' && !openai) {
        apiKeyError = "OpenAI API key (OPENAI_API_KEY) is not set. Please set it in the .env file.";
    } else if (selectedApiProvider === 'gemini' && !genAI) {
        apiKeyError = "Google API key (GOOGLE_API_KEY) is not set. Please set it in the .env file.";
    } else if (selectedApiProvider !== 'openai' && selectedApiProvider !== 'gemini') {
        apiKeyError = `Invalid API_PROVIDER: '${selectedApiProvider}'. Please set to 'openai' or 'gemini' in .env.`;
    }

    if (apiKeyError) {
        dialog.showErrorBox("API Configuration Error", `${apiKeyError} The application may not function correctly.`);
    }
    initializeApp();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    console.log('Global shortcuts unregistered.');
    // Optionally, explicitly destroy the tray icon, though Electron often handles it
    if (tray && !tray.isDestroyed()) {
        tray.destroy();
    }
});

app.on('window-all-closed', () => {
    // MVP behavior: app runs in background. This event might not lead to a quit.
});

// --- A. Application Lifecycle & Hotkey Trigger & Tray ---
function initializeApp() {
    if (process.platform === 'darwin') {
        app.dock.hide(); // Essential for macOS tray-only app feel
    }

    // --- Existing Menu Setup (for app window, can be minimal for background app) ---
    const appMenuTemplate = [
        ...(process.platform === 'darwin' ? [{
            label: app.name,
            submenu: [ { role: 'quit' } ]
        }] : [{
            label: 'File',
            submenu: [ { role: 'quit' } ]
        }])
    ];
    const appMenu = Menu.buildFromTemplate(appMenuTemplate);
    Menu.setApplicationMenu(appMenu);


    // --- Existing Global Hotkey Registration ---
    const hotkey = process.platform === 'darwin' ? 'Cmd+F12' : 'Ctrl+F12';
    if (!globalShortcut.register(hotkey, toggleCaptureWindow)) {
        console.error('Failed to register global shortcut:', hotkey);
        dialog.showErrorBox("Shortcut Error", `Failed to register global shortcut ${hotkey}.`);
        return;
    }
    console.log(`Global shortcut "${hotkey}" registered for API Provider: ${selectedApiProvider}.`);


    // --- System Tray Icon Setup ---
    const iconName = 'icon.png'; // Ensure you have 'icon.png' in an 'assets' folder
    const iconPath = path.join(__dirname, 'assets', iconName);

    if (!fs.existsSync(iconPath)) {
        console.error(`Tray icon not found at ${iconPath}. Please create an 'assets' folder with an '${iconName}'.`);
        // Fallback: App will run without a tray icon, harder to quit on some OS.
        // You could show a dialog error here too.
        dialog.showErrorBox("Tray Icon Error", `Icon file not found at ${iconPath}. The tray icon will not be displayed.`);
    } else {
        let trayIconImage;
        if (process.platform === 'darwin') {
            trayIconImage = nativeImage.createFromPath(iconPath);
            if (!trayIconImage.isEmpty()) {
                trayIconImage = trayIconImage.resize({ width: 16, height: 16 }); // Resize for macOS menu bar
                trayIconImage.setTemplateImage(true); // Makes it adapt to light/dark mode
            } else {
                console.error(`Failed to load nativeImage for tray icon at ${iconPath}`);
                trayIconImage = null; // Fallback if image loading fails
            }
        } else {
            // For Windows/Linux, create directly or load as nativeImage if specific processing needed
            trayIconImage = nativeImage.createFromPath(iconPath);
             if (trayIconImage.isEmpty()) {
                console.error(`Failed to load nativeImage for tray icon at ${iconPath}`);
                trayIconImage = null;
            }
        }

        if (trayIconImage) {
            tray = new Tray(trayIconImage);

            const contextMenu = Menu.buildFromTemplate([
                {
                    label: 'Capture Screen Area',
                    toolTip: `Hotkey: ${hotkey}`,
                    click: () => {
                        console.log('Triggering capture from tray menu.');
                        toggleCaptureWindow();
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quit Screen Describer',
                    click: () => {
                        console.log('Quitting from tray menu.');
                        app.quit();
                    }
                }
            ]);

            tray.setToolTip('Screen Describer');
            tray.setContextMenu(contextMenu);

            // Optional: Handle left-click on tray icon (e.g., to trigger capture)
            tray.on('click', () => {
                console.log('Tray icon left-clicked.');
                // Example: toggleCaptureWindow();
                // Or, if you had a main settings window: someWindow.show();
            });
            console.log('System tray icon initialized.');
        } else {
             console.error('Could not create tray icon because the image was not loaded.');
        }
    }
}

// --- B. Screen Selection & Capture ---
function toggleCaptureWindow() {
    if (selectedApiProvider === 'openai' && !openai) {
        displayErrorInResultWindow("OpenAI client not initialized. Check API key (OPENAI_API_KEY).");
        return;
    }
    if (selectedApiProvider === 'gemini' && !genAI) {
        displayErrorInResultWindow("Gemini client not initialized. Check API key (GOOGLE_API_KEY).");
        return;
    }

    if (captureWindow) {
        captureWindow.close();
    } else {
        createCaptureWindow(); // This function definition is now included below
    }
}

function createCaptureWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    captureWindow = new BrowserWindow({
        x: primaryDisplay.bounds.x,
        y: primaryDisplay.bounds.y,
        width,
        height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload_capture.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        skipTaskbar: true,
        focusable: true,
    });

    captureWindow.loadFile(path.join(__dirname, 'capture.html'));
    // captureWindow.webContents.openDevTools({ mode: 'detach' });

    captureWindow.on('closed', () => {
        captureWindow = null;
        console.log('Capture window closed.');
    });

    captureWindow.once('ready-to-show', () => {
        captureWindow.focus();
    });
}

ipcMain.on('capture:close', () => {
    if (captureWindow && !captureWindow.isDestroyed()) {
        captureWindow.close();
    }
});

ipcMain.on('capture:coords', async (event, rect) => {
    if (captureWindow && !captureWindow.isDestroyed()) {
        captureWindow.hide();
    }

    console.log('Received capture coordinates:', rect);

    try {
        const primaryDisplayForCapture = screen.getPrimaryDisplay(); // Renamed to avoid conflict
        console.log('---- Primary Display Info (for thumbnailSize calculation) ----');
        console.log(`ID: ${primaryDisplayForCapture.id}, Size: ${primaryDisplayForCapture.size.width}x${primaryDisplayForCapture.size.height}, ScaleFactor: ${primaryDisplayForCapture.scaleFactor}`);

        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {
                width: Math.round(primaryDisplayForCapture.size.width * primaryDisplayForCapture.scaleFactor),
                height: Math.round(primaryDisplayForCapture.size.height * primaryDisplayForCapture.scaleFactor)
            }
        });

        if (!sources || sources.length === 0) throw new Error('No screen sources found.');

        console.log('---- Available Desktop Sources ----');
        sources.forEach((s, index) => {
            console.log(`Source ${index}: ID=${s.id}, Name=${s.name}, DisplayID=${s.display_id}, ThumbnailSize: ${s.thumbnail.getSize().width}x${s.thumbnail.getSize().height}`);
        });

        let source = sources.find(s => s.display_id && s.display_id === primaryDisplayForCapture.id.toString());
        if (!source) {
            console.warn(`Direct match for primary_display.id ('${primaryDisplayForCapture.id}') failed. Fallback 1...`);
            source = sources.find(s => {
                const parts = s.id.split(':');
                return parts.length > 1 && parts[0] === 'screen' && parts[1] === primaryDisplayForCapture.id.toString();
            });
            if (source) console.log('Fallback 1 success.');
        }
        if (!source && sources.length > 0) {
            if (sources.length === 1) {
                console.warn('Fallback 2: Only one source found, using it.');
                source = sources[0];
            } else {
                console.warn(`Fallback 3: Multiple sources, no clear match. Using first source.`);
                source = sources[0];
            }
        }
        if (!source) throw new Error('Primary display source not found after all checks.');

        console.log('---- Selected source for capture ----');
        console.log(`ID: ${source.id}, Name: ${source.name}, Thumbnail Actual Size: ${source.thumbnail.getSize().width}x${source.thumbnail.getSize().height}`);

        if (source.thumbnail.isEmpty()) throw new Error('Selected source thumbnail is empty.');

        const fullScreenPng = await source.thumbnail.toPNG();
        if (!fullScreenPng || fullScreenPng.length === 0) throw new Error('source.thumbnail.toPNG() returned empty buffer.');
        console.log(`source.thumbnail.toPNG() buffer length: ${fullScreenPng.length}.`);

        const imgDimensions = await sharp(fullScreenPng).metadata();
        console.log(`Sharp metadata: ${imgDimensions.width}x${imgDimensions.height}, Format:${imgDimensions.format}`);

        const validatedRect = {
            left: Math.max(0, Math.round(rect.x)), top: Math.max(0, Math.round(rect.y)),
            width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height))
        };
        validatedRect.width = Math.min(validatedRect.width, imgDimensions.width - validatedRect.left);
        validatedRect.height = Math.min(validatedRect.height, imgDimensions.height - validatedRect.top);

        if (validatedRect.width <=0 || validatedRect.height <=0) throw new Error(`Invalid validatedRect dimensions.`);
        console.log('Validated rect:', validatedRect);

        const croppedImageBuffer = await sharp(fullScreenPng).extract(validatedRect).png().toBuffer();
        const base64Image = croppedImageBuffer.toString('base64');
        console.log('Cropped image generated (Base64, first 50 chars):', base64Image.substring(0, 50) + "...");
        lastCapturedBase64Image = base64Image; // Store the image for later optimization

        if (captureWindow && !captureWindow.isDestroyed()) captureWindow.close();
        triggerLLMDescription(base64Image);

    } catch (error) {
        console.error('Error in capture:coords IPC:', error);
        displayErrorInResultWindow(`Capture Error: ${error.message}`);
        if (captureWindow && !captureWindow.isDestroyed()) captureWindow.close();
    }
});

// --- C. LLM Integration ---
async function callOpenAI(base64Image) {
    if (!openai) throw new Error("OpenAI client not initialized.");
    console.log("Sending image to OpenAI GPT-4o...");
    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [ {
            role: "user", content: [
                { type: "text", text: "Describe the content of this image in detail. Be precise and informative." },
                { type: "image_url", image_url: { "url": `data:image/png;base64,${base64Image}`, "detail": "auto" } },
            ],
        }],
        max_tokens: 350,
    });
    const description = response.choices[0]?.message?.content?.trim();
    if (!description) throw new Error("Empty description from OpenAI.");
    return description;
}

async function callGemini(base64Image) {
    if (!genAI) throw new Error("Google Generative AI client not initialized.");
    console.log("Sending image to Google Gemini...");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    const imagePart = { inlineData: { data: base64Image, mimeType: "image/png" } };
    const prompt = "Describe the content of this image in detail. Be precise and informative.";
    const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ];

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [imagePart, {text: prompt}] }],
            safetySettings,
        });
        const response = result.response;
        if (!response) {
            const blockReason = response?.promptFeedback?.blockReason;
            if (blockReason) throw new Error(`Gemini blocked: ${blockReason}.`);
            if (!response.candidates || !response.candidates[0]?.content?.parts?.[0]?.text) {
                 throw new Error("Invalid Gemini response structure.");
            }
        }
        const description = response.candidates[0].content.parts[0].text.trim();
        if (!description) throw new Error("Empty description from Gemini.");
        return description;
    } catch (error) {
         console.error('Error calling Gemini API:', error);
         if (error.message?.includes("API key not valid")) throw new Error("Invalid Google API Key.");
         throw error;
    }
}

async function triggerLLMDescription(base64Image) {
    if (resultWindow && !resultWindow.isDestroyed()) {
        resultWindow.webContents.send('result:set-content', "Processing new image...");
    } else {
        createResultWindow("Processing new image..."); // Definition included below
    }

    try {
        let description = "";
        console.log(`Attempting description with ${selectedApiProvider}...`);
        if (selectedApiProvider === 'openai') {
            description = await callOpenAI(base64Image);
        } else if (selectedApiProvider === 'gemini') {
            description = await callGemini(base64Image);
        } else {
            throw new Error(`Invalid API_PROVIDER: ${selectedApiProvider}`);
        }
        console.log("AI Description (length):", description.length);
        displayDescriptionInResultWindow(description); // Definition included below
    } catch (error) {
        console.error(`${selectedApiProvider.toUpperCase()} API Error:`, error);
        let friendlyError = `Failed from ${selectedApiProvider.toUpperCase()}.`;
        if (error.message) friendlyError = `${selectedApiProvider.toUpperCase()} Error: ${error.message}`;
        displayErrorInResultWindow(friendlyError); // Definition included below
    }
}

// --- D. Result Display & Interaction ---
function displayDescriptionInResultWindow(description) {
    if (resultWindow && !resultWindow.isDestroyed()) {
        resultWindow.webContents.send('result:set-content', description);
        resultWindow.show();
        resultWindow.focus();
    } else {
        createResultWindow(description);
    }
}

function displayErrorInResultWindow(errorMessage) {
    const fullMessage = `Error: ${errorMessage}`;
    if (resultWindow && !resultWindow.isDestroyed()) {
        resultWindow.webContents.send('result:set-content', fullMessage);
        resultWindow.show();
        resultWindow.focus();
    } else {
        createResultWindow(fullMessage);
    }
}

function createResultWindow(initialContent) {
    if (resultWindow && !resultWindow.isDestroyed()) { // Prevent multiple result windows
        resultWindow.focus();
        resultWindow.webContents.send('result:set-content', initialContent);
        return;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const winWidth = 450;
    const winHeight = 350;

    resultWindow = new BrowserWindow({
        width: winWidth,
        height: winHeight,
        x: primaryDisplay.bounds.x + primaryDisplay.bounds.width - winWidth - 20,
        y: primaryDisplay.bounds.y + 20,
        alwaysOnTop: true,
        resizable: false,
        frame: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload_result.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        title: "AI Description",
        show: false,
    });

    resultWindow.loadFile(path.join(__dirname, 'result.html'));

    resultWindow.webContents.on('did-finish-load', () => {
        resultWindow.webContents.send('result:set-content', initialContent);
        resultWindow.show();
    });

    resultWindow.on('closed', () => {
        resultWindow = null;
        console.log('Result window closed.');
    });
}

ipcMain.on('result:copy-to-clipboard', (event, text) => {
    if (text) {
        clipboard.writeText(text);
        console.log('Text copied to clipboard.');
        event.sender.send('result:copied-feedback', 'Copied!');
    }
});

ipcMain.on('result:close', () => {
    if (resultWindow && !resultWindow.isDestroyed()) {
        resultWindow.close();
    }
});

ipcMain.on('prompt:optimize', async (event, baseDescription, targetImageGenModel) => {
    let optimizedPrompt = baseDescription; 
    let anErrorOccurred = false;

    console.log(`Optimizing prompt for: ${targetImageGenModel} using API provider: ${selectedApiProvider}.`);

    if (!lastCapturedBase64Image && (targetImageGenModel === 'midjourney' || targetImageGenModel === 'stablediffusion' || targetImageGenModel === 'flux')) {
        console.error(`No image available for ${targetImageGenModel} multimodal optimization. Please capture an image first.`);
        event.sender.send('prompt:optimization-error', `${targetImageGenModel} (Image): No captured image available.`);
        return;
    }
    if (!baseDescription || baseDescription.trim() === "") {
        console.warn("Base description is empty. This might affect prompt quality even with image input.");
        // Continue as image is primary, but good to note.
    }

    // --- MIDJOURNEY ---
    if (targetImageGenModel === 'midjourney') {
        try {
            const metaPrompt = `You are an expert Midjourney prompt engineer.
Carefully analyze the provided image. Based on its visual content, composition, subject matter, and any discernible artistic style, create an optimized and highly effective Midjourney prompt.
Your generated Midjourney prompt should:
1.  Faithfully represent the key elements, objects, and overall scene depicted in the image. Do not invent significant details or subjects that are not present or strongly implied in the image.
2.  Be highly descriptive of what is visually present. Specifically try to infer and include details about:
    a.  **Emotions and Mood:** If the image clearly portrays specific emotions in subjects (e.g., joyful, pensive, surprised) or an overall distinct mood (e.g., serene, mysterious, energetic, melancholic), incorporate these observations.
    b.  **Colour Grading and Lighting:** Describe the prominent color palette, any apparent color grading style (e.g., "warm vintage tones," "cool cinematic blues," "vibrant neon palette," "desaturated and moody," "monochromatic with high contrast"), and key lighting characteristics (e.g., "soft diffused daylight," "dramatic chiaroscuro," "golden hour glow," "artificial studio lighting").
    c.  **Apparent Camera Type/Shot Style:** If the image's quality, perspective, depth of field, or artifacts suggest a particular camera type or shot style (e.g., "shot on a vintage film camera," "crisp DSLR quality," "smartphone photo aesthetic," "wide-angle architectural shot," "intimate macro detail," "dynamic action shot," "security camera footage style," "drone's eye view"), include such a description. If a specific camera isn't obvious, you can suggest a general photographic quality (e.g., "professional photograph quality") if appropriate, or omit this if the image is clearly illustrative or abstract.
3.  Incorporate common Midjourney keywords for overall visual quality or specific desired aesthetics ONLY IF they genuinely enhance the accurate representation of the image's actual content and the inferred details from point 2. Prioritize faithfulness to the image over imposing excessive stylization if the image itself is simple or mundane.
4.  Include relevant Midjourney parameters. If the image's shape or content strongly suggests a specific aspect ratio (e.g., wide, square, portrait), try to include an appropriate --ar parameter (like --ar 16:9, --ar 1:1, --ar 2:3, etc.). If no specific aspect ratio is clearly evident from the image, do not add an --ar parameter. Do not add a version parameter.
The output must be ONLY the Midjourney prompt itself, with no conversational text, preambles, or explanations.`;

            console.log(`Meta-prompt for Midjourney (image-aware, using ${selectedApiProvider}): ...`); // Keep log concise

            if (selectedApiProvider === 'openai' && openai) {
                const response = await openai.chat.completions.create({
                    model: "gpt-4o", messages: [{ role: "user", content: [ { type: "text", text: metaPrompt }, { type: "image_url", image_url: { "url": `data:image/png;base64,${lastCapturedBase64Image}` } } ] }],
                    max_tokens: 250, temperature: 0.5,
                });
                optimizedPrompt = response.choices[0]?.message?.content?.trim();
            } else if (selectedApiProvider === 'gemini' && genAI) {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
                const imagePart = { inlineData: { data: lastCapturedBase64Image, mimeType: "image/png" } };
                const result = await model.generateContent({ contents: [{ role: "user", parts: [imagePart, { text: metaPrompt }] }], generationConfig: { maxOutputTokens: 250, temperature: 0.5 } });
                optimizedPrompt = result.response.text()?.trim();
            } else { throw new Error("No valid AI API provider for prompt transformation."); }

            if (!optimizedPrompt) throw new Error("LLM failed to produce a Midjourney prompt from image.");
            optimizedPrompt = optimizedPrompt.replace(/^\s*(\/imagine|optimized midjourney prompt|midjourney prompt)(\s+prompt:)?\s*/i, '').trim();
            console.log("Optimized for Midjourney (image-aware):", optimizedPrompt);

        } catch (error) {
            console.error(`Error transforming for Midjourney (image-aware) via ${selectedApiProvider}:`, error);
            event.sender.send('prompt:optimization-error', `Midjourney (Image) Opt. Failed: ${error.message}`);
            anErrorOccurred = true;
        }

    // --- STABLE DIFFUSION ---
    } else if (targetImageGenModel === 'stablediffusion') {
        if (!lastCapturedBase64Image) { // Should have been caught by the top-level check, but good practice
            event.sender.send('prompt:optimization-error', "Stable Diffusion (Image): No captured image."); return;
        }
        try {
            const metaPrompt = `You are an expert Stable Diffusion prompt engineer.
Carefully analyze the provided image. Based on its visual content, create a highly effective and detailed prompt for Stable Diffusion (suitable for models like SDXL or SD 1.5).
Your generated Stable Diffusion prompt should:
1.  ACCURATELY and FAITHFULLY describe the key subjects, objects, scene, and composition from the image. Do not invent elements not present.
2.  Be rich in descriptive keywords and phrases. Detail aspects such as:
    a.  **Emotions and Mood:** If clear emotions (e.g., "joyful expression," "contemplative mood") or a distinct atmosphere are portrayed, describe them.
    b.  **Colour Palette & Lighting:** Describe the colors (e.g., "vibrant primary colors," "muted earth tones," "monochromatic blue"), color grading, and lighting (e.g., "soft volumetric lighting," "dramatic rim lighting," "noon sunlight").
    c.  **Apparent Camera/Shot Details:** If discernible, mention shot type (e.g., "extreme close-up," "overhead shot," "dynamic low-angle shot"), lens effects (e.g., "shallow depth of field, bokeh background," "wide-angle distortion"), or apparent camera style (e.g., "shot on DSLR, 85mm lens," "vintage film photo with grain," "polaroid style"). If uncertain, aim for "photograph" or "digital painting" quality, as appropriate, unless the image suggests otherwise.
    d.  **Artistic Style:** If the image has a clear artistic style (e.g., "impressionist oil painting," "cyberpunk digital art," "photorealistic CGI render," "retro pixel art," "detailed ink drawing") or resembles the work of a known artist relevant to the style, incorporate this.
3.  Include common Stable Diffusion quality-boosting keywords (e.g., "masterpiece, best quality, absurdres, highly detailed, intricate, 4k, sharp focus") if they align with the image's nature.
4.  Structure the prompt effectively, primarily using comma-separated keywords and descriptive phrases. You may use parentheses for emphasis on key elements, e.g., (keyword:1.2) or ((important subject)).
5.  If the image's aspect ratio is clearly non-square, you can note this descriptively (e.g., "widescreen aspect ratio," "portrait orientation image").
The output must be ONLY the positive prompt text itself, without any conversational text, negative prompts, or explanations.`;

            console.log(`Meta-prompt for Stable Diffusion (image-aware, using ${selectedApiProvider}): ...`);

            if (selectedApiProvider === 'openai' && openai) {
                const response = await openai.chat.completions.create({
                    model: "gpt-4o", messages: [{ role: "user", content: [ { type: "text", text: metaPrompt }, { type: "image_url", image_url: { "url": `data:image/png;base64,${lastCapturedBase64Image}` } } ] }],
                    max_tokens: 300, temperature: 0.5, // SD prompts can be longer
                });
                optimizedPrompt = response.choices[0]?.message?.content?.trim();
            } else if (selectedApiProvider === 'gemini' && genAI) {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
                const imagePart = { inlineData: { data: lastCapturedBase64Image, mimeType: "image/png" } };
                const result = await model.generateContent({ contents: [{ role: "user", parts: [imagePart, { text: metaPrompt }] }], generationConfig: { maxOutputTokens: 300, temperature: 0.5 } });
                optimizedPrompt = result.response.text()?.trim();
            } else { throw new Error("No valid AI API provider for prompt transformation."); }

            if (!optimizedPrompt) throw new Error("LLM failed to produce a Stable Diffusion prompt from image.");
            optimizedPrompt = optimizedPrompt.replace(/^stable diffusion prompt:\s*/i, '').trim();
            console.log("Optimized for Stable Diffusion (image-aware):", optimizedPrompt);

        } catch (error) {
            console.error(`Error transforming for Stable Diffusion (image-aware) via ${selectedApiProvider}:`, error);
            event.sender.send('prompt:optimization-error', `Stable Diffusion (Image) Opt. Failed: ${error.message}`);
            anErrorOccurred = true;
        }

    // --- FLUX ---
    } else if (targetImageGenModel === 'naturallanguage') {
        if (!lastCapturedBase64Image) { // Redundant check, but safe
             event.sender.send('prompt:optimization-error', "Flux (Image): No captured image."); return;
        }
        try {
            const metaPrompt = `You are an expert prompt engineer for advanced image generation models that excel at understanding natural language (such as DALL-E, Google's Imagen, or similar).
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
            console.log(`Meta-prompt for Flux (image-aware, using ${selectedApiProvider}): ...`);

            if (selectedApiProvider === 'openai' && openai) {
                const response = await openai.chat.completions.create({
                    model: "gpt-4o", messages: [{ role: "user", content: [ { type: "text", text: metaPrompt }, { type: "image_url", image_url: { "url": `data:image/png;base64,${lastCapturedBase64Image}` } } ] }],
                    max_tokens: 300, temperature: 0.5,
                });
                optimizedPrompt = response.choices[0]?.message?.content?.trim();
            } else if (selectedApiProvider === 'gemini' && genAI) {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
                const imagePart = { inlineData: { data: lastCapturedBase64Image, mimeType: "image/png" } };
                const result = await model.generateContent({ contents: [{ role: "user", parts: [imagePart, { text: metaPrompt }] }], generationConfig: { maxOutputTokens: 300, temperature: 0.5 } });
                optimizedPrompt = result.response.text()?.trim();
            } else { throw new Error("No valid AI API provider for prompt transformation."); }

            if (!optimizedPrompt) throw new Error("LLM failed to produce a Flux prompt from image.");
            optimizedPrompt = optimizedPrompt.replace(/^flux prompt:\s*/i, '').trim();
            console.log("Optimized for Flux (image-aware):", optimizedPrompt);

        } catch (error) {
            console.error(`Error transforming for Flux (image-aware) via ${selectedApiProvider}:`, error);
            event.sender.send('prompt:optimization-error', `Flux (Image) Opt. Failed: ${error.message}`);
            anErrorOccurred = true;
        }
    }
    // else: default is baseDescription (initial value of optimizedPrompt), or an error was already sent.

    if (!anErrorOccurred) {
        event.sender.send('prompt:optimized-result', optimizedPrompt);
    }
});