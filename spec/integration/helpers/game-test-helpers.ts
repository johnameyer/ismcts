import { ControllerState } from '@cards-ts/core';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import type { GameDriver } from '../../../src/utils/driver-types.js';
import { GameEventTracker } from './game-event-tracker.js';
import { manualEventProcessor } from './manual-event-processor.js';
import { GameOutcomeValidator } from './game-outcome-validator.js';

/**
 * Shared game loop for testing with comprehensive tracking and validation
 */
export interface GameRunResult {
    stepCount: number;
    completed: boolean;
    outcomeValidation: { noTie: boolean; winner?: number; details: string };
    eventStats: ReturnType<GameEventTracker['getStatistics']>;
    validationErrors: string[];
}

export function runGameWithTracking(
    driver: GameDriver<ResponseMessage, Controllers>,
    tracker: GameEventTracker,
    maxResumes: number = 500,
): GameRunResult {
    tracker.reset();

    let resumeCount = 0;
    const validationErrors: string[] = [];

    driver.resume();

    /*
     * NOTE: resume() runs the internal state machine until it reaches a point where it needs player input
     * So each "resume" is NOT a single action - it's one state machine cycle, which may include multiple
     * internal transitions (e.g., applying effects, checking game state, etc.) until waiting on player.
     * The actual player actions (tracked events) are much fewer than the resume count.
     */
    
    while (!driver.getState().completed && resumeCount < maxResumes) {        
        // Process incoming sync events with tracking
        const result = manualEventProcessor(driver, tracker);
        validationErrors.push(...result.validationErrors);

        tracker.incrementStep();
        
        driver.resume();
        
        resumeCount++;
    }

    const finalState = driver.getState() as ControllerState<Controllers>;
    const outcomeValidation = GameOutcomeValidator.assertNoTie(finalState);

    const gameRunResult: GameRunResult = {
        stepCount: resumeCount,
        completed: finalState.completed,
        outcomeValidation,
        eventStats: tracker.getStatistics(),
        validationErrors,
    };

    return gameRunResult;
}
