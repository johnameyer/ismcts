import { CardRepository } from '@cards-ts/pocket-tcg/dist/repository/card-repository.js';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { AttackDamageResolver } from '@cards-ts/pocket-tcg/dist/effects/attack-damage-resolver.js';
import { getCurrentInstanceId } from '@cards-ts/pocket-tcg/dist/utils/field-card-utils.js';
import { HandlerData } from '@cards-ts/pocket-tcg/dist/game-handler.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { ControllerState } from '@cards-ts/core';
import {
    AttackResponseMessage,
    EndTurnResponseMessage,
    RetreatResponseMessage,
} from '@cards-ts/pocket-tcg/dist/messages/response/index.js';
import { GameCard } from '@cards-ts/pocket-tcg/dist/controllers/card-types.js';
import { GameAdapterConfig } from '../../adapter-config.js';
import { DecisionStrategy } from '../../strategies/decision-strategy.js';
import { applyActionAndResume } from '../../utils/driver-orchestrator.js';
import { PocketTCGHandler } from './handler.js';
import { PocketTCGActionsGenerator } from './actions-generator.js';
import {
    createPocketTCGDriverFactory,
} from './actions-generator.js';
import { PocketTCGDeterminization, getTimeoutReward, isGameEnded, getRewardForPlayer } from './index.js';

const COIN_FLIP_AMOUNT_TYPE = 'coin-flip';

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
    const { driverFactory, rawDriverFactory } = createPocketTCGDriverFactory(cardRepository);
    const config: GameAdapterConfig<ResponseMessage, Controllers> = {
        actionsGenerator: new PocketTCGActionsGenerator(cardRepository),
        driverFactory,
        rawDriverFactory,
        isRoundEnded: (gameState) => isGameEnded(gameState),
        getRoundReward: (gameState, playerIndex) => getRewardForPlayer(gameState, playerIndex),
        getTimeoutReward,
        determinization: new PocketTCGDeterminization(cardRepository),

        reconstructGameStateForValidation: (handlerData: HandlerData): ControllerState<Controllers> => {
            // HandlerData spreads individual controller properties (tools, field, energy, etc.)
            // ControllerState also uses this flattened structure - NOT nested under 'controllers'

            // Reconstruct hand as 2D array for ControllerState (HandController.state is GameCard[][])
            const hand: Array<GameCard[]> = [[], []];
            const currentPlayer = handlerData.players.position;
            hand[currentPlayer] = handlerData.hand.hand;

            // Find a card templateId known to exist in the repository to use for placeholders.
            // Prefer a card from the current player's hand; fall back to a field creature.
            const handCards = handlerData.hand.hand as (typeof handlerData.hand.hand[number] | undefined)[];
            const placeholderCard = handCards[0]
                ?? handlerData.field.creatures[currentPlayer][0]?.evolutionStack.at(-1)
                ?? handlerData.field.creatures[1 - currentPlayer][0]?.evolutionStack.at(-1);
            const placeholderTemplateId = placeholderCard?.templateId ?? 'unknown';
            const placeholderType: GameCard['type'] = (placeholderCard as GameCard | undefined)?.type ?? 'creature';

            // Opponent's hand: create placeholder cards matching known size.
            const opponentSize = handlerData.hand.sizes[1 - currentPlayer] || 0;
            for (let i = 0; i < opponentSize; i++) {
                hand[1 - currentPlayer].push({
                    instanceId: `hand-placeholder-p${1 - currentPlayer}-${i}`,
                    type: placeholderType,
                    templateId: placeholderTemplateId,
                });
            }
            
            const result: Partial<ControllerState<Controllers>> = {
                ...handlerData,
                state: ((handlerData as unknown as Record<string, unknown>).state ?? 'ACTIONLOOP_IF_NOT_CHECKPENDINGSELECTIONS') as unknown as ControllerState<Controllers>['state'],
                data: Array.isArray(handlerData.data) ? handlerData.data : [ handlerData.data ],
                hand,
                deck: reconstructDeckState(handlerData, placeholderTemplateId, placeholderType),
                players: undefined,
            };
            
            return result as ControllerState<Controllers>;
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

        getImmediateWinningAction: (handlerData, expectedResponseTypes, legalActions, controllers) => {
            return findGuaranteedImmediateWinningAction(
                handlerData,
                expectedResponseTypes,
                legalActions,
                config,
                cardRepository,
                controllers,
            );
        },

        createHandler: (strategy: DecisionStrategy<ResponseMessage, Controllers>) => {
            return new PocketTCGHandler(strategy);
        },
    };

    return config;
}

/**
 * Reconstruct deck state array for both players using fake cards.
 * Uses deck.sizes from HandlerData to create placeholder decks so validation passes.
 * This maintains information asymmetry: we know HOW MANY cards are left, but not which ones.
 * @param handlerData - HandlerData containing deck.sizes (public knowledge)
 */
function reconstructDeckState(handlerData: HandlerData, placeholderTemplateId: string, placeholderType: GameCard['type']): Array<Array<GameCard>> {
    const { sizes } = handlerData.deck;

    const decks: Array<Array<GameCard>> = [[], []];

    for (let playerIdx = 0; playerIdx < 2; playerIdx++) {
        const size = sizes[playerIdx];
        for (let i = 0; i < size; i++) {
            decks[playerIdx].push({
                instanceId: `deck-placeholder-p${playerIdx}-${i}`,
                type: placeholderType,
                templateId: placeholderTemplateId,
            });
        }
    }

    return decks;
}

function findGuaranteedImmediateWinningAction(
    handlerData: HandlerData,
    expectedResponseTypes: readonly ResponseMessage['type'][],
    legalActions: ResponseMessage[],
    config: GameAdapterConfig<ResponseMessage, Controllers>,
    cardRepository: CardRepository,
    controllers: Controllers,
): ResponseMessage | null {
    if (!expectedResponseTypes.includes('attack-response')) {
        return null;
    }

    const currentPlayer = handlerData.players.position;
    const activeCreature = handlerData.field.creatures[currentPlayer][0];

    for (const action of legalActions) {
        if (!isGuaranteedWinningAttack(action, activeCreature, cardRepository, handlerData, controllers, currentPlayer)) {
            continue;
        }

        const gameState = config.reconstructGameStateForValidation(handlerData);
        let resultingState;
        try {
            resultingState = applyActionAndResume(gameState, action, currentPlayer, config.driverFactory);
        } catch {
            continue;
        }
        const didWinImmediately = isGameEnded(resultingState)
            && getRewardForPlayer(resultingState, currentPlayer) === 1;
        if (didWinImmediately) {
            return action;
        }
    }

    return null;
}

function isGuaranteedWinningAttack(
    action: ResponseMessage,
    activeCreature: HandlerData['field']['creatures'][number][number],
    cardRepository: CardRepository,
    handlerData: HandlerData,
    controllers: Controllers,
    currentPlayer: number,
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
    const attackData = creatureData.attacks[attackIndex];

    if (containsCoinFlipOutcome(attackData)) {
        /*
         * Treat probabilistic attacks as non-guaranteed wins.
         * TODO: Support additional stochastic effects (e.g. random target damage)
         * where all outcomes still guarantee victory.
         */
        return false;
    }

    if (!isPossiblyLethalAttack(activeCreature, controllers, currentPlayer, attackIndex)) {
        return false;
    }

    // If attack resolution requires follow-up target/card selections, it is not immediate.
    return !handlerData.turnState.pendingSelection;
}

/*
 * Cheap pre-check using the REAL damage-resolution logic
 * (AttackDamageResolver.resolveDamage - the same function the engine uses
 * to actually apply attack damage, accounting for weakness and any active
 * damage-boost/reduction/prevention effects) against controllers the
 * caller already built, instead of constructing a separate driver just to
 * ask this. Only attacks that resolve to at least the target's remaining
 * HP proceed to the expensive applyActionAndResume simulation, which still
 * separately confirms the knockout actually ends the round (accounts for
 * remaining bench/points - this check only answers "would this knock out
 * the active creature").
 *
 * This runs once per legal attack on every decision point of every ISMCTS
 * rollout (up to maxMoves=50 per rollout, times hundreds of iterations per
 * move), so filtering out attacks that don't even deal lethal damage -
 * without paying for a second driver construction - is a large win.
 */
function isPossiblyLethalAttack(
    activeCreature: HandlerData['field']['creatures'][number][number],
    controllers: Controllers,
    currentPlayer: number,
    attackIndex: number,
): boolean {
    const opponentIndex = 1 - currentPlayer;
    const targetCreature = controllers.field.getCardByPosition(opponentIndex, 0);
    if (!targetCreature) {
        // Can't determine the target - let the full check decide.
        return true;
    }

    const targetData = controllers.cardRepository.getCreature(targetCreature.templateId);
    const remainingHp = targetData.maxHp - targetCreature.damageTaken;

    const attackerInstanceId = getCurrentInstanceId(activeCreature);
    const damage = AttackDamageResolver.resolveDamage(controllers, currentPlayer, attackIndex, attackerInstanceId);

    // Damage couldn't be resolved (e.g. attacker/attack not found) - don't
    // rule it out, let the full check decide.
    return damage === undefined || damage >= remainingHp;
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
