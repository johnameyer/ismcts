import { ControllerState, Message, IndexedControllers, ControllerHandlerState, WaitingController } from '@cards-ts/core';

/**
 * Constraint type for controllers that have the framework's standard turn/waiting logic.
 * Used by ISMCTS phases that need to inspect turn/waiting state.
 */
export type FrameworkControllers = {
    waiting: WaitingController;
};

/**
 * Represents a recorded handler method call during ISMCTS simulation.
 * Used for tracking and replaying game actions during tree search.
 */
export type HandlerCall<Controllers> = { method: string; handlerState: ControllerHandlerState<Controllers>; args: unknown[]; position: number };

/**
 * Proxy interface for accessing player handlers during ISMCTS simulation.
 * Generic over ResponseMessage type to work with any game.
 * Allows the algorithm to invoke player decision logic programmatically.
 */
export interface HandlerProxy<ResponseMessage extends Message, Controllers extends IndexedControllers> {
    players: Array<{
        handlers: Array<{
            handleAction: (data: ControllerHandlerState<Controllers>, queue: { push: (msg: ResponseMessage) => void }) => void;
            constructor?: { name: string };
        }>;
    }>;
    incomingData: {
        for: (position: number) => { push: (msg: ResponseMessage) => void };
    };
}

/**
 * Function type for applying actions to game states during ISMCTS simulation.
 * Generic over GameState and ResponseMessage types to work with any game.
 * Takes a state, action, and player index, returns the resulting state.
 */
export type ApplyActionFunction<ResponseMessage extends Message, Controllers extends IndexedControllers> = (
    state: ControllerState<Controllers>,
    action: ResponseMessage,
    playerIndex: number,
) => ControllerState<Controllers>;
