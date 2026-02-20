import { expect } from 'chai';
import { ControllerUtils } from '@cards-ts/pocket-tcg/dist/utils/controller-utils.js';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { LegalActionsGenerator } from '../../src/legal-actions-generator.js';
import { MAIN_ACTION_RESPONSE_TYPES } from '../../src/adapters/pocket-tcg/response-types.js';
import { MockCardRepository } from '../helpers/test-utils.js';
import { StateBuilder } from '../helpers/state-builder.js';
import { createGameAdapterConfig } from '../helpers/test-helpers.js';
import { createWaitingGameStateForMCTS } from '../helpers/test-state-builder.js';

/**
 * Regression test for tool attachment validation issue
 * 
 * Issue: Tool attachment actions were being generated as legal even when
 * the target creature already had a tool attached, causing validation failures
 * during game execution.
 * 
 * Root cause analysis:
 * - Legal actions generator validates against a reconstructed game state
 * - If reconstruction differs from actual state, validation can pass incorrectly
 * - When action later executes against actual state, validation fails
 */
describe('Tool Attachment Validation - Regression', () => {
    let generator: LegalActionsGenerator<ResponseMessage, Controllers>;
    let cardRepository: MockCardRepository;
    let gameAdapterConfig: ReturnType<typeof createGameAdapterConfig>;

    beforeEach(() => {
        cardRepository = new MockCardRepository();
        gameAdapterConfig = createGameAdapterConfig(cardRepository);
        generator = new LegalActionsGenerator(
            gameAdapterConfig.actionsGenerator,
            gameAdapterConfig.driverFactory,
            gameAdapterConfig.reconstructGameStateForValidation,
        );
    });

    it('should NOT generate tool attachment when creature already has a tool', () => {
        // Setup: Create game with tool in hand and active creature without tool
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature'),
                StateBuilder.withCreatures(1, 'basic-creature'),
                StateBuilder.withHand(0, [
                    { templateId: 'basic-tool', type: 'tool' },
                ]),
            ),
            cardRepository,
        );

        // Attach a tool to creature at field index 0 using the actual controllers
        const driver = gameAdapterConfig.driverFactory(gameState, []);
        const controllers = (driver).gameState.controllers;
        const fieldInstanceId = controllers.field.getFieldInstanceId(0, 0);

        if (!fieldInstanceId) {
            throw new Error('Could not get field instance ID for creature at index 0');
        }

        // Attach tool to the creature
        const attached = controllers.tools.attachTool(fieldInstanceId, 'basic-tool', 'tool-instance-1');
        expect(attached).to.be.true;

        // Verify tool is attached
        const attachedTool = controllers.tools.getAttachedTool(fieldInstanceId);
        expect(attachedTool).to.exist;
        expect(attachedTool?.templateId).to.equal('basic-tool');

        // Create handler data view (what legal actions generator sees)
        const handlerData = ControllerUtils.createPlayerView(controllers, 0);

        // Generate legal actions
        const legalActions = generator.generateLegalActions(
            handlerData,
            MAIN_ACTION_RESPONSE_TYPES,
            true,
        );

        // Filter to tool actions
        const toolActions = legalActions.filter(action => action.cardType === 'tool');

        // Should NOT generate tool action for field index 0
        // (the active creature that already has a tool)
        const actionsForIndex0 = toolActions.filter(action => action.targetFieldIndex === 0);

        expect(actionsForIndex0.length).to.equal(
            0,
            'Should not generate tool attachment action for creature that already has a tool attached',
        );
    });

    it('should generate tool attachment only for creatures without tools', () => {
        // Setup: Create game with active and bench creatures, some with tools
        const gameState = createWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature', [ 'basic-creature', 'basic-creature' ]),
                StateBuilder.withCreatures(1, 'basic-creature'),
                StateBuilder.withHand(0, [
                    { templateId: 'basic-tool', type: 'tool' },
                ]),
            ),
            cardRepository,
        );

        // Attach tool to creature at field index 0 (active)
        const driver = gameAdapterConfig.driverFactory(gameState, []);
        const controllers = (driver).gameState.controllers;
        const activeFieldId = controllers.field.getFieldInstanceId(0, 0);
        const bench1FieldId = controllers.field.getFieldInstanceId(0, 1);
        const bench2FieldId = controllers.field.getFieldInstanceId(0, 2);

        if (activeFieldId) {
            controllers.tools.attachTool(activeFieldId, 'basic-tool', 'tool-instance-1');
        }

        // Create handler data view
        const handlerData = ControllerUtils.createPlayerView(controllers, 0);

        // Generate legal actions
        const legalActions = generator.generateLegalActions(
            handlerData,
            MAIN_ACTION_RESPONSE_TYPES,
            true,
        );

        // Filter to tool actions
        const toolActions = legalActions.filter(action => action.cardType === 'tool');

        // Should NOT generate for index 0 (has tool)
        const actionsForIndex0 = toolActions.filter(action => action.targetFieldIndex === 0);
        expect(actionsForIndex0.length).to.equal(0);

        // SHOULD generate for index 1 and 2 (no tools)
        const actionsForIndex1 = toolActions.filter(action => action.targetFieldIndex === 1);
        const actionsForIndex2 = toolActions.filter(action => action.targetFieldIndex === 2);

        expect(actionsForIndex1.length).to.be.greaterThan(0);
        expect(actionsForIndex2.length).to.be.greaterThan(0);
    });
});
