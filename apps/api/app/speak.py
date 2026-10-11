import logging
import os
import re

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
log = logging.getLogger("uvicorn.error")

SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"
MAX_TEXT_CHARS = 6000  # whole answers are read; anything longer is cut here
CHUNK_CHARS = 1400  # bulbul:v3 accepts up to 2500 characters per request
MAX_CHUNKS = 5


class TtsRequest(BaseModel):
    text: str


def _plain(text: str) -> str:
    """Strip markdown so the voice doesn't read out pipes, asterisks and links."""
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^\s*\|?[\s:|-]+\|[\s:|-]*$", "", text, flags=re.M)  # table separator rows
    text = text.replace("|", ", ")
    text = re.sub(r"[*_`#>]+", "", text)
    text = re.sub(r"^\s*[-•]\s+", "", text, flags=re.M)
    return re.sub(r"\s+", " ", text).strip()


def _chunks(text: str) -> list[str]:
    """Split on sentence ends (including the Hindi danda) so each piece fits one request."""
    out: list[str] = []
    cur = ""
    for sentence in re.split(r"(?<=[.!?।])\s+", text):
        while len(sentence) > CHUNK_CHARS:
            cut = sentence.rfind(" ", 0, CHUNK_CHARS) or CHUNK_CHARS
            sentence, rest = sentence[:cut], sentence[cut:].strip()
            if cur:
                out.append(cur)
                cur = ""
            out.append(sentence)
            sentence = rest
        if cur and len(cur) + len(sentence) + 1 > CHUNK_CHARS:
            out.append(cur)
            cur = sentence
        else:
            cur = f"{cur} {sentence}".strip()
    if cur:
        out.append(cur)
    return out[:MAX_CHUNKS]


@router.post("/speak")
async def text_to_speech(req: TtsRequest):
    """Answer text -> {"audios": [base64 wav, ...]} in order, voiced by Sarvam."""
    key = os.environ.get("SARVAM_API_KEY", "")
    if not key:
        raise HTTPException(status_code=503, detail="tts_not_configured")

    text = _plain(req.text)[:MAX_TEXT_CHARS]
    if not text:
        raise HTTPException(status_code=400, detail="tts_empty")

    # Devanagari anywhere -> Hindi voice; otherwise Indian English.
    lang = "hi-IN" if re.search(r"[ऀ-ॿ]", text) else "en-IN"

    audios: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for piece in _chunks(text):
                resp = await client.post(
                    SARVAM_TTS_URL,
                    headers={"api-subscription-key": key},
                    json={
                        "text": piece,
                        "language_code": lang,
                        "model": "bulbul:v3",
                    },
                )
                if resp.status_code != 200:
                    log.error("sarvam tts error %s: %s", resp.status_code, resp.text[:500])
                    if resp.status_code == 429:
                        raise HTTPException(status_code=503, detail="tts_busy")
                    raise HTTPException(status_code=502, detail="tts_failed")
                audios.extend(resp.json().get("audios") or [])
    except httpx.HTTPError as e:
        log.error("sarvam tts unreachable: %r", e)
        raise HTTPException(status_code=502, detail="tts_unreachable")

    if not audios:
        raise HTTPException(status_code=502, detail="tts_failed")
    return {"audios": audios}
