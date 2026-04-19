import { CardRepository } from '@cards-ts/pocket-tcg/dist/repository/card-repository.js';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { HandlerData } from '@cards-ts/pocket-tcg/dist/game-handler.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { ControllerState } from '@cards-ts/core';
import { EndTurnResponseMessage, RetreatResponseMessage, AttackResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response/index.js';
import { GameCard } from '@cards-ts/pocket-tcg/dist/controllers/card-types.js';
import { COIN_FLIP_AMOUNT_TYPE } from '@cards-ts/pocket-tcg/dist/index.js';
import { GameAdapterConfig } from '../../adapter-config.js';
import { DecisionStrategy } from '../../strategies/decision-strategy.js';
import { PocketTCGHandler } from './handler.js';
import { PocketTCGActionsGenerator } from './actions-generator.js';
import {
    createPocketTCGDriverFactory,
} from './actions-generator.js';
import { PocketTCGDeterminization, getTimeoutReward, isGameEnded, getRewardForPlayer } from './index.js';

/**
 * Create Pocket-TCG GameAdapterConfig with all game-specific implementations.
 * 
 * This factory creates:
 * - Action generation (PocketTCGActionsGenerator)
 * - Driver factories (for validation and simulation)
 * - Round end detection and reward calculation
 * - Handler factories that accept pluggable strategies
 * 
 * @param cardRepository - Pocket-TCG specific card metadata
 * @returns Complete GameAdapterConfig ready to pass to ISMCTSModular
 */
export function createPocketTCGAdapterConfig(cardRepository: CardRepository): GameAdapterConfig<ResponseMessage, Controllers> {
    const config: GameAdapterConfig<ResponseMessage, Controllers> = {
        actionsGenerator: new PocketTCGActionsGenerator(cardRepository),
        driverFactory: createPocketTCGDriverFactory(cardRepository),
        isRoundEnded: (gameState) => isGameEnded(gameState),
        getRoundReward: (gameState, playerIndex) => getRewardForPlayer(gameState, playerIndex),
        getTimeoutReward,
        determinization: new PocketTCGDeterminization(cardRepository),

        reconstructGameStateForValidation: (handlerData: HandlerData): ControllerState<Controllers> => {
            // HandlerData spreads individual controller properties (tools, field, energy, etc.)
            // ControllerState also uses this flattened structure - NOT nested under 'controllers'
            
            return {
                ...handlerData,
                state: handlerData.state || 'START_GAME',
                data: Array.isArray(handlerData.data) ? handlerData.data : [ handlerData.data || {} ],
                hand: reconstructHandState(handlerData.hand, handlerData.turn),
                deck: reconstructDeckState(0, handlerData.turn),
                players: undefined,
            } as unknown as ControllerState<Controllers>;
        },

        getPlayerNames: (gameState) => gameState.names as string[],

        /**
         * Weight actions for random playout strategy.
         * EndTurnResponseMessage and RetreatResponseMessage have 1/4 weight (0.25).
         * Other actions have default weight 1.0.
         */
        getActionWeight: (action: ResponseMessage) => {
            if (action instanceof EndTurnResponseMessage || action instanceof RetreatResponseMessage) {
                return 0.25;
            }
            return 1.0;
        },

        createHandler: (strategy: DecisionStrategy<ResponseMessage, Controllers>) => {
            return new PocketTCGHandler(strategy);
        },
    };

    return config;
}

/**
 * Reconstruct hand state array for both players from HandlerData.
 * @param playerHand - The current player's hand from HandlerData
 * @param playerIndex - Which player's view this is (0 or 1)
 */
function reconstructHandState(playerHand: GameCard[], playerIndex: number): Array<Array<GameCard>> {
    const hands: Array<Array<GameCard>> = [[], []];
    hands[playerIndex] = Array.isArray(playerHand) ? playerHand : [];
    hands[1 - playerIndex] = [];
    return hands;
}

/**
 * Reconstruct deck state array for both players.
 * Pocket-TCG uses empty arrays for hidden opponent deck.
 * @param _playerDeckSize - Player's deck size (unused, empty for hidden info)
 * @param _playerIndex - Which player's view this is
 */
function reconstructDeckState(_playerDeckSize: number, _playerIndex: number): Array<Array<GameCard>> {
    // The HandlerData doesn't expose full deck state, so we create placeholder cards
    // for validation. These don't need to be real - just enough to satisfy
    // the game driver's initial hand draw requirements.
    return [
        [{ instanceId: 'deck-p0-basic', type: 'supporter', templateId: 'a4-156-will' }],
        [{ instanceId: 'deck-p1-basic', type: 'supporter', templateId: 'a4-156-will' }],
    ];
}

function findGuaranteedImmediateWinningAction(
    handlerData: HandlerData,
    expectedResponseTypes: readonly ResponseMessage['type'][],
    legalActions: ResponseMessage[],
    _config: GameAdapterConfig<ResponseMessage, Controllers>,
    cardRepository: CardRepository,
): ResponseMessage | null {
    if (!expectedResponseTypes.includes('attack-response')) {
        return null;
    }

    const currentPlayer = handlerData.players.position;
    const opponentPlayer = 1 - currentPlayer;
    const activeCreature = handlerData.field.creatures[currentPlayer]?.[0];
    const benchCreatures = handlerData.field.creatures[currentPlayer]?.slice(1) || [];
    const opponentActive = handlerData.field.creatures[opponentPlayer]?.[0];
    
    if (!activeCreature || !opponentActive) {
        return null;
    }

    const opponentTemplateId = opponentActive.evolutionStack[opponentActive.evolutionStack.length - 1]?.templateId;
    if (!opponentTemplateId) {
        return null;
    }

    const opponentCreatureData = cardRepository.getCreature(opponentTemplateId);
    const opponentMaxHP = opponentCreatureData?.maxHp;
    if (!opponentMaxHP) {
        return null;
    }

    const currentOpponentDamage = opponentActive.damageTaken || 0;
    const currentPlayerEnergyCards = handlerData.energy.currentEnergy[currentPlayer] || [];

    // Check if current active creature can win
    for (const action of legalActions) {
        if (!isGuaranteedWinningAttack(action, activeCreature, cardRepository, handlerData)) {
            continue;
        }

        const attackIndex = (action as AttackResponseMessage).attackIndex;
        const activeTemplateId = activeCreature.evolutionStack[activeCreature.evolutionStack.length - 1]?.templateId;
        if (!activeTemplateId) {
            continue;
        }

        const creatureData = cardRepository.getCreature(activeTemplateId);
        const attackData = creatureData?.attacks?.[attackIndex];
        if (!attackData) {
            continue;
        }

        // Extract numeric damage value from attack
        const attackDamage = typeof attackData.damage === 'number' ? attackData.damage : 0;
        if (attackDamage === 0) {
            continue;
        }

        // Check if attack damage would KO opponent
        const totalDamage = currentOpponentDamage + attackDamage;
        if (totalDamage >= opponentMaxHP) {
            return action;
        }
    }

    // Check if we can retreat to a bench creature that can win
    const activeTemplateId = activeCreature.evolutionStack[activeCreature.evolutionStack.length - 1]?.templateId;
    if (!activeTemplateId) {
        return null;
    }

    const activeCreatureData = cardRepository.getCreature(activeTemplateId);
    const retreatCost = activeCreatureData?.retreatCost || 0;
    
    // Check if we have enough energy to retreat
    const retreatEnergyAvailable = currentPlayerEnergyCards.length;
    if (retreatEnergyAvailable < retreatCost) {
        return null;
    }

    // Check if any bench creature can win
    for (const benchCreature of benchCreatures) {
        const benchTemplateId = benchCreature.evolutionStack[benchCreature.evolutionStack.length - 1]?.templateId;
        if (!benchTemplateId) {
            continue;
        }

        const benchCreatureData = cardRepository.getCreature(benchTemplateId);
        if (!benchCreatureData?.attacks) {
            continue;
        }

        for (const attackData of benchCreatureData.attacks) {
            const attackDamage = typeof attackData.damage === 'number' ? attackData.damage : 0;
            if (attackDamage === 0) {
                continue;
            }

            // Check if this attack would KO opponent
            const totalDamage = currentOpponentDamage + attackDamage;
            if (totalDamage >= opponentMaxHP) {
                // Find retreat action in legal actions
                for (const action of legalActions) {
                    if (action instanceof RetreatResponseMessage) {
                        return action;
                    }
                }
            }
        }
    }

    return null;
}

function isGuaranteedWinningAttack(
    action: ResponseMessage,
    activeCreature: HandlerData['field']['creatures'][number][number],
    cardRepository: CardRepository,
    handlerData: HandlerData,
): action is AttackResponseMessage {
    if (!(action instanceof AttackResponseMessage)) {
        return false;
    }

    const attackIndex = action.attackIndex;
    const activeTemplateId = activeCreature.evolutionStack[activeCreature.evolutionStack.length - 1]?.templateId;
    if (!activeTemplateId) {
        return false;
    }

    const creatureData = cardRepository.getCreature(activeTemplateId);
    const attackData = creatureData?.attacks?.[attackIndex];
    if (!attackData) {
        return false;
    }

    if (containsCoinFlipOutcome(attackData)) {
        /*
         * Treat probabilistic attacks as non-guaranteed wins.
         * TODO: Support additional stochastic effects (e.g. random target damage)
         * where all outcomes still guarantee victory.
         */
        return false;
    }

    // If attack resolution requires follow-up target/card selections, it is not immediate.
    return !handlerData.turnState?.pendingSelection;
}

function containsCoinFlipOutcome(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    if (Array.isArray(value)) {
        return value.some(item => containsCoinFlipOutcome(item));
    }

    const record = value as Record<string, unknown>;
    for (const [ key, nested ] of Object.entries(record)) {
        if (key === 'type' && nested === COIN_FLIP_AMOUNT_TYPE) {
            return true;
        }
        if (containsCoinFlipOutcome(nested)) {
            return true;
        }
    }
    return false;
}
