// const descriptionContainer = document.getElementById('description-container'); // REMOVED
const copyButton = document.getElementById('copy-button');
const editButton = document.getElementById('edit-button');
const statusMessageArea = document.getElementById('status-message-area'); // General feedback

const imageGenModelSelect = document.getElementById('image-gen-model-select');
const optimizedPromptArea = document.getElementById('optimized-prompt-area');
const promptStatusMessage = document.getElementById('prompt-status-message'); // Status for prompt gen

// No currentBaseDescription needed here anymore as it's not shown directly

imageGenModelSelect.addEventListener('change', (event) => {
    const selectedModel = event.target.value;
    promptStatusMessage.textContent = ''; // Clear previous status
    optimizedPromptArea.textContent = `Optimizing for ${selectedModel}... please wait.`;
    imageGenModelSelect.disabled = true;
    window.resultAPI.requestNewOptimizedPrompt(selectedModel);
});

// This is now the main way content is received
window.resultAPI.onOptimizedPromptReady((data) => { // data = { prompt, selectedModel }
    optimizedPromptArea.textContent = data.prompt;
    imageGenModelSelect.value = data.selectedModel; // Ensure dropdown reflects the generated prompt type
    imageGenModelSelect.disabled = false;
    promptStatusMessage.textContent = `Prompt ready for ${data.selectedModel}.`;
});

window.resultAPI.onPromptOptimizationError((errorMessage) => {
    optimizedPromptArea.textContent = `Error: ${errorMessage}\n\nPlease try another option or capture again.`;
    imageGenModelSelect.disabled = false;
    promptStatusMessage.textContent = `Optimization failed.`;
});

copyButton.addEventListener('click', () => {
    const textToCopy = optimizedPromptArea.textContent;
    if (textToCopy && !textToCopy.startsWith("Optimizing for") && !textToCopy.startsWith("Loading prompt...")) {
        window.resultAPI.copyToClipboard(textToCopy)
            .then(message => {
                statusMessageArea.textContent = message || 'Copied!';
                setTimeout(() => { statusMessageArea.textContent = ''; }, 2000);
            })
            .catch(err => {
                statusMessageArea.textContent = 'Copy failed!';
                console.error("Copy failed:", err);
                setTimeout(() => { statusMessageArea.textContent = ''; }, 2000);
            });
    } else {
        statusMessageArea.textContent = 'Nothing to copy yet.';
        setTimeout(() => { statusMessageArea.textContent = ''; }, 2000);
    }
});

editButton.textContent = "Edit Prompt"; // More relevant label now
editButton.title = "Edit the displayed prompt (locally)";
editButton.addEventListener('click', () => {
    // For v1, making the optimizedPromptArea contenteditable="true" is managed by HTML.
    // This button could toggle that, or offer more advanced editing, or be a placeholder.
    if (optimizedPromptArea.isContentEditable) {
        optimizedPromptArea.contentEditable = "false";
        editButton.textContent = "Edit Prompt";
        promptStatusMessage.textContent = "Viewing mode.";
    } else {
        optimizedPromptArea.contentEditable = "true";
        editButton.textContent = "Done Editing";
        optimizedPromptArea.focus();
        promptStatusMessage.textContent = "Editing mode enabled.";
    }
});