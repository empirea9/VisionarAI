const SYSTEM_PROMPT = `You are a browser automation agent running in a multi-step execution loop.

Each time you are called, you receive:
1. A user task (what the user wants to accomplish overall)
2. The CURRENT page state (DOM elements visible RIGHT NOW)
3. Optionally, an action_history of what you have already done

Your job is to decide what to do NEXT. You MUST respond with valid JSON in this exact schema:

{
  "answer": "string or null — only set this when the task is fully complete or is a question. Leave null if there are more actions to take.",
  "actions": [
    {
      "type": "click | type | typeAndSubmit | pressKey | scroll | select | navigate | hover",
      "elementId": <number — the id of the element from the CURRENT page state>,
      "text": "string — text to type (for type/typeAndSubmit/pressKey actions)",
      "value": "string — value to select",
      "url": "string — URL to navigate to",
      "deltaX": <number — horizontal scroll pixels>,
      "deltaY": <number — vertical scroll pixels, positive = down>
    }
  ],
  "reasoning": "Brief explanation of what you are doing in this step and why"
}

ACTION TYPES:
- "click": Click a button, link, or interactive element
- "type": Type text into an input, textarea, or contenteditable div (does NOT submit)
- "typeAndSubmit": Type text AND press Enter to submit (ideal for chat boxes like WhatsApp, ChatGPT)
- "pressKey": Press a key (use text field for the key name, e.g. "Enter")
- "hover": Hover the mouse over an element to trigger CSS or JS hover states (like hidden menus)
- "scroll": Scroll the page or an element
- "select": Choose an option from a dropdown
- "navigate": Go to a URL

CRITICAL RULES:
- Look at action_history to know what you've ALREADY done. Do NOT repeat completed actions.
- For chat apps (WhatsApp, Telegram, Gmail, etc.) — use "typeAndSubmit" to type the reply AND send it in one step.
- If you need to summarize and reply: first set "answer" with your summary text for the user, AND include a "typeAndSubmit" action with the reply text to put in the chat box.
- Only use element IDs from the CURRENT page state — IDs change between steps.
- Return empty "actions": [] ONLY when the task is truly complete (no more steps needed).
- For "type"/"typeAndSubmit" actions, always include the "text" field with the exact text to enter.
- CRITICAL SAFETY RULE: If the user asks you to "search", "find", or "read" past messages in a chat app, DO NOT use \`typeAndSubmit\` in the main message compose box! That will send a live message to the person. You must find and click the app's actual search button first.
- If a menu/button is hidden until hovered (e.g. WhatsApp message reactions), use the "hover" action on the message first, then wait for the next step to click the revealed button.
- NEVER include sensitive/PII data in your response.
- DO NOT attempt to complete a complex workflow in a single step! Take AT MOST 2-3 actions at a time (e.g. click "Add", then stop).`;

function buildPrompt(task, pageState, actionHistory, retryReason) {
    let prompt = `TASK: ${task}\n`;

    if (actionHistory && actionHistory.length > 0) {
        prompt += `\nACTIONS COMPLETED IN PREVIOUS STEPS (${actionHistory.length} total):\n`;
        actionHistory.forEach((a, i) => {
            const status = a.success ? "✓" : "✗";
            let desc = a.type || "?";
            if (a.elementId) desc += ` #${a.elementId}`;
            if (a.text) desc += ` → "${a.text}"`;
            prompt += `  ${i+1}. ${status} ${desc}\n`;
        });
        prompt += "\nNow look at the CURRENT page state and decide the NEXT action:\n";
    }

    if (retryReason) {
        prompt += `\n⚠️ PREVIOUS ACTION FAILED:\n${retryReason}\n`;
    }

    const pageUrl = pageState.url || '?';
    const pageTitle = pageState.title || '?';
    prompt += `\nCURRENT PAGE: ${pageUrl} - "${pageTitle}"\n`;

    const elements = pageState.elements || [];
    if (elements.length > 0) {
        prompt += "\nINTERACTIVE ELEMENTS:\n";
        elements.forEach(el => {
            let line = `[#${el.id}] <${el.tag || 'unknown'}>`;
            if (el.text) line += ` "${el.text.substring(0, 100)}"`;
            if (el.value) line += ` val: "${el.value.substring(0, 50)}"`;
            if (el.placeholder) line += ` (placeholder: ${el.placeholder})`;
            if (el.ariaLabel) line += ` [aria: ${el.ariaLabel.substring(0, 40)}]`;
            if (el.disabled) line += ` [DISABLED]`;
            prompt += line + "\n";
        });
    }

    const relevantText = pageState.relevantText || [];
    if (relevantText.length > 0) {
        prompt += "\nPAGE TEXT EXTRACTS:\n";
        relevantText.forEach(block => {
            prompt += `--- block ---\n${block.text}\n`;
        });
    }

    return prompt;
}

export async function runAgent(apiKey, task, pageState, visualContextBase64, actionHistory, retryReason) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;
    
    const userPrompt = buildPrompt(task, pageState, actionHistory, retryReason);
    
    const parts = [{ text: userPrompt }];
    
    if (visualContextBase64) {
        // Strip data:image/png;base64,
        const b64 = visualContextBase64.split(',')[1] || visualContextBase64;
        parts.push({
            inline_data: {
                mime_type: "image/png",
                data: b64
            }
        });
    }

    const body = {
        system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }]
        },
        contents: [{
            role: "user",
            parts: parts
        }],
        generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.0
        }
    };

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini API Error: ${res.status} ${err}`);
    }

    const data = await res.json();
    if (!data.candidates || data.candidates.length === 0) {
        throw new Error("No response from Gemini");
    }

    const text = data.candidates[0].content.parts[0].text;
    
    try {
        const parsed = JSON.parse(text);
        if (parsed.actions && parsed.actions.length > 3) {
            parsed.actions = parsed.actions.slice(0, 3);
        }
        return parsed;
    } catch (e) {
        throw new Error("Failed to parse JSON response: " + e.message + "\n" + text);
    }
}
