"""POST /tts: text -> Ogg/Opus mono speech from Sarvam (the format WhatsApp needs for voice notes)."""
import base64
import os
import re

import httpx
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

router = APIRouter()

SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"
MAX_TTS_CHARS = 2500  # bulbul:v3 limit per request
TTS_LANGUAGES = {"bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"}


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    language_code: str | None = None


def _speakable(text):
    """Drop Markdown/WhatsApp formatting and cut to the TTS limit on a sentence boundary."""
    text = re.sub(r"[*_~`#>]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= MAX_TTS_CHARS:
        return text
    cut = text[:MAX_TTS_CHARS]
    end = max(cut.rfind(p) for p in (". ", "। ", "? ", "! "))
    return cut[: end + 1] if end > MAX_TTS_CHARS // 2 else cut


@router.post("/tts")
async def text_to_speech(body: TtsIn):
    key = os.environ.get("SARVAM_API_KEY", "")
    if not key:
        raise HTTPException(status_code=503, detail="tts not configured")

    text = _speakable(body.text)
    if not text:
        raise HTTPException(status_code=400, detail="empty text")
    language = body.language_code if body.language_code in TTS_LANGUAGES else "hi-IN"

    async with httpx.AsyncClient(timeout=45) as client:
        resp = await client.post(
            SARVAM_TTS_URL,
            headers={"api-subscription-key": key},
            json={
                "text": text,
                "language_code": language,
                "model": "bulbul:v3",
                # Opus needs one of 8/12/16/24/48 kHz; Sarvam returns it in an Ogg container.
                "output_audio_codec": "opus",
                "speech_sample_rate": 24000,
            },
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="tts upstream error")

    audio = b"".join(base64.b64decode(a) for a in resp.json().get("audios", []))
    if not audio:
        raise HTTPException(status_code=502, detail="tts returned no audio")
    return Response(content=audio, media_type="audio/ogg")
