"""
Private Browser Agent — FastAPI Server
Receives sanitized context from the Chrome extension,
sends it to Gemini, and returns structured actions.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from config import config
from models import AgentRequest, AgentResponse
from agent import run_agent


# ── App setup ───────────────────────────────────────────────────

app = FastAPI(
    title="Private Browser Agent",
    version="0.1.0",
    description="Server-side reasoning for the privacy-preserving browser agent."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ──────────────────────────────────────────────────────

@app.get("/")
async def root():
    """Root endpoint for browser verification."""
    return {
        "message": "🛡️ Private Browser Agent Server is running. The extension will communicate with /agent."
    }

@app.get("/health")
async def health():
    """Health check endpoint for the extension."""
    return {
        "status": "ok",
        "model": config.LLM_MODEL,
        "provider": config.LLM_PROVIDER
    }


@app.post("/agent", response_model=AgentResponse)
async def agent_endpoint(request: AgentRequest):
    """
    Main agent endpoint.
    Receives: task + sanitized page state + optional visual context
    Returns: answer and/or actions
    """

    if not request.task or not request.task.strip():
        raise HTTPException(status_code=400, detail="Task is required")

    if not config.LLM_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="LLM_API_KEY not configured. Set it in server/.env"
        )

    # Log privacy info
    privacy = request.privacy
    if privacy and privacy.processed:
        print(f"[Privacy] {privacy.redacted} items redacted before reaching server")

    # Run the agent
    try:
        response = await run_agent(
            task=request.task,
            page_state=request.page_state.model_dump(),
            visual_context=request.visual_context,
            action_history=request.action_history or [],
            retry_reason=request.retry_reason
        )
        return response
    except Exception as e:
        error_msg = str(e)
        print(f"[Agent Error] {error_msg}")
        
        # Check for invalid API key from Gemini
        if "API_KEY_INVALID" in error_msg or "API key not valid" in error_msg:
            raise HTTPException(
                status_code=401, 
                detail="Invalid Gemini API Key. Please update the LLM_API_KEY in server/.env with a valid key."
            )
            
        # Check for high demand / rate limits
        if "503 UNAVAILABLE" in error_msg or "high demand" in error_msg.lower():
            raise HTTPException(
                status_code=503,
                detail="Gemini is currently experiencing high demand and is unavailable. Please try again in a few moments."
            )
            
        raise HTTPException(status_code=500, detail=error_msg)


# ── Entry point ─────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    print(f"🛡️  Private Browser Agent Server")
    print(f"   Model:    {config.LLM_MODEL}")
    print(f"   Provider: {config.LLM_PROVIDER}")
    print(f"   Port:     {config.PORT}")
    print()

    uvicorn.run(
        "main:app",
        host=config.HOST,
        port=config.PORT,
        reload=True
    )
