import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException

from app.chat import router as chat_router, start_warm_up
from app.stt import router as stt_router
from app.tts import router as tts_router


def require_bff(x_bff_secret: str = Header(default="")):
    """Only the Next.js BFF knows this secret; direct calls are rejected."""
    expected = os.environ.get("BFF_SHARED_SECRET", "")
    if not expected or not hmac.compare_digest(x_bff_secret, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


app = FastAPI(
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    dependencies=[Depends(require_bff)],
)


app.include_router(chat_router)
app.add_event_handler("startup", start_warm_up)
app.include_router(stt_router)
app.include_router(tts_router)


@app.get("/health")
def health():
    return {"status": "ok"}
