# Ghost Fighter Agents (Judge + Coach)

Two cooperating Fetch.ai uAgents that decide whether a move card is deployable
to a humanoid robot, and coach the failing dimensions.

```text
move card → JUDGE (safety gate + ASI:One) → if not deployable
          → COACH (ASI:One targeted fixes) → verdict + fixes back to caller
```

- **`judge_agent.py`** — chat-facing (ASI:One). Hybrid: deterministic safety
  gate first (`balance_risk > 0.7` or `recovery < 0.3` auto-fail, LLM cannot
  override), then ASI:One for nuanced judgment + explanation.
- **`coach_agent.py`** — returns one concrete fix per failing dimension.
- **`protocols.py`** — the internal structured Judge↔Coach channel
  (`MoveFixRequest` / `MoveFixResponse`), kept separate from the chat protocol.
- **`sample_caller.py`** — local smoke test (no ASI:One UI needed).

## Setup

```bash
cd agents
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in ASI_API_KEY, AGENTVERSE_API_KEY
```

## Run (local + mailbox)

```bash
# 1) Start the Coach, copy its printed agent1q... address into .env as COACH_ADDRESS
python coach_agent.py

# 2) Start the Judge (reads COACH_ADDRESS), copy its address into .env as JUDGE_ADDRESS
python judge_agent.py

# 3) (optional) Smoke test without ASI:One
python sample_caller.py
```

For each agent, open the Agent Inspector link in its logs and connect the
mailbox so ASI:One can reach the Judge.

## Move card format

Stats are floats in `[0, 1]` (values `> 1` are auto-divided by 100 so the
repo's existing `move_cards/*.json` 0–100 cards also work):

```json
{"name":"ghost_jab","stats":{"balance_risk":0.8,"smoothness":0.6,"recovery":0.2,"speed":0.7,"executability":0.5}}
```

Verdict shape: `{deployable: bool, score: float, failing_dims: [str], reasoning: str}`.
