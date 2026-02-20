import { expect } from 'chai';
import { ControllerState } from '@cards-ts/core';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { GameAdapterConfig } from '../../../../src/adapter-config.js';
import { deepCopyState } from '../../../../src/utils/deep-copy-state.js';
import { extractWaitingPlayer } from '../../../../src/utils/waiting-state-utils.js';
import { applyActionAndResume } from '../../../../src/utils/driver-orchestrator.js';

/**
 * Configuration for scenario validation - tests that a scenario is correctly set up
 * by actually playing through the expected action sequences to verify they produce
 * the expected outcomes (win or loss).
 */
export interface ScenarioValidationConfig {
    /**
     * Game state at decision point
     */
    gameState: ControllerState<Controllers>;

    /**
     * Game adapter config with driver factory
     */
    gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>;

    /**
     * Response types for this decision point
     */
    responseTypes: readonly (ResponseMessage['type'])[];

    /**
     * Actions that should lead to victory. Array of [playerIndex, action] tuples
     * Example: [[0, healAction], [1, attackAction], [0, attackAction]]
     */
    victoryPath: Array<[number, ResponseMessage]>;

    /**
     * Actions that should lead to defeat. Array of [playerIndex, action] tuples
     */
    defeatPath: Array<[number, ResponseMessage]>;

    /**
     * Description for error messages
     */
    description: string;
}

/**
 * Validates that a scenario is correctly set up by playing through expected action sequences.
 * 
 * This helps catch scenario setup bugs BEFORE running expensive MCTS evaluation.
 * For example:
 * - Victory path should actually result in a win (game ended, player won)
 * - Defeat path should actually result in a loss (game ended, player lost)
 * - Both paths should be playable without validation errors
 * 
 * USAGE:
 * ```typescript
 * validateScenario({
 *     gameState,
 *     gameAdapterConfig: simulation.gameAdapterConfig,
 *     responseTypes: STANDARD_GAME_PHASE_ACTIONS,
 *     victoryPath: [
 *         [0, new PlayCardResponseMessage('healer', 'supporter')],
 *         [0, new EndTurnResponseMessage()],
 *         [1, new AttackResponseMessage(0)],
 *         [0, new AttackResponseMessage(0)],
 *     ],
 *     defeatPath: [
 *         [0, new EndTurnResponseMessage()],
 *         [1, new AttackResponseMessage(0)],
 *     ],
 *     description: 'Healing scenario'
 * });
 * ```
 */
export function validateScenario(config: ScenarioValidationConfig): void {
    const {
        gameState,
        gameAdapterConfig,
        responseTypes,
        victoryPath,
        defeatPath,
        description,
    } = config;

    // console.log(`\n[SCENARIO-VALIDATE] Testing: ${description}`);

    // Test victory path
    // console.log(`[SCENARIO-VALIDATE] Testing victory path with ${victoryPath.length} actions...`);
    const victoryResult = playActionSequence(
        gameAdapterConfig,
        deepCopyState(gameState),
        victoryPath,
    );
    
    // console.log(`[SCENARIO-VALIDATE] Victory path result: isGameEnded=${victoryResult.isGameEnded}, reward=${victoryResult.finalReward}, points=[${victoryResult.finalPoints}]`);
    
    expect(victoryResult.isGameEnded, 
        `Victory path should end the game. Final state: points=[${victoryResult.finalPoints}]`,
    ).to.be.true;
    
    const playerWon = victoryResult.finalReward > 0.5;
    expect(playerWon,
        `Victory path should result in player 0 winning. Final reward: ${victoryResult.finalReward}`,
    ).to.be.true;
    // console.log(`  ✓ Victory path results in win (reward=${victoryResult.finalReward})`);

    // Test defeat path
    // console.log(`[SCENARIO-VALIDATE] Testing defeat path with ${defeatPath.length} actions...`);
    const defeatResult = playActionSequence(
        gameAdapterConfig,
        deepCopyState(gameState),
        defeatPath,
    );
    
    // console.log(`[SCENARIO-VALIDATE] Defeat path result: isGameEnded=${defeatResult.isGameEnded}, reward=${defeatResult.finalReward}, points=[${defeatResult.finalPoints}]`);
    
    expect(defeatResult.isGameEnded,
        `Defeat path should end the game. Final state: points=[${defeatResult.finalPoints}]`,
    ).to.be.true;
    
    const playerLost = defeatResult.finalReward < 0.5;
    expect(playerLost,
        `Defeat path should result in player 0 losing. Final reward: ${defeatResult.finalReward}`,
    ).to.be.true;
    // console.log(`  ✓ Defeat path results in loss (reward=${defeatResult.finalReward})`);

    // console.log(`[SCENARIO-VALIDATE] ✓ Scenario validation passed: ${description}\n`);
}

/**
 * Internal: Plays a sequence of actions through the game and returns the outcome.
 */
function playActionSequence(
    gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
    initialState: ControllerState<Controllers>,
    actions: Array<[number, ResponseMessage]>,
): {
        isGameEnded: boolean;
        finalReward: number;
        finalPoints: number[];
    } {
    let currentState = deepCopyState(initialState);
    let actionIndex = 0;

    for (const [ expectedPlayerIndex, action ] of actions) {
        // Determine current player from waiting state
        const waiting = (currentState).waiting;
        if (!waiting || !waiting.waiting || (Array.isArray(waiting.waiting) && waiting.waiting.length === 0)) {
            throw new Error(`No player waiting at action ${actionIndex}. State: ${JSON.stringify(waiting)}`);
        }

        const currentPlayerIndex = extractWaitingPlayer(waiting);
        if (currentPlayerIndex < 0) {
            throw new Error(`Could not determine waiting player at action ${actionIndex}`);
        }

        // Validate expected player
        if (currentPlayerIndex !== expectedPlayerIndex) {
            throw new Error(
                `Wrong player at step ${actionIndex}: expected player ${expectedPlayerIndex}, but player ${currentPlayerIndex} is waiting`,
            );
        }

        if (process.env.DEBUG_EXPANSION === 'true') {
            console.log(`[SCENARIO-VALIDATE] Step ${actionIndex}: Player ${currentPlayerIndex} plays ${action.type}`);
        }

        // Check if action is valid using driver validation
        const driver = gameAdapterConfig.driverFactory(deepCopyState(currentState), []);
        const validationError = driver.getValidationError(currentPlayerIndex, action);
        if (validationError) {
            throw new Error(
                `Action not valid at step ${actionIndex}: ${validationError}. `
                + `Player ${currentPlayerIndex}, Action: ${JSON.stringify(action)}`,
            );
        }

        try {
            // Apply action and advance to next decision point (or game end)
            currentState = applyActionAndResume(currentState, action, currentPlayerIndex, gameAdapterConfig.driverFactory);
        } catch (e) {
            throw new Error(
                `Action application failed at step ${actionIndex}: ${(e as Record<string, unknown>).message}. `
                + `Player ${currentPlayerIndex}, Action: ${JSON.stringify(action)}`,
            );
        }

        actionIndex++;

        // Check if game ended
        if (gameAdapterConfig.isRoundEnded(currentState)) {
            break;
        }
    }

    // Determine outcome
    const isGameEnded = gameAdapterConfig.isRoundEnded(currentState);
    const reward = gameAdapterConfig.getRoundReward(currentState, 0); // Always use player 0 perspective
    const finalPoints = (currentState).points || [ 0, 0 ];

    return {
        isGameEnded,
        finalReward: reward,
        finalPoints,
    };
}
