import logging
import os

import httpx
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()
log = logging.getLogger("uvicorn.error")

SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text"
MAX_AUDIO_BYTES = 5 * 1024 * 1024  # Sarvam's REST endpoint takes clips up to ~30 s
MIN_AUDIO_BYTES = 1000  # anything smaller is a mis-click, not speech

# Sarvam rejects MIME strings with parameters ("audio/webm;codecs=opus"), so only the bare type is sent.
ALLOWED_TYPES = {
    "audio/webm", "audio/ogg", "audio/opus", "audio/mp4", "audio/x-m4a", "audio/aac",
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/flac",
}


@router.post("/stt")
async def speech_to_text(request: Request):
    """Raw audio in the request body -> {"transcript", "language_code"} from Sarvam."""
    key = os.environ.get("SARVAM_API_KEY", "")
    if not key:
        raise HTTPException(status_code=503, detail="stt_not_configured")

    audio = await request.body()
    if len(audio) < MIN_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="audio_too_short")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio_too_long")

    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_TYPES:
        content_type = "audio/webm"

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                SARVAM_STT_URL,
                headers={"api-subscription-key": key},
                files={"file": ("speech", audio, content_type)},
                # "unknown" lets Sarvam detect Hindi / English / Hinglish itself.
                data={"model": "saarika:v2.5", "language_code": "unknown"},
            )
    except httpx.HTTPError as e:
        log.error("sarvam stt unreachable: %r", e)
        raise HTTPException(status_code=502, detail="stt_unreachable")

    if resp.status_code != 200:
        log.error("sarvam stt error %s: %s", resp.status_code, resp.text[:500])
        if resp.status_code == 429:
            raise HTTPException(status_code=503, detail="stt_busy")
        raise HTTPException(status_code=502, detail="stt_failed")

    body = resp.json()
    return {
        "transcript": (body.get("transcript") or "").strip(),
        "language_code": body.get("language_code"),
    }
