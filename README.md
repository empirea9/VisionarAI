# VisionarAI (Private Browser Agent)

A privacy-preserving, multimodal browser agent. Your data never leaves your device unredacted. VisionarAI acts as an intelligent assistant capable of understanding complex single-page applications, processing visual layout context, and executing multi-step tasks dynamically.

## Key Features

*   **Multimodal Perception**: Combines DOM analysis with Visual Context (Screenshots) to understand complex spatial relationships, emojis, and layouts that do not exist in standard HTML.
*   **Privacy-First Redaction**: Built-in, aggressive PII detection runs locally in the browser to scrub emails, phone numbers, and SSNs from text and images before anything is sent to the LLM.
*   **Dynamic SPA Navigation**: Intelligently detects and scrolls hidden containers in Single Page Applications instead of blindly scrolling the locked browser window.
*   **Agentic Auto-Correction**: Features an intelligent loop detector that intercepts repetitive failures, prevents infinite loops, and dynamically issues retry instructions (like instructing the agent to use a hover state) to self-correct during a task.
*   **Hidden State Awareness**: Supports synthetic mouse events (hover, mouseenter) to interact with dynamic web apps where menus and buttons only appear upon user hover.

## Core Functions Explained

### 1. handleTask (Service Worker)
This is the core orchestrator of the agentic loop. When a user submits a prompt, `handleTask` initiates the cycle: it queries the active tab for its DOM state, requests a screenshot, passes the data through the privacy redactor, and sends it to the LLM. It then receives a list of structured JSON actions, executes them in sequence, and re-triggers the loop until the task is complete. It also contains the infinite loop detector to catch and correct repetitive AI failures.

### 2. runAgent (Client-Side LLM Caller)
Located in `agent.js`, this function completely replaces the need for a local backend server. It takes the sanitized page state and visual context, constructs a highly specific multimodal prompt, and communicates directly with the Gemini REST API using the API key stored in the extension settings.

### 3. redactPageState & detectTextPII (Privacy Engine)
Before any data leaves the browser, these functions scan both the extracted DOM text and the captured screenshot. `detectTextPII` uses strict regex patterns to identify sensitive data (like phone numbers, emails, and SSNs). `redactPageState` then replaces these strings with generic placeholders (e.g., `[REDACTED_PHONE]`) to ensure the LLM never processes user PII.

### 4. getPerceptionPlan (Perception Router)
This function analyzes the user's prompt to determine how much context the LLM needs. It defaults to providing both DOM and Visual Context (screenshots) to ensure the AI can understand complex spatial layouts, but it can intelligently disable visual processing for incredibly trivial tasks (like simple scrolling) to save bandwidth and compute time.

### 5. executeAction (Action Executor)
Injected directly into the target webpage, this function translates the LLM's JSON commands into physical browser interactions. It supports simulating complex synthetic events (like `mouseover` and `mouseenter` for the `hover` action), typing text into React/Angular managed input fields, and programmatically finding the correct internal scrollable container in modern Single Page Applications.

## Installation & Setup

1. **Install Dependencies & Build Extension**:
   ```bash
   cd extension
   npm install
   npm run build
   ```

2. **Load in Browser**:
   * Open your Chromium-based browser (Chrome, Edge, Brave).
   * Go to `chrome://extensions`.
   * Enable **Developer Mode** (top right toggle).
   * Click **Load unpacked** and select the `extension/` folder from this repository.

3. **Configure API Key**:
   * Click on the extension icon in your toolbar to open the side panel.
   * Click the settings icon in the top right, and paste your **Gemini API Key** into the settings page.
