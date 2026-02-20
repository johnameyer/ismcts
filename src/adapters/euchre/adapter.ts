/**
 * Euchre GameAdapterConfig Factory
 * 
 * Creates the complete configuration needed for ISMCTS to work with Euchre.
 */

import type { ControllerState, ControllerHandlerState, Card } from '@cards-ts/core';
import { Deck, HandlerChain } from '@cards-ts/core';
import type { ResponseMessage } from '@cards-ts/euchre/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/euchre/dist/controllers/controllers.js';
import { gameFactory } from '@cards-ts/euchre/dist/game-factory.js';
import type { DriverFactory } from '../../adapter-config.js';
import { GameAdapterConfig, withDeepCopyWrapper } from '../../adapter-config.js';
import { DecisionStrategy } from '../../strategies/decision-strategy.js';
import { EuchreActionsGenerator } from './actions-generator.js';
import { EuchreISMCTSHandler } from './handler.js';
import { EuchreDeterminization } from './determinization.js';

type HandlerData = ControllerHandlerState<Controllers>;
type GameState = ControllerState<Controllers>;

/**
 * Detect when a Euchre round ends
 * Round ends when game is marked completed (handled by state machine)
 */
export function isEuchreRoundEnded(gameState: GameState): boolean {
    return (gameState).completed === true;
}

/**
 * Calculate reward for a completed Euchre round
 * Euchre uses teams: [0,2] and [1,3]
 * Returns 1.0 if player's team won, 0.0 if team lost, 0.5 for draw
 */
export function getEuchreRewardForPlayer(gameState: GameState, playerIndex: number): number {
    const scores = (gameState as Record<string, unknown>).score;
    const scoresArray = Array.isArray(scores) ? scores 
        : (scores as Record<string, unknown>)?.['0'] !== undefined 
            ? Object.values(scores as Record<string, unknown>) : undefined;
    
    if (!scoresArray || scoresArray.length < 2) {
        return 0.5; // Can't determine, draw
    }
    
    // Teams: [0, 2] vs [1, 3]
    const team0Score = scoresArray[0] as number;
    const team1Score = scoresArray[1] as number;
    
    const playerTeam = playerIndex === 0 || playerIndex === 2 ? 0 : 1;
    const playerScore = playerTeam === 0 ? team0Score : team1Score;
    const opponentScore = playerTeam === 0 ? team1Score : team0Score;
    
    if (playerScore > opponentScore) {
        return 1.0; // Win
    } else if (playerScore < opponentScore) {
        return 0.0; // Loss
    } 
    return 0.5; // Draw/tie
    
}

/**
 * Timeout reward calculator for Euchre
 * Same logic as round reward
 */
export function getEuchreTimeoutReward(gameState: GameState, playerIndex: number): number {
    return getEuchreRewardForPlayer(gameState, playerIndex);
}

/**
 * Euchre Driver Factory - creates drivers for action validation and simulation
 */
export function createEuchreDriverFactory(): DriverFactory<ResponseMessage, Controllers> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Game framework internals: HandlerChain types are framework-specific
    const baseFactory: DriverFactory<ResponseMessage, Controllers> = (gameState: ControllerState<Controllers>, handlers: unknown[]): any => {
        // Create game factory
        const factory = gameFactory;
        
        // Create no-op handlers for players without provided handlers
        const noOpHandler = () => ({
            handleOrderUp: () => {},
            handleNameTrump: () => {},
            handleDealerDiscard: () => {},
            handleTurn: () => {},
            handleGoingAlone: () => {},
            handleMessage: () => {},
        });
        
        // Use provided handlers or create no-op handlers for all 4 players
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const playersToUse: any = handlers && handlers.length > 0 
            ? (handlers as any[]).map(h => new HandlerChain([ h ]))
            : [
                new HandlerChain([ noOpHandler() ]),
                new HandlerChain([ noOpHandler() ]),
                new HandlerChain([ noOpHandler() ]),
                new HandlerChain([ noOpHandler() ]),
            ];
        
        // Create driver with provided game state - resuming from existing state
        const frameworkDriver = factory.getGameDriver(playersToUse, { maxScore: 10 }, [], gameState);
        
        // Add getValidationError method to the framework driver
        (frameworkDriver as any).getValidationError = (position: number, message: ResponseMessage): string | undefined => {
            // Delegate to the framework driver's eventHandler
            const currentState = frameworkDriver.getState();
            return (frameworkDriver as any).eventHandler?.getValidationError?.(
                (currentState as any).controllers,
                position,
                message,
            );
        };
        
        return frameworkDriver;
    };
    
    // Wrap with automatic deep copy to prevent state mutations
    return withDeepCopyWrapper(baseFactory);
}

/**
 * Create Euchre GameAdapterConfig with all game-specific implementations.
 * 
 * @returns Complete GameAdapterConfig ready to pass to ISMCTS strategies
 */
export function createEuchreAdapterConfig(): GameAdapterConfig<ResponseMessage, Controllers> {
    return {
        actionsGenerator: new EuchreActionsGenerator(),
        driverFactory: createEuchreDriverFactory(),
        isRoundEnded: isEuchreRoundEnded,
        getRoundReward: getEuchreRewardForPlayer,
        getTimeoutReward: getEuchreTimeoutReward,
        
        determinization: new EuchreDeterminization(),
        
        reconstructGameStateForValidation: (handlerData: HandlerData): GameState => {
            /*
             * For validation, we just need the hand field properly structured as an array of 4 player hands
             * Other state fields (trick, score, etc.) are already in handlerData
             */
            const currentPlayerIndex = (handlerData as Record<string, unknown>).players as Record<string, unknown> | undefined;
            const positionValue = (currentPlayerIndex?.position as number) || 0;
            
            // Ensure hand is a 4-element array with current player's cards
            const hands: Card[][] = [[], [], [], []];
            const currentHand = (handlerData as Record<string, unknown>).hand;
            if (Array.isArray(currentHand)) {
                hands[positionValue] = currentHand as Card[];
            }
            
            /*
             * Return handlerData with corrected hand field
             * All other fields (global state like trick, score, turn) stay as-is
             */
            const deckObj = (handlerData as Record<string, unknown>).deck as Record<string, unknown> | undefined;
            return {
                ...handlerData,
                deck: deckObj ? { ...deckObj, deck: new Deck() } : { deck: new Deck() },
                hand: hands,
            } as unknown as GameState;
        },

        getPlayerNames: (gameState: GameState): string[] => gameState.names,
        
        createHandler: (strategy: DecisionStrategy<ResponseMessage, Controllers>) => {
            return new EuchreISMCTSHandler(strategy);
        },
    };
}

export const EuchreAdapterConfig = createEuchreAdapterConfig();
