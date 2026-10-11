"""POST /chat: understand the question, search the rulebook, have Cerebras write a short cited answer."""
import json
import logging
import os
import re
import threading

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import retrieval

router = APIRouter()
log = logging.getLogger("uvicorn.error")

CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"
# Reranker score below which nothing in the rulebook is treated as relevant.
NOT_FOUND_BELOW = float(os.environ.get("NOT_FOUND_BELOW", "-4"))
# Chunks whose rule 2(5) definition decides who grants permission - the part amended on 28 Aug 2026.
AMENDMENT_HINT = re.compile(r"authority having jurisdiction|development permission|विकास अनुज्ञा", re.I)

LANGUAGE_NAMES = {
    "english": "English",
    "hindi": "Hindi written in Devanagari script (देवनागरी) - do NOT use Roman letters for Hindi words",
    "hinglish": "Hinglish: Hindi written in Roman letters, the way the user wrote",
}
DEVANAGARI = re.compile(r"[ऀ-ॿ]")


def language_rule(language):
    return (
        f"LANGUAGE: write the entire reply in {LANGUAGE_NAMES[language]}. Rule numbers, numbers with units and "
        "quoted rule text stay exactly as in the rulebook (quotes may stay in English)."
    )


ROUTER_SYSTEM = (
    "You prepare a clerk's message for a search of the Madhya Pradesh Bhumi Vikas Rules, 2012 (building "
    "permission, plots, setbacks, FAR, fees, floors, lifts, parking, electric-line clearances, authorities).\n"
    "Reply with ONLY a JSON object: {\"intent\": \"rules\" or \"chitchat\", \"language\": \"english\" or "
    "\"hindi\" or \"hinglish\", \"queries\": [\"...\"]}.\n"
    "- intent \"chitchat\": greetings, thanks, 'who are you', 'what can you do', or anything with no "
    "question about land, buildings or the rules.\n"
    "- intent \"rules\": any question that might be answered by the rules, including ones the rules may not "
    "cover.\n"
    "- queries: 1 to 3 standalone English search queries, one per distinct thing the user asks (a question about "
    "height AND fee needs two queries). Use earlier turns only to resolve words like 'it' or 'that'; keep every "
    "number, unit and rule number. Use plain keywords as a rulebook would word them (e.g. 'lift required "
    "building height', 'rear open space residential plot area', 'building permission fee residential built-up "
    "area'). NEVER put the rulebook name, 'Madhya Pradesh', 'Bhumi Vikas', 'rules' or the year in a query - they "
    "only pull in irrelevant pages. For chitchat use an empty list.\n"
    "Hinglish glossary: zameen/jagah/plot = land/plot; makaan/ghar = house; dukaan = shop; naksha = plan; "
    "manzil/majil = floor/storey; chhat = roof; seedhi = staircase; hadap/kabza/atikraman = encroachment; "
    "padosi = neighbour; nakshe ki manzoori/parmission = building permission; fees/shulk = fee; "
    "setback/jagah chhodna = open space/setback; ooncha/unchai = height; chaudai = width; sadak = road."
)

CHITCHAT_SYSTEM = (
    "You are Bhumi Vikas Sahayak, an assistant that helps a building-permission clerk at the Bhopal Municipal "
    "Corporation look up the MP Bhumi Vikas Rules, 2012 (consolidated to 6 March 2025). Reply briefly and "
    "politely. If it is a greeting or 'what can you do', say what you can do and give 2 or 3 example questions "
    "(open space for a plot, building permission fee, who can sign plans). Do NOT answer any rules question "
    "here and do not invent facts. "
)

NOTFOUND_SYSTEM = (
    "You are Bhumi Vikas Sahayak, helping a clerk read the MP Bhumi Vikas Rules, 2012 (consolidated to "
    "6 March 2025). A search found nothing in the rulebook relevant to the user's question. Say clearly and "
    "plainly, in one or two sentences, that the rules do not mention this topic, name the topic, and suggest "
    "checking with the competent authority or the relevant law. Then say what you CAN help with (building "
    "permission, open spaces/setbacks, FAR, fees, heights, lifts, electric-line clearances). Never guess an "
    "answer. "
)

ANSWER_SYSTEM = (
    "You help a building-permission clerk at the Bhopal Municipal Corporation read the MP Bhumi Vikas Rules, "
    "2012. The excerpts below come from the version consolidated to 6 March 2025; later amendments are NOT "
    "included. Answer ONLY from those excerpts.\n"
    "FORMAT: give the direct answer first, in one or two short sentences, then the supporting rule text. Cite "
    "every rule like **Rule 56(1)(a)** and quote the key words of the rule exactly, in quotation marks. Copy "
    "every number from a table exactly; never estimate, round or invent one. Use a markdown table only when "
    "the excerpt itself is a table.\n"
    "BE EXPLICIT ABOUT WHAT THE RULES DO NOT SAY:\n"
    "- If the user asks about several things, answer each one separately and state plainly which part the "
    "excerpts do not cover, e.g. \"The rules do not mention X.\" Never fill a gap with a guess.\n"
    "- If something is prohibited, say \"Not permitted\" and cite the rule. If it is allowed only under "
    "conditions, list the conditions.\n"
    "- If the answer depends on a fact the user did not give (plot area, road width, building height, use), "
    "say which fact is needed and give the answer for each case in the excerpts.\n"
    "- If the excerpts are only loosely related, say so instead of stretching them.\n"
    "- NEVER treat silence as a ban: if the excerpts do not mention something, say \"the rules do not mention "
    "it\" - do not say it is permitted and do not say it is prohibited. Say \"Not permitted\" only when an "
    "excerpt itself prohibits it. A table with no row for the user's value (e.g. no row for a 9 m road) means "
    "\"the table does not cover that value\" - never conclude that something is refused or \"cannot be "
    "approved\" from a missing row; say what the table covers and tell the clerk to confirm with the Authority.\n"
    "End with nothing else: no disclaimers, the app adds them. "
)


class Turn(BaseModel):
    role: str
    text: str = Field(max_length=4000)


class ChatIn(BaseModel):
    messages: list[Turn] = Field(min_length=1, max_length=40)


def warm_up():
    """Load the search models once at startup so the first question isn't slow."""
    try:
        retrieval.search("rear open space for residential plot")
        log.info("retrieval models warmed up")
    except Exception as e:  # missing keys etc. must not stop the server booting
        log.warning("retrieval warm-up skipped: %r", e)


def start_warm_up():
    threading.Thread(target=warm_up, daemon=True).start()


def _llm(messages, max_tokens):
    key = os.environ.get("CEREBRAS_API_KEY", "")
    models = [m for m in (os.environ.get("CEREBRAS_MODEL"), os.environ.get("CEREBRAS_FALLBACK_MODEL")) if m]
    if not key or not models:
        raise HTTPException(status_code=503, detail="llm_not_configured")
    for model in models:
        try:
            r = httpx.post(
                CEREBRAS_URL,
                headers={"Authorization": f"Bearer {key}"},
                json={"model": model, "messages": messages, "temperature": 0, "max_tokens": max_tokens},
                timeout=60,
            )
            if r.status_code == 200:
                text = (r.json()["choices"][0]["message"].get("content") or "").strip()
                if text:
                    return text.split("</think>")[-1].strip()
            else:
                log.warning("cerebras %s on %s: %s", r.status_code, model, r.text[:200])
        except (httpx.HTTPError, KeyError, ValueError) as e:
            log.warning("cerebras call failed on %s: %r", model, e)
    raise HTTPException(status_code=502, detail="llm_unavailable")


def _route(history, question):
    """Returns (intent, language, search_query). Falls back to a plain rules search if the JSON is unusable."""
    try:
        raw = _llm([{"role": "system", "content": ROUTER_SYSTEM}, *history], 1500)
        obj = json.loads(re.search(r"\{.*\}", raw, re.S).group(0))
        intent = "chitchat" if obj.get("intent") == "chitchat" else "rules"
        language = obj.get("language") if obj.get("language") in ("english", "hindi", "hinglish") else "english"
        queries = [q.strip() for q in (obj.get("queries") or []) if isinstance(q, str) and q.strip()][:3]
        return intent, language, queries or [question]
    except HTTPException:
        raise
    except Exception as e:
        log.warning("router output unusable: %r", e)
        return "rules", "english", [question]


@router.post("/chat")
def chat(body: ChatIn):
    turns = [{"role": "assistant" if t.role == "model" else "user", "content": t.text} for t in body.messages]
    if turns[-1]["role"] != "user" or not turns[-1]["content"].strip():
        raise HTTPException(status_code=400, detail="last_message_must_be_user")
    history = turns[-7:]  # keep the prompt small

    intent, language, queries = _route(history, turns[-1]["content"])
    if DEVANAGARI.search(turns[-1]["content"]):
        language = "hindi"  # script is a certain signal; the model's guess is not
    elif language == "hindi":
        language = "hinglish"  # Roman letters can never be Devanagari Hindi
    lang = language_rule(language)
    base = {"language": language, "sources": [], "amendment_warning": False}

    def say(system, tokens=1500):
        return _llm([{"role": "system", "content": f"{system}\n{lang}"}, *history], tokens)

    if intent == "chitchat":
        return {**base, "reply": say(CHITCHAT_SYSTEM)}

    # One search per distinct thing asked; keep each chunk's best score, then take the top 8 overall.
    best = {}
    for q in queries:
        for h in retrieval.search(q, k_retrieve=30, k_final=6)[0]:
            if h["chunk_id"] not in best or h["rerank_score"] > best[h["chunk_id"]]["rerank_score"]:
                best[h["chunk_id"]] = h
    hits = sorted(best.values(), key=lambda h: -h["rerank_score"])[:8]
    if not hits or hits[0].get("rerank_score", 0) < NOT_FOUND_BELOW:
        return {**base, "reply": say(NOTFOUND_SYSTEM)}

    context = "\n\n".join(
        f"[Rule {h['rule_id']} - {h['title']} | PDF page {h['page_start']}]\n{h['text']}" for h in hits
    )
    reply = say(f"{ANSWER_SYSTEM}\n\nRULE EXCERPTS:\n{context}", 3000)

    seen, sources = set(), []
    for h in hits:
        if h["rule_id"] not in seen:
            seen.add(h["rule_id"])
            sources.append({"rule_id": h["rule_id"], "title": h["title"], "page": h["page_start"]})
    return {**base, "reply": reply, "sources": sources, "amendment_warning": bool(AMENDMENT_HINT.search(" ".join(queries)))}
