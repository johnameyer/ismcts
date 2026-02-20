import { Message, IndexedControllers, ControllerState } from '@cards-ts/core';
import { RoundEndDetector, RewardCalculator, DriverFactory, GameAdapterConfig } from '../adapter-config.js';
import { isWaiting } from '../utils/waiting-state-utils.js';
import { simulateToCompletion } from '../utils/driver-orchestrator.js';
import { RandomDecisionStrategy } from '../strategies/random-decision-strategy.js';
import { FrameworkControllers } from '../ismcts-types.js';

/**
 * ISMCTS Simulation Phase Implementation
 * 
 * Implements the simulation (rollout) phase of Information Set Monte Carlo Tree Search.
 * From a given game state, plays out the game to completion using random handlers
 * to estimate the value of the position.
 * 
 * PRECONDITION (simulate method):
 * - Input gameState.waiting.waiting MUST be SET with player index (paused at decision point)
 * - Game state is paused, ready for resume() to advance it
 * - Do NOT call resume() before passing to simulate() - simulate() will call it internally
 * - Game state must be ready for RandomHandler to make decisions
 * 
 * POSTCONDITION (simulate method):
 * - Returns single reward value: 1.0 (win), 0.5 (draw/timeout), 0.0 (loss)
 * - Reward is from perspective of specified playerIndex
 * - Game state has been modified (by simulation), but calling function has its own copy
 * 
 * Key behaviors:
 * - RESUME: The gameState passed to simulate() should NOT have resume() called yet
 * - RANDOM PLAY: Uses RandomHandler to make decisions automatically during rollout
 * - STATE MACHINE: Handles multi-phase game states (knockouts, status effects, etc.)
 * - COMPLETION: Loops until game reaches terminal state or timeout
 * - REWARD: Returns 0.0 for loss, 0.5 for draw/timeout, 1.0 for win from simulating player's perspective
 * 
 * The simulation alternates between:
 * 1. resume() - advances game state machine to next decision point
 * 2. handleSyncResponses() - processes queued random responses from handlers
 * 3. Repeat until completion or timeout
 */
export class ISMCTSSimulation<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers> {
    constructor(
        private driverFactory: DriverFactory<ResponseMessage, Controllers>,
        private isRoundEnded: RoundEndDetector<Controllers>,
        private getRoundReward: RewardCalculator<Controllers>,
        private gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
        private getTimeoutReward?: RewardCalculator<Controllers>,
    ) {
        // Fall back to getRoundReward if getTimeoutReward not provided
        if (!this.getTimeoutReward) {
            this.getTimeoutReward = this.getRoundReward;
        }
    }
    
    /**
     * Simulates a game from the given state to completion using random play.
     * 
     * PRECONDITION:
     * - Input gameState must be NON-WAITING (post-action state)
     * - State is ready for resume() to advance it
     * 
     * POSTCONDITION:
     * - Returns reward value: 1.0 (win), 0.5 (draw/timeout), 0.0 (loss)
     * - Reward is from perspective of specified playerIndex
     * 
     * @param gameState - The game state to simulate from (must be non-waiting)
     * @param playerIndex - The index of the player from whose perspective to evaluate the result
     * @param maxMoves - Maximum depth before timeout
     * @param debug - Enable debug logging
     * @returns Reward value: 1.0 for win, 0.0 for loss, 0.5 for draw/timeout
     */
    simulate(gameState: ControllerState<Controllers>, playerIndex: number,
        maxMoves: number = 50, debug: boolean = false): number {
        // PRECONDITION: Input state must be non-waiting
        if (isWaiting(gameState)) {
            throw new Error('Expected non-waiting state. Simulate requires a state after action application.');
        }
        
        // Use orchestrator to run simulation to completion with random play
        const finalState = simulateToCompletion(
            gameState,
            () => new RandomDecisionStrategy(this.gameAdapterConfig),
            this.gameAdapterConfig.createHandler,
            this.driverFactory,
            maxMoves,
        );
        
        // Calculate reward based on final game state
        const reward = this.isRoundEnded(finalState)
            ? this.getRoundReward(finalState, playerIndex)
            : this.getTimeoutReward!(finalState, playerIndex);
        
        if (debug) {
            console.log(`[SIMULATE] Player ${playerIndex}: Reward ${reward}, Completed: ${this.isRoundEnded(finalState)}`);
        }
        
        return reward;
    }
}
