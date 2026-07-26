import { Message, IndexedControllers } from '@cards-ts/core';
import { ActionsGenerator } from './adapter-config.js';
import { GameContext } from './utils/game-context.js';
import { FrameworkControllers } from './ismcts-types.js';

/**
 * Legal Actions Generator for ISMCTS
 *
 * Generates all legal actions available to a player in a given game state.
 * Used by ISMCTS Selection and Expansion phases to determine which actions
 * are valid in the current determinization.
 *
 * Requires a GameContext (pre-built driver snapshot) — no additional driver creation needed.
 */
export class LegalActionsGenerator<ResponseMessage extends Message, Controllers extends IndexedControllers & FrameworkControllers> {
    constructor(
        private actionsGenerator: ActionsGenerator<ResponseMessage, Controllers>,
    ) {}

    generateLegalActions(ctx: GameContext<ResponseMessage, Controllers>, expectedResponseTypes: readonly (ResponseMessage['type'])[]): ResponseMessage[] {
        // Use players.position from the waiting controller — turn can be wrong for non-turn choices
        // (e.g. selecting active after knockout, selecting target — these happen when it's not your turn)
        const currentPlayer = ctx.handlerData.players.position;

        if (process.env.DEBUG_LEGAL_ACTIONS === 'true') {
            console.error('[LegalActionsGenerator] expectedResponseTypes:', expectedResponseTypes);
            console.error('[LegalActionsGenerator] currentPlayer:', currentPlayer);
        }

        const candidateActions = this.actionsGenerator.generateCandidateActions(ctx.handlerData, currentPlayer, expectedResponseTypes);

        if (process.env.DEBUG_LEGAL_ACTIONS === 'true') {
            console.error('[LegalActionsGenerator] candidateActions count:', candidateActions.length);
            console.error('[LegalActionsGenerator] candidateActions types:', candidateActions.map((a: ResponseMessage) => a.type));
        }

        const validated = this.validateActions(candidateActions, currentPlayer, ctx);

        if (process.env.DEBUG_LEGAL_ACTIONS === 'true') {
            console.error('[LegalActionsGenerator] validated count:', validated.length);
            console.error('[LegalActionsGenerator] validated types:', validated.map(a => a.type));
        }

        if (validated.length === 0) {
            if (process.env.DEBUG_LEGAL_ACTIONS === 'true') {
                console.error('[LegalActionsGenerator] expectedResponseTypes:', expectedResponseTypes);
                console.error('[LegalActionsGenerator] handlerData:', ctx.handlerData);
            }
            throw new Error('No actions are possible?');
        }

        return validated;
    }

    private validateActions(actions: ResponseMessage[], currentPlayer: number, ctx: GameContext<ResponseMessage, Controllers>): ResponseMessage[] {
        return actions.filter(action => {
            try {
                return !ctx.validateAction(currentPlayer, action);
            } catch (error) {
                if (process.env.DEBUG_LEGAL_ACTIONS === 'true') {
                    console.error('[LegalActionsGenerator] validation threw:', (error as Error).message);
                }
                return false;
            }
        });
    }
}
