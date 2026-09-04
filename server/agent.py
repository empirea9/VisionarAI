"""
Private Browser Agent — LLM Agent (Gemini)
Builds prompts from PageState + task, calls Gemini, parses structured actions.
Uses the new google.genai SDK.
"""

import json
from google import genai
from google.genai import types
from config import config
from models import AgentResponse, AgentAction


# ── Configure Gemini client ─────────────────────────────────────

client = genai.Client(api_key=config.LLM_API_KEY)


# ── System prompt ───────────────────────────────────────────────

SYSTEM_PROMPT = """You are a browser automation agent running in a multi-step execution loop.

Each time you are called, you receive:
1. A user task (what the user wants to accomplish overall)
2. The CURRENT page state (DOM elements visible RIGHT NOW — this may have changed after your previous actions)
3. Optionally, an action_history of what you have already done in previous steps

Your job is to decide what to do NEXT. You MUST respond with valid JSON in this exact schema:

{
  "answer": "string or null — only set this when the task is fully complete or is a question. Leave null if there are more actions to take.",
  "actions": [
    {
      "type": "click | type | typeAndSubmit | pressKey | scroll | select | navigate | hover",
      "elementId": <number — the id of the element from the CURRENT page state>,
      "text": "string — text to type (for type/typeAndSubmit/pressKey actions)",
      "value": "string — value to select (only for select action)",
      "url": "string — URL to navigate to (only for navigate action)",
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
- CRITICAL SAFETY RULE: If the user asks you to "search", "find", or "read" past messages in a chat app, DO NOT use `typeAndSubmit` in the main message compose box! That will send a live message to the person. You must find and click the app's actual search button first.
- If a menu/button is hidden until hovered (e.g. WhatsApp message reactions), use the "hover" action on the message first, then wait for the next step to click the revealed button.
- NEVER include sensitive/PII data in your response.
- DO NOT attempt to complete a complex workflow in a single step! Take AT MOST 2-3 actions at a time (e.g. click "Add", then stop). You will be called again in a loop to re-observe the new DOM state. This is critical for dynamic sites like Google Forms.
"""


# ── Build the user prompt ───────────────────────────────────────

def _build_prompt(task: str, page_state: dict, visual_context: str | None, action_history: list | None = None, retry_reason: str | None = None) -> str:
    """Build a concise prompt from the task + page state."""

    parts = []
    parts.append(f"TASK: {task}")

    # Show what has already been done
    if action_history:
        parts.append(f"\nACTIONS COMPLETED IN PREVIOUS STEPS ({len(action_history)} total):")
        for i, a in enumerate(action_history):
            status = "✓" if a.get("success") else "✗"
            desc = a.get("type", "?")
            if a.get("elementId"):
                desc += f" #{a['elementId']}"
            if a.get("text"):
                desc += f' → "{a["text"]}"'
            parts.append(f"  {i+1}. {status} {desc}")
        parts.append("\nNow look at the CURRENT page state and decide the NEXT action:")

    if retry_reason:
        parts.append(f"\n⚠️ PREVIOUS ACTION FAILED:\n{retry_reason}")

    page_url = page_state.get('url', '?')
    page_title = page_state.get('title', '?')
    parts.append(f'\nCURRENT PAGE: {page_url} - "{page_title}"')

    # Elements — compact format
    elements = page_state.get("elements", [])
    if elements:
        parts.append(f"\nVISIBLE ELEMENTS ({len(elements)}):")
        for el in elements[:config.MAX_ELEMENTS]:
            line = f"  [{el['id']}] {el.get('type', el.get('tag', '?'))}"
            if el.get("text"):
                text_preview = el["text"][:60]
                line += f' "{text_preview}"'
            if el.get("value"):
                val_preview = el["value"][:60]
                line += f' [value: "{val_preview}"]'
            if el.get("checked"):
                line += " [CHECKED]"
            if el.get("href"):
                line += f" -> {el['href'][:80]}"
            if el.get("placeholder"):
                line += f" (placeholder: {el['placeholder'][:40]})"
            if el.get("ariaLabel"):
                line += f" [aria: {el['ariaLabel'][:40]}]"
            if el.get("disabled"):
                line += " [DISABLED]"
            parts.append(line)

    # Relevant text
    texts = page_state.get("relevantText", [])
    if texts:
        parts.append(f"\nPAGE TEXT ({len(texts)} blocks):")
        for t in texts[:30]:
            tag = t.get('tag', '?')
            txt = t.get('text', '')[:120]
            parts.append(f"  <{tag}> {txt}")

    # OCR / Vision text (if any)
    if visual_context and isinstance(visual_context, str) and not visual_context.startswith("data:"):
        parts.append(f"\nVISUAL CONTEXT:\n{visual_context[:2000]}")

    return "\n".join(parts)


# ── Main agent function ────────────────────────────────────────

async def run_agent(task: str, page_state: dict, visual_context: str | None = None, action_history: list | None = None, retry_reason: str | None = None) -> AgentResponse:
    """
    Send the task + page state to Gemini and return a structured response.
    """

    user_prompt = _build_prompt(task, page_state, visual_context, action_history, retry_reason)

    # Build content parts
    content_parts = [
        types.Part.from_text(text=SYSTEM_PROMPT + "\n\n" + user_prompt)
    ]

    # If visual_context is a base64 data URL, include it as an image
    if visual_context and visual_context.startswith("data:image"):
        import base64
        header, b64data = visual_context.split(",", 1)
        mime = header.split(":")[1].split(";")[0]
        image_bytes = base64.b64decode(b64data)
        content_parts.append(
            types.Part.from_bytes(data=image_bytes, mime_type=mime)
        )

    # Call Gemini
    response = client.models.generate_content(
        model=config.LLM_MODEL,
        contents=content_parts,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.2,
        ),
    )

    # Parse the JSON response
    try:
        text = response.text.strip()
        # Handle markdown code fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            text = text.rsplit("```", 1)[0]

        data = json.loads(text)
    except (json.JSONDecodeError, Exception) as e:
        return AgentResponse(
            answer=f"I understood your request but had trouble formatting the response: {response.text[:300]}",
            actions=[],
            reasoning=f"JSON parse error: {str(e)}"
        )

    # Build typed response and enforce a hard limit of 3 actions per step
    # to force the agent to stop and re-observe dynamic pages
    actions = []
    for a in data.get("actions", [])[:3]:
        actions.append(AgentAction(
            type=a.get("type", "click"),
            elementId=a.get("elementId"),
            text=a.get("text"),
            value=a.get("value"),
            url=a.get("url"),
            deltaX=a.get("deltaX"),
            deltaY=a.get("deltaY"),
        ))

    return AgentResponse(
        answer=data.get("answer"),
        actions=actions,
        reasoning=data.get("reasoning", "")
    )
