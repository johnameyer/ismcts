/**
 * Tracks event distribution during game execution
 * NOTE: Currently simplified - detailed event tracking requires GameDriver modifications
 */
export interface TrackedEvent {
    position: number;
    type: string;
    step: number;
    validated: boolean;
    merged: boolean;
}

export class GameEventTracker {
    private eventCounts = new Map<string, number>();

    private validationErrors: TrackedEvent[] = [];

    private eventSequence: TrackedEvent[] = [];

    private step = 0;

    /*
     * Simplified: just counts steps, not individual events
     * Actual event tracking would require GameDriver modifications
     */
    
    trackEvent(position: number, eventType: string, validated: boolean, merged: boolean) {
        const event: TrackedEvent = {
            position,
            type: eventType,
            step: this.step,
            validated,
            merged,
        };

        this.eventSequence.push(event);
        this.eventCounts.set(eventType, (this.eventCounts.get(eventType) || 0) + 1);

        if (!validated || !merged) {
            this.validationErrors.push(event);
        }

        this.step++;
    }

    incrementStep() {
        this.step++;
    }

    getStatistics() {
        const totalEvents = this.eventSequence.length;
        const endTurnCount = this.eventCounts.get('end-turn-response') || 0;
        const retreatCount = this.eventCounts.get('retreat-response') || 0;
        const nonActionCount = totalEvents - endTurnCount - retreatCount;

        const endTurnRetreatRatio = totalEvents > 0 ? (endTurnCount + retreatCount) / totalEvents : 0;

        return {
            totalEvents,
            eventCounts: Object.fromEntries(this.eventCounts),
            endTurnCount,
            retreatCount,
            nonActionCount,
            endTurnRetreatRatio,
            validationErrorCount: this.validationErrors.length,
        };
    }

    getValidationErrors() {
        return this.validationErrors;
    }

    getEventSequence() {
        return this.eventSequence;
    }

    reset() {
        this.eventCounts.clear();
        this.validationErrors = [];
        this.eventSequence = [];
        this.step = 0;
    }
}
