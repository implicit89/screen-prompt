# Screen-to-LLM Describer MVP

A Minimum Viable Product (MVP) of a desktop application for macOS and Windows that allows users to select an area of their screen and receive an AI-generated description of its contents.

## Core Technologies

* **Desktop Framework:** Electron
* **Backend Language (Main Process):** Node.js
* **AI/LLM Service Integration:** Supports configurable AI service providers for image description.
* **Image Processing:** `sharp` (for cropping)

## Setup Instructions

1.  **Prerequisites:**
    * Node.js (which includes npm). Download from [nodejs.org](https://nodejs.org/).
    * An API Key from your chosen AI Service Provider that supports vision capabilities.

2.  **Clone the Repository (or Create Files):**
    If you cloned a Git repository:
    ```bash
    git clone <repository-url>
    cd screen-to-llm-describer
    ```
    If you created the files manually, navigate to the project's root directory.

3.  **Install Dependencies:**
    Open your terminal or command prompt in the project root and run:
    ```bash
    npm install
    ```
    This will install Electron and all other necessary dependencies.
    *Note on `sharp`*: `sharp` is a native Node.js module. `npm install` usually handles fetching the correct prebuilt binary. If you encounter issues, especially after packaging or switching Node.js/Electron versions, you might need to rebuild it using the script in `package.json`:
    `npm run rebuild-sharp`.

4.  **Configure AI Service Provider & API Keys:**
    This application requires API credentials to communicate with an AI service for image description. Configuration is done via an `.env` file in the project root.

    * **Create the `.env` file:**
        Copy the `.env_example` file to a new file named `.env`:
        ```bash
        cp .env_example .env
        ```
        (On Windows, use `copy .env_example .env`)

    * **Edit the `.env` file:**
        Open the `.env` file in a text editor. It should look like this:
        ```
        OPENAI_API_KEY=your_openai_api_key_here
        GOOGLE_API_KEY=your_google_api_key_here
        API_PROVIDER=openai # Set to "openai" or "gemini"
        ```

    * **Set the `API_PROVIDER`:**
        Change the value of `API_PROVIDER` to specify which AI service you want to use. Currently supported values are:
        * `openai`
        * `gemini`
        Example:
        ```
        API_PROVIDER=gemini
        ```

    * **Set the API Key for the Chosen Provider:**
        * If `API_PROVIDER=openai`, fill in your OpenAI API key for `OPENAI_API_KEY`.
        * If `API_PROVIDER=gemini`, fill in your Google AI Studio API key for `GOOGLE_API_KEY`. You can obtain a Google API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
        * Leave the API key for the unused provider blank or as is (it won't be used if that provider isn't selected).

        Example for using Gemini:
        ```
        OPENAI_API_KEY=
        GOOGLE_API_KEY=your_actual_google_ai_studio_key_here
        API_PROVIDER=gemini
        ```

    * **Security Note:** This method of storing API keys is suitable for local development and this MVP. For a production application, consider more secure key management solutions. The `.env` file should be included in your `.gitignore` file to prevent accidental commits of sensitive keys.

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
    * **macOS:** Right-click the application icon in the Dock (if it appears) and select "Quit", or ensure the app has focus and press `Cmd + Q`.
    * **Windows/Linux:** Closing the result window will not quit the background app. You may need to find the process in Task Manager or use `Ctrl+C` in the terminal where you ran `npm start`. (A system tray icon for management is out of scope for MVP).

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

* Advanced selection methods (circular, freehand drawing).
* Integration with additional local or cloud-based AI/LLM services beyond the initially configured ones.
* Detailed progress indicators or loading animations.
* Application settings or configuration user interface (beyond `.env` file).
* Support for multi-monitor screen selection beyond the primary display.
* Advanced, production-grade API key management solutions.
* System tray icon for managing the background application.