import { CardRepository } from '@cards-ts/pocket-tcg/dist/repository/card-repository.js';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { HandlerData } from '@cards-ts/pocket-tcg/dist/game-handler.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { ControllerState } from '@cards-ts/core';
import { EndTurnResponseMessage, RetreatResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response/index.js';
import { GameCard } from '@cards-ts/pocket-tcg/dist/controllers/card-types.js';
import { GameAdapterConfig } from '../../adapter-config.js';
import { DecisionStrategy } from '../../strategies/decision-strategy.js';
import { PocketTCGHandler } from './handler.js';
import { PocketTCGActionsGenerator } from './actions-generator.js';
import {
    createPocketTCGDriverFactory,
} from './actions-generator.js';
import { PocketTCGDeterminization, getTimeoutReward, isGameEnded, getRewardForPlayer } from './index.js';

/**
 * Create Pocket-TCG GameAdapterConfig with all game-specific implementations.
 * 
 * This factory creates:
 * - Action generation (PocketTCGActionsGenerator)
 * - Driver factories (for validation and simulation)
 * - Round end detection and reward calculation
 * - Handler factories that accept pluggable strategies
 * 
 * @param cardRepository - Pocket-TCG specific card metadata
 * @returns Complete GameAdapterConfig ready to pass to ISMCTSModular
 */
export function createPocketTCGAdapterConfig(cardRepository: CardRepository): GameAdapterConfig<ResponseMessage, Controllers> {
    const config: GameAdapterConfig<ResponseMessage, Controllers> = {
        actionsGenerator: new PocketTCGActionsGenerator(cardRepository),
        driverFactory: createPocketTCGDriverFactory(cardRepository),
        isRoundEnded: (gameState) => isGameEnded(gameState),
        getRoundReward: (gameState, playerIndex) => getRewardForPlayer(gameState, playerIndex),
        getTimeoutReward,
        determinization: new PocketTCGDeterminization(cardRepository),

        reconstructGameStateForValidation: (handlerData: HandlerData): ControllerState<Controllers> => {
            // HandlerData spreads individual controller properties (tools, field, energy, etc.)
            // ControllerState also uses this flattened structure - NOT nested under 'controllers'
            
            return {
                ...handlerData,
                state: handlerData.state || 'START_GAME',
                data: Array.isArray(handlerData.data) ? handlerData.data : [ handlerData.data || {} ],
                hand: reconstructHandState(handlerData.hand, handlerData.turn),
                deck: reconstructDeckState(0, handlerData.turn),
                players: undefined,
            } as unknown as ControllerState<Controllers>;
        },

        getPlayerNames: (gameState) => gameState.names as string[],

        /**
         * Weight actions for random playout strategy.
         * EndTurnResponseMessage and RetreatResponseMessage have 1/4 weight (0.25).
         * Other actions have default weight 1.0.
         */
        getActionWeight: (action: ResponseMessage) => {
            if (action instanceof EndTurnResponseMessage || action instanceof RetreatResponseMessage) {
                return 0.25;
            }
            return 1.0;
        },

        createHandler: (strategy: DecisionStrategy<ResponseMessage, Controllers>) => {
            return new PocketTCGHandler(strategy);
        },
    };

    return config;
}

/**
 * Reconstruct hand state array for both players from HandlerData.
 * @param playerHand - The current player's hand from HandlerData
 * @param playerIndex - Which player's view this is (0 or 1)
 */
function reconstructHandState(playerHand: GameCard[], playerIndex: number): Array<Array<GameCard>> {
    const hands: Array<Array<GameCard>> = [[], []];
    hands[playerIndex] = Array.isArray(playerHand) ? playerHand : [];
    hands[1 - playerIndex] = [];
    return hands;
}

/**
 * Reconstruct deck state array for both players.
 * Pocket-TCG uses empty arrays for hidden opponent deck.
 * @param _playerDeckSize - Player's deck size (unused, empty for hidden info)
 * @param _playerIndex - Which player's view this is
 */
function reconstructDeckState(_playerDeckSize: number, _playerIndex: number): Array<Array<GameCard>> {
    return [[], []]; // Empty decks for both players
}
