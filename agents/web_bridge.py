"""HTTP bridge: lets the Next.js web app call the real Judge uAgent.

The frontend POSTs a move card's stats; this bridge sends a synchronous
WebJudgeRequest to the configured Judge agent endpoint, waits for the Judge's
structured response, and returns the verdict + coaching to the web app.

Default path:
    Web -> web_bridge -> Judge uAgent -> Coach uAgent -> Judge -> Web

If JUDGE_ADDRESS is not configured, the bridge falls back to core.evaluate() so
local UI development still works, but the hackathon demo should run with
JUDGE_ADDRESS set.

Run:
    uvicorn web_bridge:app --port 8010 --reload

POST /judge
    body: {"name": "ghost_jab_combo", "stats": {"balance_risk": 69.04, ...}}
    -> {"move_name", "deployable", "score", "failing_dims", "reasoning",
        "coach_summary"?, "fixes"?}
"""

from __future__ import annotations

import asyncio
import os
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

import core

load_dotenv()

# Comma-separated origins; defaults to the Next.js dev server.
ALLOWED_ORIGINS = os.getenv("BRIDGE_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
JUDGE_ADDRESS = os.getenv("JUDGE_ADDRESS", "")
JUDGE_ENDPOINT = os.getenv("JUDGE_ENDPOINT", f"http://127.0.0.1:{os.getenv('JUDGE_PORT', '8001')}/submit")
BRIDGE_MODE = os.getenv("BRIDGE_MODE", "agent" if JUDGE_ADDRESS else "core")
AGENT_TIMEOUT_SEC = float(os.getenv("AGENT_BRIDGE_TIMEOUT_SEC", "45"))

app = FastAPI(title="Ghost Fighter Judge Bridge", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CardIn(BaseModel):
    name: str = "move"
    # Accepts the move_card.stats object. Values may be 0-1 or 0-100; core
    # normalizes them. Extra keys are ignored.
    stats: dict[str, float]


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "mode": BRIDGE_MODE,
        "judge_address_configured": bool(JUDGE_ADDRESS),
        "judge_endpoint": JUDGE_ENDPOINT if BRIDGE_MODE == "agent" else None,
    }


@app.post("/judge")
async def judge(card: CardIn) -> dict:
    if BRIDGE_MODE != "agent":
        result = await core.evaluate(card.name, card.stats)
        result["source"] = "core_fallback"
        return result
    if not JUDGE_ADDRESS:
        raise RuntimeError("JUDGE_ADDRESS is required for BRIDGE_MODE=agent")

    request_id = uuid4().hex
    from protocols import WebJudgeRequest, WebJudgeResponse
    from uagents.communication import send_sync_message
    from uagents.resolver import Resolver

    class StaticJudgeResolver(Resolver):
        async def resolve(self, destination: str) -> tuple[str | None, list[str]]:
            if destination == JUDGE_ADDRESS:
                return JUDGE_ADDRESS, [JUDGE_ENDPOINT]
            return None, []

    message = WebJudgeRequest(
        request_id=request_id,
        move_name=card.name,
        stats=card.stats,
    )
    try:
        response = await asyncio.wait_for(
            send_sync_message(
                destination=JUDGE_ADDRESS,
                message=message,
                response_type=WebJudgeResponse,
                resolver=StaticJudgeResolver(),
                timeout=int(AGENT_TIMEOUT_SEC),
            ),
            timeout=AGENT_TIMEOUT_SEC + 5,
        )
        if not isinstance(response, WebJudgeResponse):
            detail = getattr(response, "detail", str(response))
            raise RuntimeError(detail)
        result = response.model_dump()
        result["source"] = "judge_uagent"
        return result
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail=(
                "Timed out waiting for the Judge uAgent. Make sure judge_agent.py "
                "and coach_agent.py are running and JUDGE_ENDPOINT points at the Judge /submit endpoint."
            ),
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Judge uAgent call failed: {exc}") from exc


@app.get("/", response_class=HTMLResponse)
def home() -> str:
    return _PAGE


_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Ghost Fighter — Judge</title>
<style>
  :root { --bg:#0a0a0f; --card:#14141f; --border:#2a2a3d; --text:#e8e8f0;
    --muted:#8888a0; --safe:#3dd68c; --bad:#ff5c5c; --accent:#7c5cff; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:ui-sans-serif,system-ui,sans-serif; background:var(--bg);
    color:var(--text); min-height:100vh; padding:2rem 1rem; }
  .wrap { max-width:560px; margin:0 auto; }
  h1 { font-size:1.05rem; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
  .title { font-size:1.9rem; font-weight:700; margin:.25rem 0 1.25rem; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:16px; padding:1.5rem; }
  label.f { display:block; font-size:.75rem; color:var(--muted); margin:.6rem 0 .2rem; text-transform:uppercase; letter-spacing:.06em; }
  input { width:100%; padding:.55rem .7rem; background:#0e0e16; border:1px solid var(--border);
    border-radius:8px; color:var(--text); font-size:.95rem; }
  .row { display:flex; gap:.75rem; }
  .row > div { flex:1; }
  button { margin-top:1.25rem; width:100%; padding:.7rem; border:none; border-radius:10px;
    background:var(--accent); color:#fff; font-weight:700; font-size:.95rem; cursor:pointer; }
  button:disabled { opacity:.5; cursor:wait; }
  .verdict { display:inline-block; padding:.35rem .8rem; border-radius:999px; font-size:.75rem;
    font-weight:700; letter-spacing:.08em; text-transform:uppercase; margin-bottom:.75rem; }
  .verdict.ok { background:rgba(61,214,140,.15); color:var(--safe); }
  .verdict.no { background:rgba(255,92,92,.15); color:var(--bad); }
  .res { margin-top:1.25rem; }
  .muted { color:var(--muted); font-size:.85rem; line-height:1.5; }
  .dims { margin:.5rem 0; }
  .dims span { display:inline-block; background:rgba(255,92,92,.12); color:var(--bad);
    padding:.2rem .5rem; border-radius:6px; font-size:.72rem; margin:.15rem .25rem 0 0; }
  .coach { margin-top:1rem; padding:1rem; background:rgba(124,92,255,.08);
    border-left:3px solid var(--accent); border-radius:0 8px 8px 0; font-size:.92rem; line-height:1.55; }
  .coach li { margin:.4rem 0 .4rem 1rem; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Ghost Fighter</h1>
  <div class="title">Move Judge</div>
  <div class="card">
    <label class="f">Move name</label>
    <input id="name" value="ghost_jab_combo" />
    <div class="row">
      <div><label class="f">balance_risk</label><input id="balance_risk" type="number" step="0.01" value="0.82" /></div>
      <div><label class="f">smoothness</label><input id="smoothness" type="number" step="0.01" value="0.45" /></div>
    </div>
    <div class="row">
      <div><label class="f">recovery</label><input id="recovery" type="number" step="0.01" value="0.25" /></div>
      <div><label class="f">speed</label><input id="speed" type="number" step="0.01" value="0.7" /></div>
    </div>
    <button id="go" onclick="run()">Judge move</button>
    <div class="muted" style="margin-top:.5rem">Values 0–1 (or 0–100; auto-normalized). Uses the Judge uAgent when JUDGE_ADDRESS is configured.</div>
    <div class="res" id="res"></div>
  </div>
</div>
<script>
async function run() {
  const btn = document.getElementById('go');
  const res = document.getElementById('res');
  btn.disabled = true; res.innerHTML = '<div class="muted">Judging via ASI:One…</div>';
  const stats = {};
  for (const k of ['balance_risk','smoothness','recovery','speed']) {
    const v = parseFloat(document.getElementById(k).value);
    if (!Number.isNaN(v)) stats[k] = v;
  }
  try {
    const r = await fetch('/judge', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name: document.getElementById('name').value || 'move', stats })
    });
    const d = await r.json();
    const cls = d.deployable ? 'ok' : 'no';
    const label = d.deployable ? 'Deployable' : 'Not deployable';
    let html = `<div class="verdict ${cls}">${label}</div>`;
    html += `<div class="muted">score: <b>${d.score}</b></div>`;
    if (d.failing_dims && d.failing_dims.length)
      html += `<div class="dims">${d.failing_dims.map(x=>`<span>${x}</span>`).join('')}</div>`;
    html += `<div class="muted" style="margin-top:.5rem">${d.reasoning||''}</div>`;
    if (d.coach_summary) {
      let fixes = '';
      if (d.fixes) for (const [k,v] of Object.entries(d.fixes)) fixes += `<li><b>${k}:</b> ${v}</li>`;
      html += `<div class="coach"><b>Coach:</b> ${d.coach_summary}<ul>${fixes}</ul></div>`;
    }
    res.innerHTML = html;
  } catch (e) {
    res.innerHTML = `<div class="muted" style="color:var(--bad)">Error: ${e}. Is the bridge running?</div>`;
  } finally { btn.disabled = false; }
}
</script>
</body>
</html>"""
