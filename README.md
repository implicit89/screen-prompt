# Screen Prompt

A desktop application for macOS and Windows that allows users to select an area of their screen and receive an AI-generated description of its contents.

## Core Technologies

* **Desktop Framework:** Electron
* **Backend Language (Main Process):** Node.js
* **AI/LLM Service Integration:** Supports configurable AI service providers for image description.
* **Image Processing:** `sharp` (for cropping)

## Setup Instructions

1.  **Prerequisites:**
    * Node.js (which includes npm). Download from [nodejs.org](https://nodejs.org/).
    * An API Key from your chosen AI Service Provider that supports vision capabilities or a local ollama server.

2.  **Clone the Repository:**
    ```bash
    git clone https://github.com/implicit89/screen-prompt.git
    cd screen-prompt
    ```

3.  **Install Dependencies:**
    Open your terminal or command prompt in the project root and run:
    ```bash
    npm install
    ```
    This will install Electron and all other necessary dependencies.
    *Note on `sharp`*: `sharp` is a native Node.js module. `npm install` usually handles fetching the correct prebuilt binary. If you encounter issues, especially after packaging or switching Node.js/Electron versions, you might need to rebuild it using the script in `package.json`:
    `npm run rebuild-sharp`.

4.  **Configure AI Service Provider & API Keys:**
    Configuration of your chosen AI Service Provider (OpenAI, Google Gemini, or a Local Server like Ollama) is primarily managed through the **in-app Settings page**. This is the recommended method. The `.env` file method is secondary and can be used for initial fallback, especially for OpenAI and Gemini API keys.

    *   **Using the In-App Settings Page (Recommended):**
        Access the Settings page via the application menu (File > Settings or Screen Prompt > Settings on macOS) or by pressing `CmdOrCtrl+,`. This is the most comprehensive way to set up your AI provider.

        The Settings page allows you to:
        *   Select the active AI Service Provider (OpenAI, Google Gemini, or Local Server (Ollama)).
        *   Enter API keys for OpenAI and Google Gemini.
        *   Configure all necessary details for the Local Server (Ollama) provider.

    *   **Configuring Specific Providers via Settings Page:**

        *   **OpenAI or Google Gemini:**
            1.  Open Settings.
            2.  Select "OpenAI" or "Google" as the active provider.
            3.  Enter the respective API key in its field.
            4.  Click "Save Settings".

        *   **Local Server (e.g., Ollama):**
            1.  Ensure your local LLM server (like Ollama with a model like LLaVA) is running.
            2.  Open Settings in Screen Prompt.
            3.  Select "Local Server (Ollama)" as the active provider.
            4.  Fill in the following fields:
                *   **Local Server URL (Ollama):** The base URL of your Ollama server (e.g., `http://localhost:11434`).
                *   **Ollama Model Name:** The name of the model you want to use (e.g., `llava:7b`, `bakllava`).
                *   **Ollama API Endpoint Path:** The API path for generation (defaults to `/api/generate`, usually correct for Ollama).
                *   **Custom Ollama Options (JSON):** Optional JSON string for advanced model parameters (e.g., `{"temperature": 0.7, "num_predict": 250}`).
            5.  Click "Save Settings".

    *   **Using the `.env` file (Optional Fallback):**
        If you prefer, you can create a `.env` file in the project root for initial setup, primarily for OpenAI/Gemini API keys if you don't want to use the settings UI for them initially:
        1.  Copy `.env_example` to `.env` in your project root:
            ```bash
            # On macOS/Linux
            cp .env_example .env
            # On Windows
            copy .env_example .env
            ```
        2.  Edit the `.env` file. It may look like this:
            ```
            OPENAI_API_KEY=your_openai_api_key_here
            GOOGLE_API_KEY=your_google_api_key_here
            API_PROVIDER=openai # Can be "openai", "gemini", or "local"
            ```
        3.  The `API_PROVIDER` field in `.env` can set the initial default provider if no settings have been saved via the UI. If `API_PROVIDER=local` is set, its specific parameters (URL, model name, etc.) **must still be configured via the Settings page** to function correctly.
        4.  **Important:** Settings saved through the in-app Settings page will always override the `.env` file for subsequent application launches.

         *   **Security Note:** API keys are sensitive. If you are using the `.env` file (perhaps after cloning the repository for development), ensure it is included in your `.gitignore` file to prevent accidental commits of your personal keys. When sharing the application with others, instruct them to configure their own API keys or local server settings using the in-app Settings page. Settings managed via the UI are stored locally in the application's configuration file (managed by `electron-store`) and are not intended for version control or widespread sharing.

## Running the Application

1.  **Start the Application:**
    With your terminal in the project root, run:
    ```bash
    npm start
    ```
    This command executes `electron .`, starting the Electron application. The application will run in the background. No main window will appear initially.

2.  **Trigger Screen Capture:**
    * **macOS:** Press `Cmd + F12`
    * **Windows/Linux:** Press `Ctrl + F12`

    This global hotkey will activate the screen selection overlay.

3.  **Select Screen Area:**
    * Your mouse cursor will change to a crosshair.
    * Click and drag to draw a rectangle over the area of the screen you want to describe.
    * Release the mouse button to capture the selection.

4.  **View Description:**
    * A small "AI Description" window will appear (usually in the top-right corner of your primary screen) displaying the AI-generated text from the configured service.
    * You can copy the description using the "Copy" button.
    * The "Edit" button is a placeholder for future functionality.

5.  **Cancel Selection:**
    * While the screen selection overlay is active, press the `Escape` key to cancel the selection process and close the overlay.

6.  **Quitting the Application:**
    * **macOS:** Right-click the application icon in the Dock (if it appears) and select "Quit", or ensure the app has focus and press `Cmd + Q`. Alternatively, use the application menu (e.g., Screen Prompt > Quit Screen Prompt).
    * **Windows/Linux:** Right-click the application icon in the system tray and select "Quit Screen Prompt". Closing individual windows (like Results or Settings) will typically not quit the application. If you started the app via `npm start` in a terminal, `Ctrl+C` in that terminal will also stop it.

## Basic Verification Steps

* ✅ **Global Hotkey:** Confirm the hotkey activates the capture overlay.
* ✅ **Rectangular Selection:** Verify that clicking and dragging draws a rectangle with visual feedback.
* ✅ **Capture & Crop:** Upon releasing the mouse, confirm the overlay closes.
* ✅ **AI Description:** Check that a new "AI Description" popup window appears with text generated by the configured AI service.
* ✅ **Copy Button:** Test that the "Copy" button correctly copies the displayed text.
* ✅ **Edit Button Placeholder:** Confirm the "Edit" button's placeholder behavior.
* ✅ **Escape to Cancel:** Verify pressing `Escape` during selection cancels it.
* ✅ **API Key Error:** If the API key for the selected `API_PROVIDER` is missing or invalid, confirm an appropriate error message is shown.
* ✅ **Application Termination:** Ensure global shortcuts are unregistered when the app quits.

## Out of Scope for MVP (Future Work)

* Advanced selection methods (e.g., circular, freehand drawing, specific window selection).
* Support for a wider range of specific cloud AI services or local LLM backends beyond the current OpenAI, Gemini, and configurable Ollama setup.
* Detailed progress indicators or loading animations during AI processing (the current status is basic text in the result window).
* Enhanced multi-monitor support for screen capture (current implementation is primarily focused on the primary display for capture initiation and result window placement).
* Production-grade secure API key management (e.g., using OS-level credential managers like macOS Keychain or Windows Credential Manager). The current system stores settings, including API keys if entered, in a local configuration file managed by `electron-store`.
* A more user-friendly UI for managing multiple local server profiles or a list of favorite Ollama models.
* Automatic application updates.