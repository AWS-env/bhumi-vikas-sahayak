import os

import httpx
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()

SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text"
MAX_AUDIO_BYTES = 5 * 1024 * 1024  # Sarvam's REST endpoint takes clips up to ~30 s


@router.post("/stt")
async def speech_to_text(request: Request):
    """Raw audio in the request body -> {"transcript", "language_code"} from Sarvam."""
    key = os.environ.get("SARVAM_API_KEY", "")
    if not key:
        raise HTTPException(status_code=503, detail="stt not configured")

    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio too large")

    content_type = request.headers.get("content-type", "audio/webm")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            SARVAM_STT_URL,
            headers={"api-subscription-key": key},
            files={"file": ("speech", audio, content_type)},
            # "unknown" lets Sarvam detect Hindi / English / Hinglish itself.
            data={"model": "saarika:v2.5", "language_code": "unknown"},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="stt upstream error")

    body = resp.json()
    return {
        "transcript": body.get("transcript", ""),
        "language_code": body.get("language_code"),
    }
