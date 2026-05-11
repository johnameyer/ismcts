import { ControllerHandlerState, IndexedControllers } from '@cards-ts/core';

/**
 * Generic helper to create a player view from controllers.
 * Works with ANY game's controller set - no game-specific imports.
 * 
 * For each controller that has a getFor() method, calls it with the player index.
 * This extracts the player-visible view of that controller's state.
 * Note: Does NOT set turn property - that should be set by caller based on waiting controller.
 * 
 * @param extraFields - Optional extra fields to merge into the result (e.g., { state: 'ACTIONLOOP_...' })
 * TODO: Remove extraFields once GameStateController.getFor() exposes the state machine state,
 *       so callers don't need to manually inject it.
 */
export function createGenericPlayerView<Controllers extends IndexedControllers>(
    controllers: Controllers,
    playerIndex: number,
    extraFields?: Record<string, unknown>,
): ControllerHandlerState<Controllers> {
    const result: Record<string, unknown> = {};
    
    // Iterate over all controllers and extract player view
    for (const [ key, controller ] of Object.entries(controllers)) {
        if (controller && typeof controller === 'object' && 'getFor' in controller && typeof (controller).getFor === 'function') {
            // Call getFor if available (game-specific controllers)
            result[key] = (controller).getFor(playerIndex);
        } else {
            // Otherwise pass through as-is
            result[key] = controller;
        }
    }

    if (extraFields) {
        Object.assign(result, extraFields);
    }
    
    return result as ControllerHandlerState<Controllers>;
}
