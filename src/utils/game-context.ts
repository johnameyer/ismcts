import { Message, IndexedControllers, ControllerState, ControllerHandlerState } from '@cards-ts/core';
import { GameAdapterConfig } from '../adapter-config.js';
import { FrameworkControllers } from '../ismcts-types.js';
import { CaptureDecisionStrategy } from '../strategies/capture-decision-strategy.js';
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
 * - resumeAndCapture for selection (reuses the same driver — saves one deep copy vs.
 *   building a second driver via applyActionResumeAndCapture)
 * - isEnded for short-circuit checks
 *
 * The driver is always constructed with capture handlers installed (not lazily
 * swapped in on first use of resumeAndCapture) so there is exactly one driver
 * per GameContext, built once, for the lifetime of the instance - callers that
 * only ever call applyAction (or nothing but reads) simply never trigger the
 * handlers, since they're only consulted during resume().
 *
 * Single-use: call at most one of applyAction / resumeAndCapture per context.
 */
export class GameContext<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers> {

    readonly waitingPlayer: number;

    readonly handlerData: ControllerHandlerState<Controllers>;

    private readonly preActionState: ControllerState<Controllers>;

    private readonly driver: GameDriver<ResponseMessage, Controllers>;

    private readonly captureStrategy: CaptureDecisionStrategy<ResponseMessage, Controllers, ControllerHandlerState<Controllers>>;

    /**
     * @param ownsState Set true only when `state` is provably exclusively
     * owned by this call and about to be discarded regardless of what
     * happens here (e.g. selection.ts's tree-walk loop, feeding the
     * previous iteration's own `resumeAndCapture().newState` - a raw
     * reference into a driver that's discarded the moment this constructor
     * returns, never read by anything else). When true and the adapter
     * provides a `rawDriverFactory`, skips the defensive deep copy that
     * `driverFactory` always performs - GameContext construction happens
     * once per tree-depth level per iteration, so that copy was a
     * measured dominant cost. Defaults to false (always copy), matching
     * prior behavior, for any call site that can't make this guarantee.
     */
    constructor(
        state: ControllerState<Controllers>,
        private readonly gameAdapterConfig: GameAdapterConfig<ResponseMessage, Controllers>,
        ownsState = false,
    ) {
        this.preActionState = state;
        this.captureStrategy = new CaptureDecisionStrategy(gameAdapterConfig);
        const captureHandler = gameAdapterConfig.createHandler(this.captureStrategy);
        const factory = (ownsState && gameAdapterConfig.rawDriverFactory) || gameAdapterConfig.driverFactory;
        this.driver = factory(state, [ captureHandler, captureHandler ]);
        this.waitingPlayer = extractWaitingPlayer(this.driver.gameState.controllers.waiting.get());
        this.handlerData = createGenericPlayerView(this.driver.gameState.controllers, this.waitingPlayer);
    }

    validateAction(player: number, action: ResponseMessage): string | undefined {
        return this.driver.getValidationError(player, action);
    }

    /**
     * Live controllers for this context's driver. Lets callers that already
     * hold a GameContext reuse its already-constructed driver for read-only
     * queries (e.g. real damage resolution) instead of building a separate
     * one just to ask a question this context's driver could already answer.
     */
    get controllers(): Controllers {
        return this.driver.gameState.controllers;
    }

    /**
     * Apply an action using the context's driver (no additional deep copy).
     * Uses getRawState() instead of getState(): the caller (expansion.ts)
     * immediately feeds newState into a fresh driverFactory call, which
     * deep-copies it via structuredClone - so getState()'s reconstruct()
     * pass would just be producing an independent copy that gets thrown
     * away and redone a moment later. Safe because pocket-tcg (the only
     * game ISMCTS drives) never has anything for reconstruct()'s
     * type-restoration switch to match - see getRawState()'s docs.
     * Single-use: do not call twice on the same context, and not combined
     * with resumeAndCapture.
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
        return { newState: this.driver.getRawState(), actingPlayer: this.waitingPlayer };
    }

    /**
     * Apply an action, resume to the next decision point, and capture the
     * response types expected there - using the context's driver (no
     * additional deep copy vs. the old pattern of applying via a fresh
     * applyActionResumeAndCapture call). Uses getRawState() instead of
     * getState() - see applyAction()'s docs above for why this is safe:
     * the caller (selection.ts's tree-walk loop) immediately feeds newState
     * into the next GameContext's driverFactory call, which structuredClone's
     * it anyway. Single-use: do not call twice on the same context, and not
     * combined with applyAction.
     */
    resumeAndCapture(action: ResponseMessage): { newState: ControllerState<Controllers>, capturedResponseTypes: (ResponseMessage['type'])[] } {
        const validationError = this.driver.getValidationError(this.waitingPlayer, action);
        if (validationError) {
            throw new Error(`Action validation failed: ${validationError}`);
        }
        const wasValid = this.driver.handleEvent(this.waitingPlayer, action, undefined);
        if (!wasValid) {
            throw new Error('Action application failed after validation passed');
        }
        this.driver.resume();
        return {
            newState: this.driver.getRawState(),
            capturedResponseTypes: this.captureStrategy.getCapturedResponseTypes(),
        };
    }

    isEnded(): boolean {
        return this.gameAdapterConfig.isRoundEnded(this.preActionState);
    }
}
