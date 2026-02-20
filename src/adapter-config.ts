import { ControllerState, ControllerHandlerState, Message, IndexedControllers } from '@cards-ts/core';
import { DecisionStrategy } from './strategies/decision-strategy.js';
import { deepCopyState } from './utils/deep-copy-state.js';
import type { GameDriver } from './utils/driver-types.js';

/**
 * ActionsGenerator interface for game-specific action generation.
 * Generic over ResponseMessage type and HandlerData type to work with any game.
 * 
 * Implementations of this interface encapsulate all game-specific logic
 * for generating candidate actions from a given game state.
 * 
 * The LegalActionsGenerator will use this to generate candidates,
 * then filter and validate them.
 */
export interface ActionsGenerator<ResponseMessage extends Message, Controllers extends IndexedControllers> {
    /**
     * Generate candidate actions for the current player.
     * 
     * @param handlerData - The player's view of the game state (game-specific type)
     * @param currentPlayer - The player index for whom to generate actions
     * @param expectedResponseTypes - Array of response type strings to filter results (e.g., ['play-card-response', 'attack-response'])
     * @returns Array of candidate ResponseMessage actions (not yet validated)
     */
    generateCandidateActions(handlerData: ControllerHandlerState<Controllers>, currentPlayer: number, expectedResponseTypes: readonly (ResponseMessage['type'])[]): ResponseMessage[];
}

/**
 * DriverFactory creates game drivers for both validation and simulation.
 * Generic over ResponseMessage, Controllers, and Handlers types.
 * 
 * Used by:
 * - LegalActionsGenerator: validates candidate actions
 * - Selection/Expansion/Simulation: advances game state during tree search
 * 
 * @param gameState - The game state to create a driver for
 * @param handlers - Game handlers for the players (can be no-op, capture, or strategy handlers)
 */
export type DriverFactory<ResponseMessage extends Message, Controllers extends IndexedControllers, Handlers = unknown> = (
    gameState: ControllerState<Controllers>,
    handlers: Handlers[],
) => GameDriver<ResponseMessage, Controllers>;

/**
 * Wraps a DriverFactory to automatically deep copy game state before passing to underlying factory.
 * This ensures implementations don't accidentally mutate the original state.
 * 
 * Usage:
 * ```typescript
 * const unsafeFactory = (state, handlers) => createDriver(state, handlers);
 * const safeFactory = withDeepCopyWrapper(unsafeFactory);
 * ```
 */
export function withDeepCopyWrapper<ResponseMessage extends Message, Controllers extends IndexedControllers>(
    factory: DriverFactory<ResponseMessage, Controllers>,
): DriverFactory<ResponseMessage, Controllers> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Handlers are game-specific and defined by game framework
    return (gameState: ControllerState<Controllers>, handlers: any[]) => {
        return factory(deepCopyState(gameState), handlers);
    };
}

/**
 * RoundEndDetector determines if a round has ended.
 * Generic over GameState type to work with any game.
 * 
 * A round is a discrete, complete game phase after which points are scored.
 * Different games define rounds differently:
 * - Pocket-TCG: Round ends when a player reaches 3+ points OR field elimination
 * - Hearts: Round ends when all tricks are played (all cards in hand dealt)
 * - Euchre: Round ends when all 5 tricks are taken
 */
export type RoundEndDetector<Controllers extends IndexedControllers> = (gameState: ControllerState<Controllers>) => boolean;

/**
 * RewardCalculator computes the outcome of a game state from a player's perspective.
 * Generic over GameState type to work with any game.
 * 
 * Returns:
 * - 1.0 for a win
 * - 0.5 for a draw/timeout/incomplete state
 * - 0.0 for a loss
 * 
 * Or any value in between to properly reward nearing a win
 * 
 * Used for both round completion and timeout scenarios.
 */
export type RewardCalculator<Controllers extends IndexedControllers> = (gameState: ControllerState<Controllers>, playerIndex: number) => number;

/**
 * Determinization interface for creating full game states from partial information.
 * Generic over GameState and Controllers types to work with any game.
 * 
 * Used during ISMCTS simulation to expand hidden information (opponent cards, random elements, etc.)
 * into a complete, playable game state.
 * 
 * Different games determinize differently:
 * - Pocket-TCG: Infers opponent deck composition from visible cards and meta patterns
 * - Hearts: Randomly shuffles unknown cards among hands
 * - Euchre: Determinizes which cards opponent has based on bidding and play history
 */
export interface Determinization<Controllers extends IndexedControllers> {
    /**
     * Create a full, playable game state from partial information.
     * 
     * @param handlerData - The current player's view of the game state (with hidden information)
     * @param playerIndex - The perspective player for whom to generate the determinized state
     * @returns A complete GameState with all hidden information filled in
     */
    determinize(handlerData: ControllerHandlerState<Controllers>): ControllerState<Controllers>;
}

/**
 * GameAdapterConfig encapsulates all game-specific configuration and dependencies.
 * Generic over ResponseMessage and Controllers types to work with any game.
 * 
 * This is passed to ISMCTSModular and then individual functions/instances
 * are passed to child components as needed.
 * 
 * As the framework evolves, this config includes:
 * - Phase 1: ActionsGenerator (action generation logic) ✅
 * - Phase 2: DriverFactory (game driver instantiation) ✅
 * - Phase 3: RoundEndDetector, RoundRewardCalculator (round completion logic) ✅
 * - Phase 5: DriverFactory (simulation driver creation) ✅
 * - Phase 6: Handler factories (game-specific handlers with pluggable strategies) ✅
 * - Phase 7: Type parameters (work with any game's types) 🚀
 */
export interface GameAdapterConfig<ResponseMessage extends Message, Controllers extends IndexedControllers> {
    /**
     * Game-specific action generation logic.
     * Generates candidate actions based on visible game state.
     */
    actionsGenerator: ActionsGenerator<ResponseMessage, Controllers>;

    /**
     * Game-specific driver factory for validation.
     * Creates a game driver to validate candidate actions.
     */
    driverFactory: DriverFactory<ResponseMessage, Controllers>;

    /**
     * Game-specific round end condition detector.
     * Determines if the current round has ended based on game rules.
     * A round is a discrete phase after which points are scored and players
     * may start a new round (or game ends if conditions met).
     */
    isRoundEnded: RoundEndDetector<Controllers>;

    /**
     * Game-specific round reward calculator.
     * Computes the outcome of the current round from a player's perspective.
     */
    getRoundReward: RewardCalculator<Controllers>;

    /**
     * Game-specific timeout reward calculator.
     * Computes the outcome when simulation times out (hits iteration limit).
     * Called only when simulation reaches move limit without natural game completion.
     * Allows games to score incomplete states (e.g., based on current points/field state).
     * 
     * Defaults to getRoundReward if not provided (most games can use same logic).
     */
    getTimeoutReward?: RewardCalculator<Controllers>;

    /**
     * Optional action weighting for random decision strategy.
     * Allows games to weight certain actions less likely in random playouts.
     * 
     * For example, EndTurnResponseMessage typically has lower weight (0.2)
     * to prevent the random player from ending turn too frequently.
     * 
     * @param action - The action to weight
     * @returns Weight multiplier (default 1.0). Lower values make action less likely.
     */
    getActionWeight?: (action: ResponseMessage) => number;

    /**
     * /**
     * Game-specific determinization for expanding hidden information.
     * Creates full game states from partial information during ISMCTS simulation.
     * Abstracts away how different games handle hidden cards, random elements, etc.
     */
    determinization: Determinization<Controllers>;

    /**
     * Reconstruct full game state from player's view (HandlerData).
     * 
     * Used by LegalActionsGenerator to convert HandlerData (player's partial view)
     * into a complete ControllerState needed for driver factory validation.
     * 
     * Each game implements this differently:
     * - Pocket-TCG: Reconsts state, data, hand, deck fields
     * - Euchre: Reconstructs trick state, hand, trump info
     * - Hearts: Reconstructs heart count, current trick, pass state
     * 
     * @param handlerData - Player's view of game state
     * @returns Complete game state with all fields for driver validation
     */
    reconstructGameStateForValidation: (handlerData: ControllerHandlerState<Controllers>) => ControllerState<Controllers>;

    /**
     * Extract player names from game state.
     * 
     * Used by LegalActionsGenerator and DriverFactory to get player names
     * for validation and state reconstruction.
     * 
     * @param gameState - The full game state
     * @returns Array of player names
     */
    getPlayerNames: (gameState: ControllerState<Controllers>) => string[];

    /**
     * Generic handler factory that accepts a pluggable strategy.
     * 
     * Used by ISMCTS phases to create handlers with specific strategies:
     * - ISMCTSDecisionStrategy for intelligent decisions
     * - RandomDecisionStrategy for random playouts
     * - CaptureDecisionStrategy for response type inference
     * 
     * @param strategy - DecisionStrategy implementation to use
     * @returns Handler that delegates to the provided strategy
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Handler type is game-specific (PocketTCGHandler, EuchreHandler, etc.)
    createHandler: (strategy: DecisionStrategy<ResponseMessage, Controllers>) => any;
}
