import { expect } from 'chai';
import { ControllerState } from '@cards-ts/core';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { ISMCTS } from '../../../../src/modular/ismcts.js';
import { createGenericPlayerView } from '../../../../src/utils/generic-player-view.js';
import { LegalActionsGenerator } from '../../../../src/legal-actions-generator.js';

export interface BinaryChoiceTestConfig {
    /**
     * Game state already in waiting state (use createWaitingGameStateForMCTS)
     */
    gameState: ControllerState<Controllers>;

    /**
     * ISMCTS simulation instance
     */
    simulation: ISMCTS<ResponseMessage, Controllers>;

    /**
     * Array of valid response message types to evaluate E.g. ('play-card-response')
     */
    responseTypes: readonly (ResponseMessage['type'])[];

    /**
     * Expected best action message with specific properties
     * E.g., new PlayCardResponseMessage('basic-supporter', 'supporter')
     *       new AttachEnergyResponseMessage(creature, energy)
     */
    expectedAction: ResponseMessage;

    /**
     * Description for assertion message
     */
    description: string;

    /**
     * Optional: when false, allows alternatives to score higher (lenient mode).
     * When true (default), validates that alternatives score < 0.5 (losing moves, strict mode).
     */
    allowViableAlternatives?: boolean;
}

/**
 * DRY wrapper for binary choice scenario tests.
 * 
 * Tests that ISMCTS correctly evaluates a game state and prefers the optimal action
 * over alternatives. Validates:
 * - Best action matches the expected action (using JSON stringification)
 * - Best action scores > 0.5 (winning condition)
 * - Action is preferred over alternatives
 * 
 * USAGE:
 * ```typescript
 * testBinaryChoice({
 *     gameState,
 *     simulation,
 *     responseTypes: STANDARD_GAME_PHASE_ACTIONS,
 *     expectedAction: new PlayCardResponseMessage('basic-supporter', 'supporter'),
 *     description: 'Should play healing supporter'
 * });
 * ```
 */
export function testBinaryChoice(config: BinaryChoiceTestConfig): void {
    const {
        gameState,
        simulation,
        responseTypes,
        expectedAction,
        description,
        allowViableAlternatives = false,
    } = config;

    /*
     * First, verify that the expected action is actually legal in the initial state
     * This ensures the scenario setup is correct before running MCTS
     */
    const driver = simulation.gameAdapterConfig.driverFactory(gameState, []);
    const handlerData = createGenericPlayerView(driver.gameState.controllers, 0);
    const legalActionsGenerator = new LegalActionsGenerator(
        simulation.gameAdapterConfig.actionsGenerator,
        simulation.gameAdapterConfig.driverFactory,
        simulation.gameAdapterConfig.reconstructGameStateForValidation,
    );
    const initialLegalActions = legalActionsGenerator.generateLegalActions(handlerData, responseTypes);
    
    const expectedActionJson = JSON.stringify(expectedAction);
    const expectedIsLegal = initialLegalActions.some(legal => JSON.stringify(legal) === expectedActionJson);
    expect(expectedIsLegal, 
        `Expected action ${expectedActionJson} must be LEGAL in initial state. Legal actions: ${initialLegalActions.map(a => JSON.stringify(a)).join(', ')}`,
    ).to.be.true;

    // Run MCTS evaluation with standardized config
    const actions = simulation.getActions(gameState, 0, responseTypes, { 
        iterations: 50,
        maxDepth: 25,
    });

    // Validate results
    expect(actions).to.have.length.of.at.least(1, 'Simulation should return at least one action');
    
    // Serialize expected action for comparison
    const expectedActionJsonForComparison = JSON.stringify(expectedAction);
    
    // Check that expected action is in the generated actions list
    const expectedActionExists = actions.some(a => {
        const msg = a.action as ResponseMessage;
        return JSON.stringify(msg) === expectedActionJsonForComparison;
    });
    expect(expectedActionExists, 
        `Expected action ${expectedActionJsonForComparison} must be generated. Available: ${actions.map(a => {
            const msg = a.action as ResponseMessage;
            return JSON.stringify(msg);
        }).join(', ')}`).to.be.true;
    
    const expectedActionIndex = actions.findIndex(action => JSON.stringify(action.action) === JSON.stringify(expectedAction))!;
    const expectedActionNode = actions[expectedActionIndex];

    expect(expectedActionNode.score).to.be.greaterThan(
        0.5,
        `Expected action should score > 0.5 for ${description} as a winning action`,
    );

    // Validate alternative actions based on configuration
    if (actions.length > 1) {
        for (let i = 0; i < actions.length; i++) {
            if (i == expectedActionIndex) {
                continue; 
            }
            
            const altAction = actions[i];
            
            if (allowViableAlternatives) {
                // Lenient: alternatives just need to score lower than best action
                try {
                    expect(altAction.score).to.be.lessThan(
                        expectedActionNode.score,
                        `Alternative action ${altAction.action.type} at index ${i} ${altAction.score} should score lower than best action ${expectedAction.type} ${expectedActionNode.score}`,
                    );
                } catch (e) {
                    console.log('\n[TREE-DEBUG] Actions when test fails:');
                    for (let j = 0; j < actions.length; j++) {
                        console.log(`  [${j}] ${JSON.stringify(actions[j].action)} = ${actions[j].score.toFixed(4)}`);
                    }
                    throw e;
                }
            } else {
                // Strict (default): alternatives must be losing moves (< 0.5)
                expect(altAction.score).to.be.lessThan(
                    0.5,
                    `Alternative action ${altAction.action.type} at index ${i} should be a losing move (${altAction.score} < 0.5)`,
                );
            }
        }
    }

    const bestAction = actions[0];
    const action = bestAction.action as ResponseMessage;
    
    // console.log(`[BINARY-CHOICE] Actions for: ${description}`);
    // console.log(`  Best: ${JSON.stringify(action)} = ${bestAction.score.toFixed(4)}`);
    for (let i = 1; i < Math.min(3, actions.length); i++) {
        const alt = actions[i];
        const altMessage = alt.action as ResponseMessage;
        // console.log(`  Alt[${i}]: ${JSON.stringify(altMessage)} = ${alt.score.toFixed(4)}`);
    }
    
    expect(JSON.stringify(action)).to.equal(expectedActionJson, description);
}
