"""
Private Browser Agent — Server Configuration
Loads settings from environment variables / .env file.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from this directory and override existing env vars so live updates to .env take effect
load_dotenv(Path(__file__).parent / ".env", override=True)


class Config:
    """Server configuration — reads from env vars."""

    # Server
    HOST: str = os.getenv("SERVER_HOST", "0.0.0.0")
    PORT: int = int(os.getenv("SERVER_PORT", "8000"))

    # CORS — allow the extension origin
    CORS_ORIGINS: list = os.getenv(
        "CORS_ORIGINS",
        "*"  # In production, restrict to your extension ID
    ).split(",")

    # LLM
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "gemini")
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "gemini-3.0-flash")

    # Limits
    MAX_ELEMENTS: int = int(os.getenv("MAX_ELEMENTS", "150"))
    MAX_REQUEST_SIZE: int = int(os.getenv("MAX_REQUEST_SIZE", str(10 * 1024 * 1024)))  # 10 MB


config = Config()
