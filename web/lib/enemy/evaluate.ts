// Adversarial evaluation harness.
//
// Runs a player's deck against the full persona pool through the REAL arena
// (lib/arena#simulateFight) and produces a competition-readiness profile:
// win-rate + why-it-loses per persona. It feeds the EXISTING Deployability
// score (it surfaces it, it does not overwrite it).

import type { Fighter, FightResult, MoveCard } from "../types";
import { simulateFight } from "../arena";
import { listPersonas, makePersonaController } from "./personas";
import type { CompetitionReadiness, MatchupResult, Persona } from "./types";

export interface EvaluateOptions {
  /** Matches per persona (seeds vary per match for a fair sample). */
  matchesPerPersona?: number;
  /** Base seed; match k uses baseSeed + k for replayability. */
  baseSeed?: number;
  /** Ticks per match (longer = more decisive). */
  maxTicks?: number;
}

function makeEnemyFighter(persona: Persona, deck: string[]): Fighter {
  return {
    id: `persona_${persona.id}`,
    name: persona.name,
    move_ids: deck,
    stats: {
      speed: 0,
      power: 0,
      smoothness: 0,
      balance_risk: 0,
      recovery: 0,
      deployability: 0,
    },
    created_at: "1970-01-01T00:00:00.000Z",
  };
}

/** Derive a human-readable "why it loses" from the real fight transcripts. */
function diagnoseLosses(playerName: string, losses: FightResult[]): string {
  if (!losses.length) return "Holds up — no losing pattern detected.";
  let hitsTaken = 0;
  let knockdowns = 0;
  let playerWhiffs = 0;
  for (const fight of losses) {
    for (const r of fight.rounds) {
      if (r.defender === playerName && r.event_type === "hit") hitsTaken += 1;
      if (r.defender === playerName && r.event_type === "knockdown") knockdowns += 1;
      if (r.attacker === playerName && (r.event_type === "miss" || r.event_type === "advance"))
        playerWhiffs += 1;
    }
  }
  if (knockdowns >= losses.length)
    return "Balance gets broken — eats knockdowns under pressure.";
  if (playerWhiffs > hitsTaken * 1.5)
    return "Out-spaced — whiffs and advances without landing clean.";
  if (hitsTaken > 0) return "Out-traded — takes more clean hits than it deals.";
  return "Loses the long game on remaining HP.";
}

export async function evaluateDeck(
  playerFighter: Fighter,
  moveMap: Map<string, MoveCard>,
  opts: EvaluateOptions = {},
): Promise<CompetitionReadiness> {
  const matches = opts.matchesPerPersona ?? 5;
  const baseSeed = opts.baseSeed ?? 1;
  const personas = listPersonas();
  const matchups: MatchupResult[] = [];

  for (const persona of personas) {
    const enemy = makeEnemyFighter(persona, playerFighter.move_ids);
    let wins = 0;
    const losses: FightResult[] = [];

    for (let k = 0; k < matches; k++) {
      // Fresh controller per match so the player model does not leak across runs.
      const enemyController = makePersonaController(persona);
      const result = await simulateFight(playerFighter, enemy, moveMap, {
        seed: baseSeed + k * 1000 + persona.id.length,
        controllers: { b: enemyController },
        maxTicks: opts.maxTicks,
      });
      if (result.winner === playerFighter.name) wins += 1;
      else losses.push(result);
    }

    matchups.push({
      personaId: persona.id,
      personaName: persona.name,
      matches,
      wins,
      winRate: wins / matches,
      whyItLoses: diagnoseLosses(playerFighter.name, losses),
    });
  }

  const overallWinRate =
    matchups.reduce((s, m) => s + m.winRate, 0) / (matchups.length || 1);
  const deployability = playerFighter.stats.deployability;
  // Readiness blends real adversarial win-rate with the static scorer signal.
  const readinessScore = Math.round(0.6 * overallWinRate * 100 + 0.4 * deployability);

  const weakest = [...matchups].sort((a, b) => a.winRate - b.winRate)[0];
  const summary = weakest
    ? `${Math.round(overallWinRate * 100)}% win-rate across the persona pool; ` +
      `weakest vs ${weakest.personaName} (${Math.round(weakest.winRate * 100)}%): ${weakest.whyItLoses}`
    : "No personas evaluated.";

  return {
    fighter: playerFighter.name,
    deployability,
    overallWinRate,
    readinessScore,
    matchups,
    summary,
  };
}
