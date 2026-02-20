import { CardRepository } from '@cards-ts/pocket-tcg/dist/repository/card-repository.js';
import { ControllerState } from '@cards-ts/core';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { StateBuilder } from './state-builder.js';
import { createGameAdapterConfig } from './test-helpers.js';

/**
 * Creates a non-waiting game state for MCTS testing (for use with determinization).
 * 
 * Returns a GameState object WITHOUT:
 * - Any GameDriver backing it
 * - resume() ever having been called on it
 * - Any waiting state (waiting: { waiting: [], responded: [] })
 * 
 * The state is in ACTIONLOOP_IF_NOT_CHECKPENDINGSELECTIONS so when a GameDriver
 * is created and resume() is called, the state machine will transition to the action
 * phase and pause for player input.
 * 
 * USE THIS FOR: Tests using determinization loop (determinize → runSingleIteration)
 * 
 * Note: A custom cardRepository can be passed but is not used - the ISMCTS
 * instance using this state is responsible for using the same repository.
 * 
 * @param stateCustomizer Optional function to customize the state (e.g., withHand, withDamage)
 * @param _cardRepository Ignored - kept for backward compatibility
 */
export function createNonWaitingGameStateForMCTS(
    stateCustomizer?: (state: ControllerState<Controllers>) => void,
    _cardRepository?: CardRepository,
): ControllerState<Controllers> {
    // Combine state machine state with any customizer provided
    const combinedCustomizer = stateCustomizer
        ? StateBuilder.combine(
            StateBuilder.withGameState('ACTIONLOOP_IF_NOT_CHECKPENDINGSELECTIONS'),
            stateCustomizer,
        )
        : StateBuilder.withGameState('ACTIONLOOP_IF_NOT_CHECKPENDINGSELECTIONS');
    
    /*
     * Build a pure state object using StateBuilder
     * Start before the action check so resume() will transition into it
     */
    const state = StateBuilder.createActionPhaseState(combinedCustomizer);
    
    if (!state) {
        throw new Error('Failed to create base action phase state');
    }
    
    // Verify state is in correct condition for MCTS
    if ((state.state as string) !== 'ACTIONLOOP_IF_NOT_CHECKPENDINGSELECTIONS') {
        throw new Error(`Expected state ACTIONLOOP_IF_NOT_CHECKPENDINGSELECTIONS but got ${state.state}`);
    }
    const waitingArray = Array.isArray(state.waiting.waiting) ? state.waiting.waiting : [];
    if (waitingArray.length > 0 || state.waiting.responded.length > 0) {
        throw new Error('createNonWaitingGameStateForMCTS created a state with waiting set - this should never happen');
    }
    
    return state as ControllerState<Controllers>;
}

/**
 * Creates a waiting game state for MCTS testing.
 * 
 * Returns a game state paused at a decision point (waiting state).
 * This is suitable for tests calling getActions() or getBestAction().
 * 
 * @param stateCustomizer Optional function to customize the state
 * @param cardRepository Required to create driver for resume
 */
export function createWaitingGameStateForMCTS(
    stateCustomizer: undefined | ((state: ControllerState<Controllers>) => void),
    cardRepository: CardRepository,
): ControllerState<Controllers> {
    if (!cardRepository) {
        throw new Error('cardRepository is required for createWaitingGameStateForMCTS');
    }
    
    // Start with non-waiting state
    const nonWaitingState = createNonWaitingGameStateForMCTS(stateCustomizer, cardRepository);
    
    // Create a driver and resume to get to waiting state
    const gameAdapterConfig = createGameAdapterConfig(cardRepository);
    const driver = gameAdapterConfig.driverFactory(nonWaitingState, []);
    driver.resume();
    const waitingState = driver.getState();

    if (!waitingState) {
        throw new Error('createWaitingGameStateForMCTS: driver.getState() returned undefined after resume');
    }
    
    if (!waitingState.waiting) {
        throw new Error(`createWaitingGameStateForMCTS: waiting state missing 'waiting' property. State keys: ${Object.keys(waitingState).join(', ')}`);
    }
    
    // Verify we got a waiting state
    const waitingArray = Array.isArray(waitingState.waiting.waiting) ? waitingState.waiting.waiting : [];
    if (waitingArray.length === 0) {
        throw new Error('createWaitingGameStateForMCTS failed to create a waiting state after resume');
    }     
    return waitingState;
}
