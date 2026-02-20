import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { ControllerState } from '@cards-ts/core';
import { CardRepository } from '@cards-ts/pocket-tcg/dist/repository/card-repository.js';
import type { InstancedFieldCard } from '@cards-ts/pocket-tcg/dist/repository/card-types.js';

/**
 * Validates game outcome shows no tie - exactly one player wins
 * In Pocket-TCG, victory is determined by points (first to 3 points wins)
 */
export class GameOutcomeValidator {
    static assertNoTie(finalState: ControllerState<Controllers>): { noTie: boolean; winner?: number; details: string } {
        // Check if game ended in completion
        if (!finalState.completed) {
            return { noTie: false, details: 'Game did not complete' };
        }

        // Get player points as victory metric
        const state = finalState;
        const points = (state.points as number[]) || [ 0, 0 ];
        const player0Points = points[0] || 0;
        const player1Points = points[1] || 0;

        /*
         * Check for tie: both have same points
         * NOTE: With basic creature decks, ties should NOT be possible.
         * If both players end with the same points, it indicates a bug in:
         * - Point calculation
         * - Game end condition logic  
         * - Event handling/merging
         */
        if (player0Points === player1Points) {
            return {
                noTie: false,
                details: `BUG DETECTED: Tie game with both players at ${player0Points} points (should never happen with these cards)`,
            };
        }

        // Determine winner
        const winner = player0Points > player1Points ? 0 : 1;
        const winnerPoints = Math.max(player0Points, player1Points);
        const loserPoints = Math.min(player0Points, player1Points);
        
        return {
            noTie: true,
            winner,
            details: `Player ${winner} wins with ${winnerPoints} points vs ${loserPoints} points`,
        };
    }

    static getGameStats(finalState: ControllerState<Controllers>) {
        const state = finalState;
        const points = (state.points as number[]) || [ 0, 0 ];
        
        return {
            player0Points: points[0] || 0,
            player1Points: points[1] || 0,
            player0Creatures: finalState.field.creatures[0]?.length || 0,
            player1Creatures: finalState.field.creatures[1]?.length || 0,
            player0Hand: finalState.hand[0]?.length || 0,
            player1Hand: finalState.hand[1]?.length || 0,
            completed: finalState.completed,
        };
    }

    static getFieldState(finalState: ControllerState<Controllers>, cardRepository?: CardRepository) {
        const state = finalState;
        const maxTurns = (state.params?.maxTurns) || 30;
        const currentTurn = (state.turnCounter?.turnNumber) || 0;
        
        // Extract HP for each player's creatures
        const players: { player: number; active: { hp: number; maxHp: number } | null; bench: { hp: number; maxHp: number }[] }[] = [];
        
        for (let p = 0; p < 2; p++) {
            const fieldCreatures = finalState.field?.creatures?.[p] || [];
            
            const active = fieldCreatures[0] ? this.getCreatureHP(fieldCreatures[0], cardRepository) : null;
            const bench = fieldCreatures.slice(1).map(c => this.getCreatureHP(c, cardRepository));
            
            players.push({ player: p, active, bench });
        }
        
        return {
            maxTurns,
            currentTurn,
            reachedTurnLimit: currentTurn >= maxTurns,
            players,
        };
    }

    private static getCreatureHP(creature: InstancedFieldCard, cardRepository?: CardRepository) {
        // Get the top card in evolution stack to find maxHP
        const topCard = creature.evolutionStack?.[creature.evolutionStack.length - 1];
        const cardData = topCard ? cardRepository?.getCreature(topCard.templateId) : null;
        const maxHp = cardData?.maxHp || 60; // Default to 60 if we can't find card data
        const damage = creature.damageTaken || 0;
        const currentHp = Math.max(0, maxHp - damage);
        
        return { hp: currentHp, maxHp };
    }
}
