import { ControllerHandlerState, IndexedControllers } from '@cards-ts/core';

/**
 * Generic helper to create a player view from controllers.
 * Works with ANY game's controller set - no game-specific imports.
 *
 * For each controller that has a getFor() method, calls it with the player index.
 * This extracts the player-visible view of that controller's state.
 * Note: Does NOT set turn property - that should be set by caller based on waiting controller.
 *
 * Built lazily per-key, mirroring the same pattern already used for
 * GenericGameState.asHandlerData() (cards-ts/core) and
 * ControllerUtils.createPlayerView() (pocket-tcg): calling every
 * controller's getFor() eagerly was measured as wasted work at this call
 * site's sole caller (GameContext's constructor, which is built once per
 * ISMCTS decision point/tree-node and often only reads a handful of the
 * ~15-20 controller keys before being discarded). The Proxy defers each
 * controller's getFor() until that key is actually read, and caches the
 * result on `target` so repeat reads are free. Entirely local to one
 * createGenericPlayerView() call - no state shared across calls, no
 * caching beyond one GameContext's own lifetime.
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
    const target = { ...extraFields } as Record<string, unknown>;
    const materialize = (prop: string): void => {
        if (prop in target || !(prop in controllers)) {
            return;
        }
        const controller = (controllers as Record<string, unknown>)[prop];
        target[prop] = (typeof controller === 'object' && controller !== null
            && 'getFor' in controller && typeof (controller as Record<string, unknown>).getFor === 'function')
            ? (controller as { getFor(position: number): unknown }).getFor(playerIndex)
            : controller;
    };
    return new Proxy(target, {
        get(_target, prop: string) {
            materialize(prop);
            return target[prop];
        },
        has(_target, prop: string) {
            return prop in target || prop in controllers;
        },
        ownKeys(_target) {
            return [ ...new Set([ ...Reflect.ownKeys(target), ...Reflect.ownKeys(controllers) ]) ];
        },
        getOwnPropertyDescriptor(_target, prop: string) {
            materialize(prop);
            return Reflect.getOwnPropertyDescriptor(target, prop);
        },
    }) as ControllerHandlerState<Controllers>;
}
