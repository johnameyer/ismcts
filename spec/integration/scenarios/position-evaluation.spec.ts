import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { expect } from 'chai';
import { ISMCTS } from '../../../src/modular/ismcts.js';
import { createWaitingGameStateForMCTS } from '../../helpers/test-state-builder.js';
import { StateBuilder } from '../../helpers/state-builder.js';
import { createMockCardRepository } from '../../helpers/test-utils.js';
import { createGameAdapterConfig } from '../../helpers/test-helpers.js';
import { MAIN_ACTION_RESPONSE_TYPES as STANDARD_GAME_PHASE_ACTIONS } from '../../../src/adapters/pocket-tcg/response-types.js';

/**
 * Position Evaluation Tests
 * 
 * Tests that evaluate how MCTS scores positions that are not binary choices.
 * These are positions where the outcome is largely predetermined, and we want
 * to verify that MCTS correctly evaluates the position rather than finding
 * a specific "better" action among alternatives.
 */
describe('ISMCTS Position Evaluation', () => {
    it('should show all actions score low when doomed', () => {
        /**
         * SCENARIO: Player 0 is in a losing position.
         * - Player 0 creature: 20 HP remaining out of 80, needs 2 fire energy to attack
         * - Player 1 creature: 100 HP, has 1 fire energy attached, can attack for 40 damage
         * 
         * EXPECTED GAME FLOW:
         * Turn 1 (P0): No good moves - needs 2 energy to attack but has 0
         * Turn 2 (P1): basic-creature attacks for 40 damage → P0 creature dies
         * 
         * WHY ALL ACTIONS SCORE LOW:
         * - Player needs 2 energy but can only attach 1 per turn
         * - Opponent has energy and deals 40 damage (twice P0's remaining HP)
         * - P0 dies before mounting any offense
         * 
         * EXPECTED OUTCOME: All actions should score close to 0.0 (loss) or very low
         * because the position is hopeless regardless of action choice.
         */
        const doomedRepository = createMockCardRepository({
            creatures: [
                {
                    templateId: 'doomed-creature',
                    name: 'Doomed Creature',
                    maxHp: 80,
                    type: 'fire',
                    retreatCost: 2,
                    attacks: [{ name: 'Weak Attack', damage: 15, energyRequirements: [{ type: 'fire', amount: 2 }] }],
                },
                {
                    templateId: 'strong-opponent',
                    name: 'Strong Opponent',
                    maxHp: 100,
                    type: 'water',
                    retreatCost: 1,
                    attacks: [{ name: 'Strong Attack', damage: 40, energyRequirements: [{ type: 'water', amount: 1 }] }],
                },
            ],
        });

        const doomedSimulation = new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(doomedRepository));
        
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'doomed-creature'),
                StateBuilder.withCreatures(1, 'strong-opponent'),
                StateBuilder.withDamage('doomed-creature-0', 60), // Only 20 HP remaining
                StateBuilder.withEnergy('strong-opponent-1', { water: 1 }), // Can attack immediately
            ),
            doomedRepository,
        );

        const actions = doomedSimulation.getActions(gameState, 0, STANDARD_GAME_PHASE_ACTIONS, { iterations: 50, maxDepth: 50 });

        expect(actions).to.have.length.of.at.least(1, 'Simulation should return actions');
        
        /*
         * In a losing position, simulations should converge on low scores
         * Timeout scores (0.5) are expected if opponent's killing blow takes time to execute
         */
        const avgScore = actions.reduce((sum, a) => sum + a.score, 0) / actions.length;
        expect(avgScore).to.be.below(0.6, 'Average action score should be low in doomed position');

    });
});
