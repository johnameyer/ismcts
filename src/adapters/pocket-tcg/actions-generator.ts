import { HandlerData } from '@cards-ts/pocket-tcg/dist/game-handler.js';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { CardRepository } from '@cards-ts/pocket-tcg/dist/repository/card-repository.js';
import { InstancedFieldCard } from '@cards-ts/pocket-tcg/dist/repository/card-types.js';
import { ControllerState, HandlerChain } from '@cards-ts/core';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { GameSetup } from '@cards-ts/pocket-tcg/dist/game-setup.js';
import { gameFactory } from '@cards-ts/pocket-tcg/dist/game-factory.js';
import {
    EvolveResponseMessage,
    AttackResponseMessage,
    PlayCardResponseMessage,
    EndTurnResponseMessage,
    AttachEnergyResponseMessage,
    RetreatResponseMessage,
    UseAbilityResponseMessage,
    SelectTargetResponseMessage,
    SelectActiveCardResponseMessage,
    SetupCompleteResponseMessage,
} from '@cards-ts/pocket-tcg/dist/messages/response/index.js';
import { getCurrentInstanceId, getCurrentTemplateId, getFieldInstanceId } from '@cards-ts/pocket-tcg/dist/utils/field-card-utils.js';
import { ActionsGenerator, DriverFactory, withDeepCopyWrapper } from '../../adapter-config.js';

/**
 * Pocket-TCG specific implementation of ActionsGenerator.
 * 
 * Generates all candidate actions for Pocket-TCG, including:
 * - Setup phase actions (SetupComplete)
 * - Main phase actions (creatures, evolutions, supporters, items, tools, abilities, retreats, energy, attacks)
 * - Special phase actions (target selection, select active card)
 * 
 * This class encapsulates all Pocket-TCG specific game logic and dependencies,
 * allowing the framework to be extended to other games by implementing
 * alternative ActionsGenerator implementations.
 */
export class PocketTCGActionsGenerator implements ActionsGenerator<ResponseMessage, Controllers> {
    constructor(private cardRepository: CardRepository) {}

    private readonly responseTypeGenerators: Record<ResponseMessage['type'], (handlerData: HandlerData, currentPlayer: number) => ResponseMessage[]> = {
        'setup-complete': (hd, cp) => this.generateSetupActions(hd, cp),
        'select-target-response': (hd) => this.generateTargetSelectionActions(hd),
        'select-active-card-response': (hd, cp) => this.generateSelectActiveCardActions(hd, cp),
        'play-card-response': (hd, cp) => [
            ...this.generateCreatureActions(hd, cp),
            ...this.generateEvolutionActions(hd, cp),
            ...this.generateSupporterActions(hd, cp),
            ...this.generateItemActions(hd, cp),
            ...this.generateToolActions(hd, cp),
        ],
        'use-ability-response': (hd, cp) => this.generateAbilityActions(hd, cp),
        'retreat-response': (hd, cp) => this.generateRetreatActions(hd, cp),
        'attach-energy-response': (hd, cp) => this.generateEnergyActions(hd, cp),
        'attack-response': (hd, cp) => this.generateAttackActions(hd, cp),
        'end-turn-response': () => [ new EndTurnResponseMessage() ],
        'evolve-response': () => [],
        'select-card-response': () => [],
        'select-energy-response': () => [],
        'select-choice-response': () => [],
    };

    generateCandidateActions(handlerData: HandlerData, currentPlayer: number, expectedResponseTypes: readonly (ResponseMessage['type'])[]): ResponseMessage[] {
        const setupState = handlerData.setup;
        const isPlayerReady = setupState?.playersReady?.[currentPlayer] || false;
        const isSetupComplete = setupState?.playersReady?.every(ready => ready) || false;

        // Setup phase - only return setup or end-turn
        if (!isPlayerReady && !isSetupComplete) {
            if (expectedResponseTypes.includes('setup-complete')) {
                return this.responseTypeGenerators['setup-complete'](handlerData, currentPlayer);
            }
            return expectedResponseTypes.includes('end-turn-response') ? [ new EndTurnResponseMessage() ] : [];
        }

        // Priority phases: select-target, select-active-card (only if they have actions)
        if (expectedResponseTypes.includes('select-target-response')) {
            const targetActions = this.responseTypeGenerators['select-target-response'](handlerData, currentPlayer);
            if (targetActions.length > 0) {
                return targetActions;
            }
        }

        if (expectedResponseTypes.includes('select-active-card-response')) {
            const selectActiveActions = this.responseTypeGenerators['select-active-card-response'](handlerData, currentPlayer);
            if (selectActiveActions.length > 0) {
                return selectActiveActions;
            }
        }

        // Main phase - generate actions for requested types
        const actions: ResponseMessage[] = [];
        for (const responseType of expectedResponseTypes) {
            const generator = this.responseTypeGenerators[responseType];
            if (generator) {
                actions.push(...generator(handlerData, currentPlayer));
            }
        }

        return actions;
    }

    private generateSetupActions(handlerData: HandlerData, currentPlayer: number): ResponseMessage[] {
        const hand = handlerData.hand;

        if (!hand) {
            return [];
        }

        // Only basic creatures can be selected during setup
        const basicCreatureCards = hand.filter(card => {
            const c = card as { type?: string; templateId?: string };
            if (!c || c.type !== 'creature' || typeof c.templateId !== 'string') {
                return false;
            }
            const creatureData = this.cardRepository.getCreature(c.templateId);
            return creatureData && !creatureData.previousStageName; // Only basics (no previousStageName)
        });

        if (basicCreatureCards.length === 0) {
            return [];
        }

        const actions: ResponseMessage[] = [];
        const creatureTemplateIds = basicCreatureCards.map((card: unknown) => {
            const c = card as { templateId: string };
            return c.templateId;
        });

        // Generate all valid setup actions:
        // 1. Each basic creature can be active
        // 2. Remaining basic creatures (up to 3) form bench (as a set, order doesn't matter)
        for (let activeIdx = 0; activeIdx < creatureTemplateIds.length; activeIdx++) {
            const activeCardId = creatureTemplateIds[activeIdx];
            const remainingCards = creatureTemplateIds.filter((_, idx) => idx !== activeIdx);

            // Generate all unique bench combinations (not permutations)
            const benchCombinations = this.generateBenchCombinations(remainingCards, Math.min(3, remainingCards.length));
            for (const benchCardIds of benchCombinations) {
                actions.push(new SetupCompleteResponseMessage(activeCardId, benchCardIds));
            }
        }

        return actions;
    }

    private generateBenchCombinations(cards: string[], maxBenchSize: number): string[][] {
        if (cards.length === 0) {
            return [[]];
        }

        const combinations: string[][] = [[]]; // Empty bench is valid

        // Generate all combinations of each size (1 to maxBenchSize)
        for (let size = 1; size <= Math.min(maxBenchSize, cards.length); size++) {
            const combosOfSize = this.generateCombinations(cards, size);
            combinations.push(...combosOfSize);
        }

        return combinations;
    }

    private generateCombinations(items: string[], size: number): string[][] {
        if (size === 0) {
            return [[]];
        }
        if (size === items.length) {
            return [ items ];
        }

        const combinations: string[][] = [];
        for (let i = 0; i <= items.length - size; i++) {
            const head = items[i];
            const tail = items.slice(i + 1);
            const subCombinations = this.generateCombinations(tail, size - 1);
            for (const subCombo of subCombinations) {
                combinations.push([ head, ...subCombo ]);
            }
        }
        return combinations;
    }

    private generateCreatureActions(handlerData: HandlerData, currentPlayer: number): ResponseMessage[] {
        const actions: ResponseMessage[] = [];
        const hand = handlerData.hand;
        const benchSize = handlerData.field.creatures[currentPlayer].length;

        // Can only play creatures if bench has space (max 4 total: 1 active + 3 bench)
        if (benchSize >= 4) {
            return actions;
        }

        // Handle different hand structures
        let playerHand: unknown[] = [];
        if (Array.isArray(hand)) {
            playerHand = hand;
        } else if (hand && typeof hand === 'object') {
            // If hand is a single card object, wrap it in an array
            const handObj = hand as { templateId?: string; [key: number]: unknown };
            if (handObj.templateId) {
                playerHand = [ hand ];
            } else if (handObj[currentPlayer]) {
                // If hand is an object with player arrays
                playerHand = (handObj[currentPlayer] as unknown[]) || [];
            }
        }

        const creatureCards = playerHand.filter((card: unknown): card is { type: string; templateId: string } => {
            const c = card as { type?: string; templateId?: string };
            return c && c.type === 'creature' && typeof c.templateId === 'string';
        });

        creatureCards.forEach(card => {
            // Check if it's a basic creature (can be played directly)
            const creatureData = this.cardRepository.getCreature(card.templateId);
            if (creatureData && !creatureData.previousStageName) {
                actions.push(new PlayCardResponseMessage(card.templateId, 'creature'));
            }
        });

        return actions;
    }

    private generateEvolutionActions(handlerData: HandlerData, currentPlayer: number): ResponseMessage[] {
        const actions: ResponseMessage[] = [];
        const hand = handlerData.hand;
        const activeCreature = handlerData.field.creatures[currentPlayer][0];

        if (!activeCreature) {
            return actions;
        }

        const activeTemplateId = getCurrentTemplateId(activeCreature);
        const activeCreatureData = this.cardRepository.getCreature(activeTemplateId);

        // Build evolution set by checking all creatures for previousStageName match
        // (getEvolutionsOf not available in CardRepository, so we scan all creatures)
        const possibleEvolutionIds = new Set<string>();
        for (const creatureId of this.cardRepository.getAllCreatureIds()) {
            try {
                const creature = this.cardRepository.getCreature(creatureId);
                if ((creature as Record<string, unknown>).previousStageName === activeCreatureData.name) {
                    possibleEvolutionIds.add(creatureId);
                }
            } catch {
                // Skip creatures that can't be loaded
            }
        }
        
        const evolutionCards = hand.filter(card => {
            if (card.type !== 'creature') {
                return false;
            }
            // Check if this card ID is in the evolution index for the active creature
            return possibleEvolutionIds.has(card.templateId);
        });

        evolutionCards.forEach(card => {
            actions.push(new EvolveResponseMessage(card.templateId, 0));
        });

        return actions;
    }

    private generateSupporterActions(handlerData: HandlerData, currentPlayer: number): ResponseMessage[] {
        const actions: ResponseMessage[] = [];

        // Can only play one supporter per turn
        if (handlerData.turnState.supporterPlayedThisTurn) {
            return actions;
        }

        const supporterCards = handlerData.hand.filter(card => card.type === 'supporter');
        supporterCards.forEach(card => {
            actions.push(new PlayCardResponseMessage(card.templateId, 'supporter'));
        });

        return actions;
    }

    private generateItemActions(handlerData: HandlerData, currentPlayer: number): ResponseMessage[] {
        const actions: ResponseMessage[] = [];
        const itemCards = handlerData.hand.filter(card => card.type === 'item');

        itemCards.forEach(card => {
            actions.push(new PlayCardResponseMessage(card.templateId, 'item'));
        });

        return actions;
    }

    private generateToolActions(handlerData: HandlerData, currentPlayer: number): ResponseMessage[] {
        const actions: ResponseMessage[] = [];
        const toolCards = handlerData.hand.filter(card => card.type === 'tool');
        const creatures = handlerData.field.creatures[currentPlayer];

        // Tools must be attached to creatures
        if (!creatures || creatures.length === 0) {
            return actions;
        }

        toolCards.forEach(card => {
            creatures.forEach((creature, fieldIndex) => {
                actions.push(new PlayCardResponseMessage(card.templateId, 'tool', currentPlayer, fieldIndex));
            });
        });

        return actions;
    }

    private generateAbilityActions(handlerData: HandlerData, currentPlayer: number): ResponseMessage[] {
        const actions: ResponseMessage[] = [];
        const activeCreature = handlerData.field.creatures[currentPlayer][0];

        if (!activeCreature) {
            return actions;
        }

        const activeTemplateId = getCurrentTemplateId(activeCreature);
        const activeInstanceId = getCurrentInstanceId(activeCreature);
        const creatureData = this.cardRepository.getCreature(activeTemplateId);
        if (!creatureData?.ability) {
            return actions;
        }

        const ability = creatureData.ability;
        // Check if ability can be used (manual trigger and not used this turn)
        if (ability.trigger.type === 'manual') {
            const abilityKey = `${activeInstanceId}-0`;
            const usedThisTurn = handlerData.turnState?.usedAbilitiesThisTurn?.includes(abilityKey);
            if (!usedThisTurn) {
                actions.push(new UseAbilityResponseMessage(0));
            }
        }

        return actions;
    }

    private generateRetreatActions(handlerData: HandlerData, currentPlayer: number): ResponseMessage[] {
        const actions: ResponseMessage[] = [];

        // Check if already retreated this turn
        if (handlerData.turnState?.retreatedThisTurn) {
            return actions;
        }

        const activeCreature = handlerData.field.creatures[currentPlayer][0];

        // Need active creature and at least one bench creature to retreat to
        if (!activeCreature) {
            return actions;
        }

        if (handlerData.field.creatures[currentPlayer].length <= 1) {
            return actions;
        }

        const activeTemplateId = getCurrentTemplateId(activeCreature);

        const activeFieldInstanceId = getFieldInstanceId(activeCreature);

        const creatureData = this.cardRepository.getCreature(activeTemplateId);

        if (!creatureData || !handlerData.energy?.attachedEnergyByInstance) {
            return actions;
        }

        const attachedEnergy = handlerData.energy.attachedEnergyByInstance[activeFieldInstanceId];

        if (!attachedEnergy) {
            return actions;
        }

        const totalEnergy = Object.values(attachedEnergy).reduce((sum: number, count: unknown) => sum + (typeof count === 'number' ? count : 0), 0);

        if (totalEnergy >= creatureData.retreatCost) {
            // Generate retreat actions for each bench creature (0-based bench indexing)
            const benchCount = handlerData.field.creatures[currentPlayer].length - 1; // Exclude active
            for (let benchIndex = 0; benchIndex < benchCount; benchIndex++) {
                actions.push(new RetreatResponseMessage(benchIndex));
            }
        }

        return actions;
    }

    private generateEnergyActions(handlerData: HandlerData, currentPlayer: number): ResponseMessage[] {
        if (!handlerData.energy) {
            return [];
        }

        // First turn restriction - can't attach energy on absolute first turn
        if (handlerData.energy.isAbsoluteFirstTurn) {
            return [];
        }

        // Check if energy is available in energy zone
        const currentEnergy = handlerData.energy.currentEnergy[currentPlayer];
        
        // No energy available if currentEnergy is null or undefined
        if (!currentEnergy) {
            return [];
        }

        // Need at least one creature to attach energy to
        if (!handlerData.field.creatures[currentPlayer] || handlerData.field.creatures[currentPlayer].length === 0) {
            return [];
        }

        const actions = handlerData.field.creatures[currentPlayer].map((_, index) => new AttachEnergyResponseMessage(index));
        return actions;
    }

    private generateAttackActions(handlerData: HandlerData, currentPlayer: number): ResponseMessage[] {
        const actions: ResponseMessage[] = [];

        /*
         * Only use the current player's creatures, not opponent's creatures visible in handlerData
         * handlerData.field.creatures may contain both players' creatures depending on information visibility
         * but we should only generate actions for currentPlayer's own creatures
         */
        const playerCreatures = handlerData.field.creatures[currentPlayer];
        if (!playerCreatures || playerCreatures.length === 0) {
            return actions;
        }

        const activeCreature = playerCreatures[0];

        if (!activeCreature) {
            return actions;
        }

        const templateId = getCurrentTemplateId(activeCreature);
        const creatureData = this.cardRepository.getCreature(templateId);

        if (!creatureData?.attacks) {
            return actions;
        }

        // Generate attack actions for each attack on the creature
        for (let attackIndex = 0; attackIndex < creatureData.attacks.length; attackIndex++) {
            if (this.canAttack(handlerData, activeCreature, attackIndex)) {
                actions.push(new AttackResponseMessage(attackIndex));
            }
        }

        return actions;
    }

    private canAttack(handlerData: HandlerData, activeCard: InstancedFieldCard, attackIndex: number = 0): boolean {
        if (!handlerData.energy) {
            return false;
        }

        const templateId = getCurrentTemplateId(activeCard);
        const fieldInstanceId = getFieldInstanceId(activeCard);
        const creatureData = this.cardRepository.getCreature(templateId);
        const attack = creatureData?.attacks?.[attackIndex];

        if (!attack) {
            return false;
        }

        const attachedEnergy = handlerData.energy.attachedEnergyByInstance?.[fieldInstanceId];

        if (!attachedEnergy) {
            return false;
        }

        const totalEnergy = Object.values(attachedEnergy).reduce((sum: number, count: unknown) => sum + (typeof count === 'number' ? count : 0), 0);

        for (const requirement of attack.energyRequirements) {
            if (requirement.type === 'any' || requirement.type === 'colorless') {
                if (totalEnergy < requirement.amount) {
                    return false;
                }
            } else {
                const energyCount = attachedEnergy[requirement.type as keyof typeof attachedEnergy];
                const typeCount = typeof energyCount === 'number' ? energyCount : 0;
                if (typeCount < requirement.amount) {
                    return false;
                }
            }
        }

        return true;
    }

    private generateTargetSelectionActions(handlerData: HandlerData): ResponseMessage[] {
        const actions: ResponseMessage[] = [];

        // Check if there's a pending selection
        if (!handlerData.turnState?.pendingSelection) {
            return actions;
        }

        // Get all visible targets from handlerData (framework will validate team/position constraints)
        const allTargets: Array<{ playerId: number; fieldIndex: number }> = [];
        for (let playerId = 0; playerId < 2; playerId++) {
            const playerCards = handlerData.field?.creatures?.[playerId];
            if (playerCards) {
                for (let fieldIndex = 0; fieldIndex < playerCards.length; fieldIndex++) {
                    allTargets.push({ playerId, fieldIndex });
                }
            }
        }

        if (allTargets.length === 0) {
            return actions;
        }

        // Get target count from pending selection (default to 1 for single-choice)
        const pendingSelection = handlerData.turnState.pendingSelection;
        const count = pendingSelection.count || 1;

        if (count === 1) {
            // Single-choice: generate one action per target
            for (const target of allTargets) {
                actions.push(new SelectTargetResponseMessage([ target ]));
            }
        } else {
            // Multi-choice: generate all combinations of the specified count
            const combinations = this.generateTargetCombinations(allTargets, count);
            for (const combination of combinations) {
                actions.push(new SelectTargetResponseMessage(combination));
            }
        }

        return actions;
    }

    private generateTargetCombinations(targets: Array<{ playerId: number; fieldIndex: number }>, size: number): Array<Array<{ playerId: number; fieldIndex: number }>> {
        if (size === 0) {
            return [[]];
        }
        if (size === targets.length) {
            return [ targets ];
        }
        if (size > targets.length) {
            return []; // Not enough targets
        }

        const combinations: Array<Array<{ playerId: number; fieldIndex: number }>> = [];
        for (let i = 0; i <= targets.length - size; i++) {
            const head = targets[i];
            const tail = targets.slice(i + 1);
            const subCombinations = this.generateTargetCombinations(tail, size - 1);
            for (const subCombo of subCombinations) {
                combinations.push([ head, ...subCombo ]);
            }
        }
        return combinations;
    }

    private generateSelectActiveCardActions(handlerData: HandlerData, currentPlayer: number): ResponseMessage[] {
        const actions: ResponseMessage[] = [];

        /*
         * Generate SelectActiveCard actions for all bench cards.
         * Use currentPlayer which is extracted from the waiting state and represents the player
         * who is waiting to select a new active card.
         */
        
        const playerCards = handlerData.field?.creatures?.[currentPlayer];
        if (!playerCards || playerCards.length < 2) {
            // Need at least 2 creatures: 1 active + 1 bench
            return actions;
        }

        /*
         * Generate actions for each bench card (skip index 0 which is active)
         * playerCards[0] = active, playerCards[1+] = bench
         * benchIndex 0 = first bench card = playerCards[1]
         */
        for (let fieldIndex = 1; fieldIndex < playerCards.length; fieldIndex++) {
            const benchIndex = fieldIndex - 1;
            const msg = new SelectActiveCardResponseMessage(benchIndex);
            actions.push(msg);
        }

        return actions;
    }
}

/**
 * Pocket-TCG driver factory for validation and simulation.
 * 
 * Creates a game driver instance for both action validation and MCTS simulation.
 * Handles Pocket-TCG specific setup and game factory instantiation.
 */
export function createPocketTCGDriverFactory(cardRepository: CardRepository): DriverFactory<ResponseMessage, Controllers> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Game framework internals
    const baseFactory: DriverFactory<ResponseMessage, Controllers> = (gameState: ControllerState<Controllers>, handlers: unknown[]): any => {
        const factory = gameFactory(cardRepository);
        const params = new GameSetup().getDefaultParams();
        
        // Use provided handlers or create no-op handlers
        const noOpHandler = () => ({
            handleAction: () => {},
            handleSelectActiveCard: () => {},
            handleSetup: () => {},
            handleEvolve: () => {},
            handleMessage: () => {},
        });
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const playersToUse: any = handlers && handlers.length > 0 
            ? (handlers as any[]).map(h => new HandlerChain([ h ]))
            : [
                new HandlerChain([ noOpHandler() ]),
                new HandlerChain([ noOpHandler() ]),
            ];
        
        // Pass empty player names array - framework doesn't strictly require them
        const frameworkDriver = factory.getGameDriver(playersToUse, params, [], gameState);
        
        return frameworkDriver;
    };
    
    // Wrap with automatic deep copy to prevent state mutations
    return withDeepCopyWrapper(baseFactory);
}

        
