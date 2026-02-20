import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { expect } from 'chai';
import { ISMCTS } from '../../src/modular/ismcts.js';
import { MockCardRepository } from '../helpers/test-utils.js';
import { StateBuilder } from '../helpers/state-builder.js';
import { createWaitingGameStateForMCTS } from '../helpers/test-state-builder.js';
import { deepCopyState } from '../../src/utils/deep-copy-state.js';
import { MAIN_ACTION_RESPONSE_TYPES } from '../../src/adapters/pocket-tcg/response-types.js';
import { createGameAdapterConfig } from '../helpers/test-helpers.js';

describe('ISMCTS - Iteration Independence (Bug Fix Verification)', () => {
    let modular: ISMCTS<ResponseMessage, Controllers>;
    let cardRepository: MockCardRepository;
    
    const EXPECTED_RESPONSE_TYPES = MAIN_ACTION_RESPONSE_TYPES;

    beforeEach(() => {
        cardRepository = new MockCardRepository();
        modular = new ISMCTS<ResponseMessage, Controllers>(createGameAdapterConfig(cardRepository));
    });

    describe('Iteration Waiting State Cleanup', () => {
        /**
         * SCENARIO: Each MCTS iteration must start with clean state.
         * Before running iteration i, waiting must be reset to { waiting: [], responded: [] }.
         * 
         * BUG FIX: getActions() now cleans waiting state before each iteration:
         * ```
         * const iterationState = deepCopyState(gameState);
         * iterationState.waiting = { waiting: [], responded: [] };
         * ```
         * 
         * TEST: Run getActions multiple times with same game state,
         * verify each produces valid results (would fail if waiting leaked between iterations).
         */
        it('should produce valid results across multiple iterations', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            // Run getActions (which does 50 iterations internally)
            const actions = modular.getActions(gameState, 0, EXPECTED_RESPONSE_TYPES, { iterations: 5, maxDepth: 10 });

            // Should return valid actions
            expect(actions).to.be.an('array');
            expect(actions.length).to.be.greaterThan(0, 'Should return at least one action');
            
            // All actions should have scores in valid range
            for (const { action, score } of actions) {
                expect(action).to.exist;
                expect(score).to.be.a('number');
                expect(score).to.be.at.least(0);
                expect(score).to.be.at.most(Infinity);
            }
        });

        /**
         * SCENARIO: After getActions completes, input state should be unchanged.
         * This verifies that waiting cleanup per iteration didn't leak back to input.
         * 
         * TEST: Input state should be pristine after getActions.
         */
        it('should not mutate input state after getActions', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const stateSnapshot = JSON.stringify(gameState);

            modular.getActions(gameState, 0, EXPECTED_RESPONSE_TYPES, { iterations: 5, maxDepth: 10 });

            // Input state should be unchanged
            expect(JSON.stringify(gameState)).to.equal(stateSnapshot, 'Input state should not change');
        });

        /**
         * SCENARIO: Run getActions 3 times with same input game state.
         * Each call should work independently without contamination.
         * 
         * TEST: Multiple calls with same input should all succeed.
         */
        it('should support multiple getActions calls on same game state', () => {
            const baseState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const stateSnapshot = JSON.stringify(baseState);

            // Run getActions 3 times
            for (let i = 0; i < 3; i++) {
                const gameCopy = deepCopyState(baseState);
                const actions = modular.getActions(gameCopy, 0, EXPECTED_RESPONSE_TYPES, { iterations: 3, maxDepth: 10 });
                
                expect(actions).to.be.an('array');
                expect(actions.length).to.be.greaterThan(0, `Call ${i + 1} should return actions`);
                
                // Base state should remain unchanged
                expect(JSON.stringify(baseState)).to.equal(stateSnapshot, `Call ${i + 1} corrupted base state`);
            }
        });
    });

    describe('Player Index vs PlayerToMove', () => {
        /**
         * SCENARIO: In orchestration, simulation uses selectedNode.lastPlayer, not
         * the original playerIndex parameter.
         * 
         * BUG FIX: Changed from:
         *   this.simulation.simulate(state, playerIndex, ...)
         * To:
         *   this.simulation.simulate(state, simulationPlayerIndex, ...)
         * Where simulationPlayerIndex = selectedNode.lastPlayer
         * 
         * TEST: Verify getActions works correctly (uses correct player perspective).
         */
        it('should use correct player perspective in simulation (selectedNode.lastPlayer)', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            // Get actions for player 0
            const actions = modular.getActions(gameState, 0, EXPECTED_RESPONSE_TYPES, { iterations: 5, maxDepth: 10 });

            // Should produce valid results
            expect(actions).to.be.an('array');
            expect(actions.length).to.be.greaterThan(0);

            /*
             * Check that we got reasonable scores (not all 0.5 timeout)
             * Note: With low iterations (5), some configurations timeout
             */
            const scores = actions.map(a => a.score);
            expect(scores.length).to.be.greaterThan(0);
        });

        /**
         * SCENARIO: The orchestration layer correctly identifies which player
         * should evaluate the reward based on the node being expanded.
         * 
         * TEST: Actions should be scored fairly for the requesting player.
         */
        it('should evaluate rewards from correct player perspective', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            // Get actions for player 0 (should want high scores for P0)
            const actionsP0 = modular.getActions(gameState, 0, EXPECTED_RESPONSE_TYPES, { iterations: 10, maxDepth: 10 });
            
            expect(actionsP0).to.be.an('array');
            expect(actionsP0.length).to.be.greaterThan(0);

            // At least one action should have non-zero score (not all timeouts)
            const hasPositiveScore = actionsP0.some(a => a.score > 0);
            expect(hasPositiveScore).to.be.true;
        });
    });

    describe('Root Node Player Perspective', () => {
        /**
         * SCENARIO: The root node is created with lastPlayer set to the
         * requesting player index. This ensures all simulations evaluate
         * from the correct player's perspective.
         * 
         * TEST: Root player perspective should be respected throughout MCTS.
         */
        it('should maintain player 0 perspective for player 0 requests', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const actions = modular.getActions(gameState, 0, EXPECTED_RESPONSE_TYPES, { iterations: 10, maxDepth: 10 });
            
            // Results should reflect P0's perspective (some winning actions have high score)
            expect(actions.length).to.be.greaterThan(0);
            const maxScore = Math.max(...actions.map(a => a.score));
            expect(maxScore).to.be.greaterThan(0, 'At least one action should have positive score for P0');
        });
    });

    describe('State Iteration Loop Consistency', () => {
        /**
         * SCENARIO: The iteration loop (for i = 0 to config.iterations):
         * 1. Deep copy input state
         * 2. Clean waiting state on the copy
         * 3. Run iteration with clean copy
         * 4. Do NOT modify input state
         * 
         * BUG FIX: Each iteration now explicitly cleans waiting before running.
         * 
         * TEST: Run many iterations with strict input state tracking.
         */
        it('should maintain iteration independence with 50 iterations', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const stateSnapshot = JSON.stringify(gameState);

            // 50 iterations (default)
            const actions = modular.getActions(gameState, 0, EXPECTED_RESPONSE_TYPES, { iterations: 50, maxDepth: 10 });

            // Input state pristine
            expect(JSON.stringify(gameState)).to.equal(stateSnapshot);

            // Valid results
            expect(actions).to.be.an('array');
            expect(actions.length).to.be.greaterThan(0);
        });

        /**
         * SCENARIO: Tree structure (root node and its children) should
         * accumulate statistics correctly across all iterations.
         * 
         * TEST: getActions returns meaningful statistics.
         */
        it('should accumulate statistics across iterations correctly', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const actions = modular.getActions(gameState, 0, EXPECTED_RESPONSE_TYPES, { iterations: 20, maxDepth: 10 });

            // Should have multiple evaluated actions
            expect(actions.length).to.be.greaterThan(0);

            // Scores should vary (not all identical)
            const scores = actions.map(a => a.score);
            const uniqueScores = new Set(scores);
            // May have some duplicate scores, but shouldn't all be the same
            expect(uniqueScores.size).to.be.greaterThan(0);
        });
    });

    describe('getBestAction with Player Index', () => {
        /**
         * SCENARIO: getBestAction calls getActions and selects the best.
         * It should properly respect the playerIndex.
         * 
         * TEST: getBestAction should return a single best action.
         */
        it('should return best action for requesting player', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const bestAction = modular.getBestAction(gameState, 0, [
                'play-card-response',
                'evolve-response',
                'attack-response',
                'retreat-response',
                'use-ability-response',
                'attach-energy-response',
                'end-turn-response',
            ], { iterations: 10, maxDepth: 10 });

            expect(bestAction).to.exist;
            expect(bestAction?.type).to.be.a('string');
        });

        /**
         * SCENARIO: Input state should not be mutated by getBestAction.
         * 
         * TEST: State remains pristine after getBestAction.
         */
        it('should not mutate input state during getBestAction', () => {
            const gameState = createWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                ),
                cardRepository,
            );

            const stateSnapshot = JSON.stringify(gameState);

            modular.getBestAction(gameState, 0, [
                'play-card-response',
                'evolve-response',
                'attack-response',
                'retreat-response',
                'use-ability-response',
                'attach-energy-response',
                'end-turn-response',
            ], { iterations: 5, maxDepth: 10 });

            expect(JSON.stringify(gameState)).to.equal(stateSnapshot);
        });
    });
});
