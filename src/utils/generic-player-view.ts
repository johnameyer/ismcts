import { ControllerHandlerState, IndexedControllers } from '@cards-ts/core';

/**
 * Generic helper to create a player view from controllers.
 * Works with ANY game's controller set - no game-specific imports.
 * 
 * For each controller that has a getFor() method, calls it with the player index.
 * This extracts the player-visible view of that controller's state.
 * Note: Does NOT set turn property - that should be set by caller based on waiting controller.
 */
export function createGenericPlayerView<Controllers extends IndexedControllers>(
    controllers: Controllers,
    playerIndex: number,
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
    
    return result as ControllerHandlerState<Controllers>;
}
