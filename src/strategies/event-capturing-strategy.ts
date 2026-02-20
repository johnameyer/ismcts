import { Message, IndexedControllers, ControllerHandlerState } from '@cards-ts/core';
import { DecisionStrategy } from './decision-strategy.js';

/**
 * Strategy wrapper that intercepts and tracks events returned by the underlying strategy.
 * Manually validates and merges events using the same pattern as ISMCTS expansion.
 */
export class EventCapturingStrategy<
    ResponseMessage extends Message,
    Controllers extends IndexedControllers,
> implements DecisionStrategy<ResponseMessage, Controllers> {
    constructor(
        private delegate: DecisionStrategy<ResponseMessage, Controllers>,
        private tracker: Record<string, unknown>,
        private playerIndex: number,
    ) {}

    getAction(
        handlerData: ControllerHandlerState<Controllers>,
        expectedResponseTypes: readonly (ResponseMessage['type'])[],
    ): ResponseMessage | null {
        // Get action from wrapped strategy
        const action = this.delegate.getAction(handlerData, expectedResponseTypes);

        if (!action) {
            return null;
        }

        // Extract event type from action
        const eventType = this.extractEventType(action);

        // Track the event if tracker has trackEvent method
        if (typeof (this.tracker as Record<string, unknown>).trackEvent === 'function') {
            ((this.tracker as Record<string, unknown>).trackEvent as Function)(this.playerIndex, eventType);
        }

        return action;
    }

    private extractEventType(action: ResponseMessage): string {
        if (!action) {
            return 'Unknown'; 
        }

        return action.type;
    }
}


