"""
Private Browser Agent — Pydantic Models
Mirrors the TypeScript types used by the extension.
"""

from pydantic import BaseModel, Field
from typing import Optional


class PageElement(BaseModel):
    id: int
    type: str = ""
    tag: str = ""
    text: str = ""
    ariaLabel: Optional[str] = ""
    placeholder: Optional[str] = ""
    href: Optional[str] = None
    value: Optional[str] = None
    checked: Optional[bool] = False
    disabled: Optional[bool] = False
    bbox: Optional[list] = None


class PageState(BaseModel):
    url: str = ""
    title: str = ""
    viewport: Optional[list] = None
    elements: list[PageElement] = Field(default_factory=list)
    media: Optional[list] = Field(default_factory=list)
    relevantText: Optional[list] = Field(default_factory=list)


class PrivacyInfo(BaseModel):
    processed: bool = False
    redacted: int = 0
    regions: list = Field(default_factory=list)


class AgentRequest(BaseModel):
    task: str
    page_state: PageState
    visual_context: Optional[str] = None  # base64 image data URL
    privacy: Optional[PrivacyInfo] = None
    action_history: Optional[list] = None  # List of completed actions from previous steps
    retry_reason: Optional[str] = None     # Explanation of why the last step failed


class AgentAction(BaseModel):
    type: str                             # click | type | scroll | select | navigate
    elementId: Optional[int] = None
    text: Optional[str] = None
    value: Optional[str] = None
    url: Optional[str] = None
    deltaX: Optional[int] = None
    deltaY: Optional[int] = None
    clear: Optional[bool] = True


class AgentResponse(BaseModel):
    answer: Optional[str] = None
    actions: list[AgentAction] = Field(default_factory=list)
    reasoning: Optional[str] = None
