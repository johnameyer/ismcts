import type { CardRepository } from '@cards-ts/pocket-tcg/dist/repository/card-repository.js';
import type { HandlerData } from '@cards-ts/pocket-tcg/dist/game-handler.js';
import type { GameCard } from '@cards-ts/pocket-tcg/dist/controllers/card-types.js';
import type { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { ControllerState } from '@cards-ts/core';
import { getCurrentTemplateId } from '@cards-ts/pocket-tcg/dist/utils/field-card-utils.js';
import { FieldCard } from '@cards-ts/pocket-tcg/dist/controllers/field-controller.js';
import { Determinization } from '../../adapter-config.js';

/**
 * Pocket-TCG specific implementation of Determinization
 * Determinizes opponent deck and hand based on visible cards and meta patterns
 */
export class PocketTCGDeterminization implements Determinization<Controllers> {
    private metaDecks: Record<string, Record<string, number>>;

    constructor(private cardRepository: CardRepository, metaDecks?: Record<string, Record<string, number>>) {
        this.metaDecks = metaDecks || {};
    }

    /**
     * Create a full, playable game state from Pocket-TCG HandlerData.
     * Infers opponent deck composition from visible cards.
     */
    public determinize(handlerData: HandlerData, ourPlayerIndex: number = 0): ControllerState<Controllers> {
        
        // Determinize both deck and hand for each player
        // For ourselves: just shuffle our known cards (we know our hand)
        const ourCards = this.determinizeOurCards(handlerData, ourPlayerIndex);
        
        // For the opponent: determinize what's in their hand vs deck (we don't know their hand)
        const opponentIndex = 1 - ourPlayerIndex;
        const opponentCards = this.determinizeOpponentCards(handlerData, opponentIndex);
        
        const player0Cards = ourPlayerIndex === 0 ? ourCards : opponentCards;
        const player1Cards = ourPlayerIndex === 1 ? ourCards : opponentCards;
        
        /*
         * Infer the state machine state from HandlerData
         * HandlerData only exists during action phase, so if we have HandlerData, we're in action loop.
         * Use ACTIONLOOP_IF_NOT_CHECKPENDINGSELECTIONS as it's the root action loop state that
         * the state machine uses to decide whether to go to ACTION_ACTION or handle pending selections.
         * This allows resume() to properly transition through the state machine.
         */
        const inferredState: string = 'ACTIONLOOP_IF_NOT_CHECKPENDINGSELECTIONS';
        
        /*
         * Return new state with determinized decks and hands, preserving all other properties
         * CRITICAL: GameState.hand should be GameCard[][] (array for each player),
         * but HandlerData.hand is the current player's hand (single array).
         * We need to maintain the GameCard[][] structure for the full game state.
         */
        
        const result = {
            ...handlerData,
            state: inferredState,
            deck: [ player0Cards.deck, player1Cards.deck ],
            hand: [ player0Cards.hand, player1Cards.hand ], // Maintain GameCard[][] structure
            players: undefined,
            data: [] as unknown,
        } as ControllerState<Controllers>;

        return result;
    }

    /**
     * Determinizes our cards (we know our hand, just shuffle remaining deck)
     */
    private determinizeOurCards(handlerData: HandlerData, playerIndex: number): { deck: GameCard[], hand: GameCard[] } {
        const currentHand = handlerData.hand; // This is our hand (single array)
        
        // For ourselves, we know exactly what's in our hand
        const hand = currentHand.map((card, index) => this.createGameCard(card.templateId, `hand-${playerIndex}-${index}`),
        ).filter((card): card is GameCard => card !== null);
        
        
        // For deck, exclude our known hand cards from seen cards calculation
        const seenCardsExcludingHand = this.getSeenCardsExcludingHand(handlerData, playerIndex);
        const handCardIds = currentHand.map((card) => card.templateId);
        const allSeenCards = [ ...seenCardsExcludingHand, ...handCardIds ];
        
        const remainingCards = this.inferRemainingCards(allSeenCards);
        const shuffledDeck = this.shuffleArray([ ...remainingCards ]);
        
        const deck = shuffledDeck.map((templateId, index) => this.createGameCard(templateId, `deck-${playerIndex}-${index}`),
        ).filter((card): card is GameCard => card !== null);
        
        return { hand, deck };
    }

    /**
     * Gets seen cards excluding hand (for calculating remaining deck cards)
     */
    private getSeenCardsExcludingHand(handlerData: HandlerData, playerIndex: number): string[] {
        const seenCards: string[] = [];
        
        // Add cards from field (creatures in play)
        const fieldCreatures = handlerData.field?.creatures?.[playerIndex] || [];
        fieldCreatures.forEach((card) => {
            if (card) {
                seenCards.push(getCurrentTemplateId(card)); 
            }
        });
        
        // Add cards from discard pile
        const discardPile = handlerData.discard?.[playerIndex] || [];
        discardPile.forEach((card) => {
            if (card?.templateId) {
                seenCards.push(card.templateId); 
            }
        });
        
        return seenCards;
    }

    /**
     * Determinizes opponent cards (we don't know their hand contents, only count)
     */
    private determinizeOpponentCards(handlerData: HandlerData, playerIndex: number): { deck: GameCard[], hand: GameCard[] } {
        /*
         * We don't know the opponent's hand contents, only that they have some number of cards
         * We need to get the opponent's hand size from somewhere else (not handlerData.hand which is our hand)
         * For now, assume opponent has same hand size as us (this is wrong but will fix the immediate bug)
         */
        const ourHandSize = handlerData.hand.length;
        const handSize = ourHandSize; // TODO: Get actual opponent hand size from game state
        
        // Get all possible cards that could be in opponent's hand/deck
        const seenCards = this.getSeenCards(handlerData, playerIndex);
        
        // Try smart determinization based on energy attachments if we have seen creatures
        const smartCards = this.inferSmartOpponentCards(handlerData, playerIndex, seenCards);
        const possibleCards = smartCards.length > 0 ? smartCards : this.inferRemainingCards(seenCards);
        const shuffledCards = this.shuffleArray([ ...possibleCards ]);
        
        // Split randomly between hand and deck based on known hand size
        const handCards = shuffledCards.slice(0, handSize);
        const deckCards = shuffledCards.slice(handSize);
        
        const hand = handCards.map((templateId, index) => this.createGameCard(templateId, `hand-${playerIndex}-${index}`),
        ).filter((card): card is GameCard => card !== null);
        
        const deck = deckCards.map((templateId, index) => this.createGameCard(templateId, `deck-${playerIndex}-${index}`),
        ).filter((card): card is GameCard => card !== null);
        
        return { hand, deck };
    }

    /**
     * Creates a GameCard object from template ID, returns null if card doesn't exist
     */
    private createGameCard(templateId: string, instanceId: string): GameCard | null {
        try {
            // Determine correct card type from repository
            const { type } = this.cardRepository.getCard(templateId);
            
            return {
                instanceId,
                type: type as 'creature' | 'supporter' | 'item' | 'tool',
                templateId,
            } as GameCard;
        } catch (error) {
            // Card doesn't exist in repository, skip it
            console.warn(`[DETERMINIZATION] Skipping unknown card: ${templateId}`);
            return null;
        }
    }

    /**
     * Gets all cards seen for a player (played + discarded + in hand for ourselves)
     */
    public getSeenCards(handlerData: HandlerData, playerIndex: number): string[] {
        const seenCards: string[] = [];
        
        // Add cards from field (creatures in play)
        const fieldCreatures = handlerData.field?.creatures?.[playerIndex] || [];
        fieldCreatures.forEach(card => {
            if (card) {
                seenCards.push(getCurrentTemplateId(card)); 
            }
        });
        
        // Add cards from discard pile
        const discardPile = handlerData.discard?.[playerIndex] || [];
        discardPile.forEach(card => {
            if (card?.templateId) {
                seenCards.push(card.templateId); 
            }
        });
        
        // Only add hand cards if this is our own player (handlerData.players.position)
        if (playerIndex === handlerData.players.position) {
            const currentHand = handlerData.hand || [];
            currentHand.forEach(card => {
                if (card?.templateId) {
                    seenCards.push(card.templateId); 
                }
            });
        }
        
        return seenCards;
    }

    /**
     * Infers what cards could still be in the deck
     */
    public inferRemainingCards(seenCards: string[]): string[] {
        // Use meta inference if we have few observations, otherwise use seen-based calculation
        if (seenCards.length < 3) {
            return this.inferFromMeta(seenCards);
        } 
        return this.calculateRemainingFromSeen(seenCards);
        
    }

    /**
     * Calculates remaining cards based on 2-card deck limit
     */
    public calculateRemainingFromSeen(seenCards: string[]): string[] {
        const cardCounts = new Map<string, number>();
        
        // Count seen cards
        for (const cardId of seenCards) {
            cardCounts.set(cardId, (cardCounts.get(cardId) || 0) + 1);
        }
        
        // Standard deck has 2 of each card, infer remaining
        const remaining: string[] = [];
        for (const [ cardId, seenCount ] of Array.from(cardCounts)) {
            const remainingCount = Math.max(0, 2 - seenCount);
            for (let i = 0; i < remainingCount; i++) {
                remaining.push(cardId);
            }
        }
        
        return remaining;
    }

    /**
     * Infers cards from meta deck patterns
     */
    public inferFromMeta(seenCards: string[]): string[] {
        const matchingDeck = this.findBestMetaMatch(seenCards);
        if (!matchingDeck) {
            return []; 
        }
        
        const inferred: string[] = [];
        for (const [ cardId, count ] of Object.entries(matchingDeck)) {
            const seenCount = seenCards.filter(c => c === cardId).length;
            const remaining = Math.max(0, count - seenCount);
            for (let i = 0; i < remaining; i++) {
                inferred.push(cardId);
            }
        }
        return inferred;
    }

    /**
     * Finds the best matching meta deck based on seen cards
     */
    public findBestMetaMatch(seenCards: string[]): Record<string, number> | null {
        let bestMatch: Record<string, number> | null = null;
        let bestScore = 0;
        
        for (const [ deckName, deckCards ] of Object.entries(this.metaDecks)) {
            let matches = 0;
            for (const cardId of seenCards) {
                if (deckCards[cardId]) {
                    matches++; 
                }
            }
            
            if (matches > bestScore) {
                bestScore = matches;
                bestMatch = deckCards;
            }
        }
        
        return bestScore > 0 ? bestMatch : null;
    }

    /**
     * Shuffles array in place and returns it
     */
    public shuffleArray<T>(array: T[]): T[] {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ array[i], array[j] ] = [ array[j], array[i] ];
        }
        return array;
    }

    /**
     * Smart inference of opponent cards based on energy attachments and creature types
     * Selects 1-2 evolution chains and up to 2 creatures of matching energy types,
     * then fills with trainers/items
     */
    private inferSmartOpponentCards(handlerData: HandlerData, playerIndex: number, seenCards: string[]): string[] {
        const fieldCreatures = handlerData.field?.creatures?.[playerIndex] || [];
        
        // Need at least some visible creatures to make smart decisions
        if (fieldCreatures.length === 0) {
            return [];
        }
        
        const selectedCards: string[] = [];
        const usedCardIds = new Set<string>();
        
        // Extract energy types attached to opponent's creatures
        const energyTypes = this.getOpponentAttachedEnergyTypes(handlerData, playerIndex);
        
        // Select evolution chains
        const evolutionChains = this.selectEvolutionChains(fieldCreatures as unknown as FieldCard[], seenCards);
        for (const chainId of evolutionChains) {
            selectedCards.push(chainId);
            usedCardIds.add(chainId);
        }
        
        // Select creatures matching the energy types they're using
        for (const energyType of energyTypes) {
            const creaturesForType = this.selectCreaturesForEnergyType(energyType, seenCards, usedCardIds, fieldCreatures as unknown as FieldCard[], 2);
            selectedCards.push(...creaturesForType);
            creaturesForType.forEach(id => usedCardIds.add(id));
        }
        
        // Fill remaining deck with trainers, items, supporters
        const totalNeeded = 60; // Standard deck size
        if (selectedCards.length < totalNeeded) {
            const trainers = this.getAllTrainerItemCards(seenCards, usedCardIds);
            const remaining = totalNeeded - selectedCards.length;
            
            // Add trainers/items to fill the deck
            for (let i = 0; i < remaining && i < trainers.length; i++) {
                selectedCards.push(trainers[i]);
            }
        }
        
        // Apply 2-card deck limit
        return this.enforceCardLimits(selectedCards);
    }

    /**
     * Extracts energy types attached to opponent's creatures
     */
    private getOpponentAttachedEnergyTypes(handlerData: HandlerData, playerIndex: number): string[] {
        const energyTypes = new Set<string>();
        const fieldCreatures = handlerData.field?.creatures?.[playerIndex] || [];
        
        for (const fieldCard of fieldCreatures) {
            if (!fieldCard) {
                continue; 
            }
            
            /*
             * TODO: Extract energy types from field card
             * This requires access to energy controller data which may not be in HandlerData
             * For now, we infer from creature types and use a heuristic
             */
        }
        
        return Array.from(energyTypes);
    }

    /**
     * Selects 1-2 evolution chains from visible creatures, prioritizing by HP + attack strength
     */
    private selectEvolutionChains(fieldCreatures: FieldCard[], seenCards: string[]): string[] {
        const selectedChains: string[] = [];
        const chainHeads = new Map<string, { score: number; templateId: string }>();
        
        // Score creatures by HP + total attack damage
        for (const creature of fieldCreatures) {
            if (!creature) {
                continue; 
            }
            
            const creatureId = getCurrentTemplateId(creature);
            try {
                const cardData = this.cardRepository.getCard(creatureId);
                
                // Only consider creature cards
                if (cardData.type !== 'creature' || !('maxHp' in cardData)) {
                    continue;
                }
                
                const creatureData = cardData;
                const hpScore = (creatureData as Record<string, unknown>).maxHp as number || 0;
                const attacks = (creatureData as Record<string, unknown>).attacks || [];
                let attackScore = 0;
                for (const attack of attacks as unknown[]) {
                    const damage = typeof (attack as Record<string, unknown>).damage === 'number' ? (attack as Record<string, unknown>).damage : 0;
                    attackScore += (damage as number);
                }
                
                const score = (hpScore as number) + attackScore;
                
                // Track this creature as a potential chain head
                if (!chainHeads.has(creatureId) || chainHeads.get(creatureId)!.score < score) {
                    chainHeads.set(creatureId, { score, templateId: creatureId });
                }
            } catch (error) {
                // Skip if card not found
                continue;
            }
        }
        
        // Sort by score and pick top 1-2
        const sortedChains = Array.from(chainHeads.values()).sort((a, b) => b.score - a.score);
        
        // Randomize slightly: pick 1-2 chains with bias towards higher scores
        const chainCount = Math.random() < 0.5 ? 1 : 2;
        for (let i = 0; i < Math.min(chainCount, sortedChains.length); i++) {
            const chain = sortedChains[i];
            selectedChains.push(chain.templateId);
        }
        
        return selectedChains;
    }

    /**
     * Selects up to maxCount creatures matching a specific energy type
     */
    private selectCreaturesForEnergyType(
        energyType: string,
        seenCards: string[],
        usedIds: Set<string>,
        fieldCreatures: FieldCard[],
        maxCount: number,
    ): string[] {
        const selected: string[] = [];
        const candidates: { score: number; templateId: string }[] = [];
        
        // Get all creatures of this type by scanning all creatures for matching type
        // (getCreaturesOfType not available in CardRepository, so we scan all creatures)
        const creaturesOfType = new Set<string>();
        for (const creatureId of this.cardRepository.getAllCreatureIds()) {
            try {
                const creature = this.cardRepository.getCreature(creatureId);
                if ((creature as Record<string, unknown>).type === energyType) {
                    creaturesOfType.add(creatureId);
                }
            } catch {
                // Skip creatures that can't be loaded
            }
        }
        const seenCreaturesOfType = new Set(seenCards.filter(id => creaturesOfType.has(id)));
        
        // Get all available creatures of this type that aren't already selected
        for (const creatureId of seenCreaturesOfType) {
            if (usedIds.has(creatureId)) {
                continue; 
            }
            
            try {
                const cardData = this.cardRepository.getCreature(creatureId);
                const hpScore = cardData.maxHp || 0;
                 
                const attackScore = (cardData.attacks || []).reduce((sum, attack) => {
                    const damage = typeof attack.damage === 'number' ? attack.damage : 0;
                    return sum + damage;
                }, 0);
                
                candidates.push({
                    score: hpScore + attackScore,
                    templateId: creatureId,
                });
            } catch (error) {
                // Skip if card not found
                continue;
            }
        }
        
        // Sort by score (descending) and take top maxCount
        candidates.sort((a, b) => b.score - a.score);
        for (let i = 0; i < Math.min(maxCount, candidates.length); i++) {
            selected.push(candidates[i].templateId);
        }
        
        return selected;
    }

    /**
     * Gets all trainer/item/supporter cards available, excluding those already used
     */
    private getAllTrainerItemCards(seenCards: string[], usedIds: Set<string>): string[] {
        const trainers: string[] = [];
        
        for (const cardId of new Set(seenCards)) {
            if (usedIds.has(cardId)) {
                continue; 
            }
            
            try {
                const cardData = this.cardRepository.getCard(cardId);
                if ([ 'item', 'supporter', 'tool' ].includes(cardData.type)) {
                    trainers.push(cardId);
                }
            } catch (error) {
                // Skip if card not found
                continue;
            }
        }
        
        return trainers;
    }

    /**
     * Enforces the 2-card deck limit for Pocket TCG
     */
    private enforceCardLimits(cards: string[]): string[] {
        const counts = new Map<string, number>();
        const result: string[] = [];
        
        for (const cardId of cards) {
            const current = counts.get(cardId) || 0;
            if (current < 2) {
                result.push(cardId);
                counts.set(cardId, current + 1);
            }
        }
        
        return result;
    }
}
