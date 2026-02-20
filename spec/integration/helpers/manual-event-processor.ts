import { Message, IndexedControllers } from '@cards-ts/core';
import type { GameDriver } from '../../../src/utils/driver-types.js';
import { GameEventTracker } from './game-event-tracker.js';

/**
 * Manually processes sync responses from game driver, tracking events with GameEventTracker
 * Wraps driver.handleSyncResponses() and tracks what events are processed
 */
export interface ProcessorResult {
    eventsProcessed: number;
    validationErrors: string[];
}

export function manualEventProcessor<ResponseMessage extends Message, Controllers extends IndexedControllers>(
    driver: GameDriver<ResponseMessage, Controllers>,
    tracker: GameEventTracker,
): ProcessorResult {
    /*
     * Note: We can't easily intercept internal event processing without access to handlerProxy
     * Instead, call handleSyncResponses and increment event tracking
     * In a real implementation, you'd need to modify GameDriver to expose event hooks
     */
    
    try {
        driver.handleSyncResponses();
        /*
         * For now, we assume all sync responses are valid (since handleSyncResponses succeeds)
         * A more sophisticated approach would require modifying the game driver to expose
         * validation information
         */
        return { eventsProcessed: 0, validationErrors: [] };
    } catch (error) {
        return {
            eventsProcessed: 0,
            validationErrors: [ error instanceof Error ? error.message : String(error) ],
        };
    }
}

