"""POST /chat: search the rulebook, then have Cerebras write a short cited answer."""
import os

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import retrieval

router = APIRouter()

CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"
# Reranker score below which nothing in the rulebook is treated as relevant.
NOT_FOUND_BELOW = float(os.environ.get("NOT_FOUND_BELOW", "-4"))
NOT_FOUND_REPLY = (
    "I could not find this in the MP Bhumi Vikas Rules, 2012 (consolidated to 6 March 2025). "
    "The rules appear to be silent on it. Please check with the competent authority."
)

REWRITE_SYSTEM = (
    "Rewrite the user's latest message into ONE standalone English search query for the MP Bhumi Vikas "
    "Rules, 2012, using earlier turns only to resolve references like 'it' or 'that'. Keep numbers, units "
    "and rule numbers. The message may be English, Hindi or Hinglish. Output only the query."
)
ANSWER_SYSTEM = (
    "You help a building-permission clerk at the Bhopal Municipal Corporation read the MP Bhumi Vikas Rules, "
    "2012 (consolidated to 6 March 2025; later amendments are NOT included).\n"
    "Answer ONLY from the rule excerpts provided. Reply in the same language as the user's question "
    "(English, Hindi, or Hinglish in Roman script). Be short and direct.\n"
    "Always cite the rule number(s), like **Rule 56**, and quote the key words of the rule exactly. "
    "Copy numbers from tables exactly; never estimate or invent a number. "
    "If the excerpts do not answer the question, say the rules are silent on it. "
    "If the answer depends on a later amendment you cannot see, say so. "
    "You point to the rule; the clerk decides. This is not legal advice."
)


class Turn(BaseModel):
    role: str
    text: str = Field(max_length=4000)


class ChatIn(BaseModel):
    messages: list[Turn] = Field(min_length=1, max_length=40)


def _llm(messages, max_tokens):
    key = os.environ.get("CEREBRAS_API_KEY", "")
    if not key:
        raise HTTPException(status_code=503, detail="llm not configured")
    models = [m for m in (os.environ.get("CEREBRAS_MODEL"), os.environ.get("CEREBRAS_FALLBACK_MODEL")) if m]
    for model in models:
        try:
            r = httpx.post(
                CEREBRAS_URL,
                headers={"Authorization": f"Bearer {key}"},
                json={"model": model, "messages": messages, "temperature": 0, "max_tokens": max_tokens},
                timeout=60,
            )
            if r.status_code == 200:
                return (r.json()["choices"][0]["message"].get("content") or "").strip()
        except httpx.HTTPError:
            pass
    raise HTTPException(status_code=502, detail="llm unavailable")


def _strip_think(text):
    # Reasoning models may prefix a <think>...</think> block.
    return text.split("</think>")[-1].strip()


@router.post("/chat")
def chat(body: ChatIn):
    turns = [{"role": "assistant" if t.role == "model" else "user", "content": t.text} for t in body.messages]
    if turns[-1]["role"] != "user":
        raise HTTPException(status_code=400, detail="last message must be from the user")
    history = turns[-7:]  # keep the prompt small

    query = _strip_think(_llm([{"role": "system", "content": REWRITE_SYSTEM}, *history], 1500)) or turns[-1]["content"]
    hits, _ = retrieval.search(query)
    if not hits or hits[0].get("rerank_score", 0) < NOT_FOUND_BELOW:
        return {"reply": NOT_FOUND_REPLY, "sources": []}

    context = "\n\n".join(
        f"[Rule {h['rule_id']} - {h['title']} | PDF page {h['page_start']}]\n{h['text']}" for h in hits
    )
    system = f"{ANSWER_SYSTEM}\n\nRULE EXCERPTS:\n{context}"
    reply = _strip_think(_llm([{"role": "system", "content": system}, *history], 3000))
    sources = [{"rule_id": h["rule_id"], "title": h["title"], "page": h["page_start"]} for h in hits]
    return {"reply": reply or NOT_FOUND_REPLY, "sources": sources}
