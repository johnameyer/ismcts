import { Message, IndexedControllers, ControllerHandlerState } from '@cards-ts/core';
import { ISMCTS } from '../modular/ismcts.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { GameAdapterConfig } from '../adapter-config.js';
import { GameContext } from '../utils/game-context.js';
import { ISMCTSConfig, DEFAULT_ISMCTS_CONFIG } from '../modular/ismcts-config.js';
import { summarizeAction } from '../utils/action-debug.js';
import { DecisionStrategy } from './decision-strategy.js';
import { RandomDecisionStrategy } from './random-decision-strategy.js';

/**
 * ISMCTS Decision Strategy
 *
 * Uses Monte Carlo Tree Search to decide actions. Works with any game
 * that provides a GameAdapterConfig (game logic functions).
 *
 * This strategy is completely game-agnostic:
 * - Uses ISMCTSModular for algorithm
 * - Receives game logic through GameAdapterConfig dependency injection
 * - Doesn't import any game-specific types
 * - Works with abstract HandlerData
 * - Falls back to RandomDecisionStrategy when tree exploration fails
 */
export class ISMCTSDecisionStrategy<
    ResponseMessage extends Message,
    Controllers extends IndexedControllers & FrameworkControllers,
    HandlerData extends ControllerHandlerState<Controllers>,
> implements DecisionStrategy<ResponseMessage, Controllers> {
    private ismcts: ISMCTS<ResponseMessage, Controllers>;

    private randomStrategy: RandomDecisionStrategy<ResponseMessage, Controllers>;

    private ismctsConfig: ISMCTSConfig;

    constructor(
        gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
        ismctsConfig: ISMCTSConfig = DEFAULT_ISMCTS_CONFIG,
    ) {
        this.ismctsConfig = ismctsConfig;
        this.ismcts = new ISMCTS(gameAdapterConfig);
        this.randomStrategy = new RandomDecisionStrategy(gameAdapterConfig);
    }

    getAction(handlerData: HandlerData, expectedResponseTypes: readonly (ResponseMessage['type'])[]): ResponseMessage | null {
        /*
         * ISMCTSModular.getBestActionFromHandlerData expects:
         * - handlerData: player's view of game state
         * - responseTypes: valid response types for this decision
         * - config: ISMCTS parameters
         * Returns: game-specific ResponseMessage or null
         */
        try {
            const result = this.ismcts.getBestActionFromHandlerData(
                handlerData,
                expectedResponseTypes,
                this.ismctsConfig,
            );
            
            if (!result) {
                return this.randomStrategy.getAction(handlerData, expectedResponseTypes);
            }
            
            return result;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const stackTrace = error instanceof Error ? error.stack : '';
            console.warn(`[ISMCTSDecisionStrategy] ISMCTS threw error (${errorMsg}), falling back to random strategy`);
            if (stackTrace) {
                console.warn(`Stack trace:\n${stackTrace}`);
            }
            if (process.env.LOG_ISMCTS_FILTERED_ACTIONS === 'true') {
                console.warn(`[ISMCTSDecisionStrategy] expectedResponseTypes: ${expectedResponseTypes.join(', ')}`);
                try {
                    const debugCtx = new GameContext(this.ismcts.gameAdapterConfig.reconstructGameStateForValidation(handlerData), this.ismcts.gameAdapterConfig);
                    const legalActions = this.ismcts.legalActionsGenerator.generateLegalActions(debugCtx, expectedResponseTypes);
                    console.warn(`[ISMCTSDecisionStrategy] legal actions at fallback: ${legalActions.length}`);
                    legalActions.forEach((action, index) => {
                        console.warn(`  [legal ${index + 1}] ${summarizeAction(action)}`);
                    });
                } catch (secondaryError) {
                    const secondaryMsg = secondaryError instanceof Error ? secondaryError.message : String(secondaryError);
                    console.warn(`[ISMCTSDecisionStrategy] could not compute legal actions for debug: ${secondaryMsg}`);
                }
            }
            return this.randomStrategy.getAction(handlerData, expectedResponseTypes);
        }
    }
}
