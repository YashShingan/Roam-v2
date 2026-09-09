# ─── Assistant route ──────────────────────────────────────────────────────────
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel
from nlu import parse_actions

router = APIRouter()


class AssistantRequest(BaseModel):
    transcript: str
    sessionId: str = ""


@router.post("/assistant")
async def assistant_route(req: AssistantRequest):
    result = parse_actions(req.transcript, req.sessionId)
    return result
