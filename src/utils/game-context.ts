import { Message, IndexedControllers, ControllerState, ControllerHandlerState } from '@cards-ts/core';
import { GameAdapterConfig } from '../adapter-config.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { extractWaitingPlayer } from './waiting-state-utils.js';
import { createGenericPlayerView } from './generic-player-view.js';
import type { GameDriver } from './driver-types.js';

/**
 * Snapshot of a game state at a decision point.
 *
 * Wraps a single driver created from the provided state, exposing:
 * - waitingPlayer / handlerData for action generation
 * - validateAction for filtering candidates
 * - applyAction for expansion (reuses the same driver — saves one deep copy vs. the old pattern)
 * - isEnded for short-circuit checks
 *
 * Single-use: call applyAction at most once per context.
 */
export class GameContext<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers> {

    readonly waitingPlayer: number;

    readonly handlerData: ControllerHandlerState<Controllers>;

    private readonly preActionState: ControllerState<Controllers>;

    private readonly driver: GameDriver<ResponseMessage, Controllers>;

    constructor(
        state: ControllerState<Controllers>,
        private readonly gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
    ) {
        this.preActionState = state;
        this.driver = gameAdapterConfig.driverFactory(state, []);
        this.waitingPlayer = extractWaitingPlayer(this.driver.gameState.controllers.waiting.get());
        this.handlerData = createGenericPlayerView(this.driver.gameState.controllers, this.waitingPlayer);
    }

    validateAction(player: number, action: ResponseMessage): string | undefined {
        return this.driver.getValidationError(player, action);
    }

    /**
     * Apply an action using the context's driver (no additional deep copy).
     * Single-use: do not call twice on the same context.
     */
    applyAction(action: ResponseMessage): { newState: ControllerState<Controllers>, actingPlayer: number } {
        const validationError = this.driver.getValidationError(this.waitingPlayer, action);
        if (validationError) {
            throw new Error(`Action validation failed: ${validationError}`);
        }
        const wasValid = this.driver.handleEvent(this.waitingPlayer, action, undefined);
        if (!wasValid) {
            throw new Error('Action application failed after validation passed');
        }
        return { newState: this.driver.getState(), actingPlayer: this.waitingPlayer };
    }

    isEnded(): boolean {
        return this.gameAdapterConfig.isRoundEnded(this.preActionState);
    }
}
