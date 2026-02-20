/**
 * Euchre Determinization
 * 
 * Expands hidden information in Euchre game states during ISMCTS simulation.
 * Uses trick history and card counts to accurately distribute remaining cards.
 * Tracks which cards each player has played in the current trick.
 */

import type { ControllerHandlerState, ControllerState } from '@cards-ts/core';
import { Suit, Card } from '@cards-ts/core';
import type { Controllers } from '@cards-ts/euchre/dist/controllers/controllers.js';
import type { Determinization } from '../../adapter-config.js';

type HandlerData = ControllerHandlerState<Controllers>;
type GameState = ControllerState<Controllers>;

export class EuchreDeterminization implements Determinization<Controllers> {
    /**
     * Determinize Euchre game state from player's perspective.
     * 
     * Algorithm:
     * 1. Create set of all possible Euchre cards (24 total: 9-A in 4 suits)
     * 2. Remove known cards:
     *    - Current player's hand
     *    - Cards played in current trick (with player index tracking via trick.leader and play order)
     * 3. Calculate exact cards remaining per player based on tricks played
     * 4. Randomly distribute remaining cards to other players
     * 
     * Key insight: From trick.leader and the round-robin play order, we know which player
     * played each card in the current trick. Player indices are:
     *   - Position 0: (trick.leader + 0) % 4
     *   - Position 1: (trick.leader + 1) % 4
     *   - Position 2: (trick.leader + 2) % 4
     *   - Position 3: (trick.leader + 3) % 4
     */
    determinize(handlerData: HandlerData): GameState {
        const currentPlayerIndex = handlerData.players.position;
        
        // Initialize all possible Euchre cards (9-A in each suit)
        const allCards = new Set<string>();
        for (const suit of Suit.suits) {
            for (const rank of [ '9', '10', 'J', 'Q', 'K', 'A' ]) {
                allCards.add(`${rank}${suit}`);
            }
        }
        
        const hands: Card[][] = [[], [], [], []];
        hands[currentPlayerIndex] = Array.isArray(handlerData.hand) ? [ ...handlerData.hand ] : [];
        
        // Remove current player's known cards
        for (const card of hands[currentPlayerIndex]) {
            const cardStr = `${card.rank}${card.suit}`;
            allCards.delete(cardStr);
        }
        
        // Track which players have played cards in the current trick
        const playersWhoPlayed = new Set<number>();
        const trick = handlerData.trick;
        let cardsInCurrentTrick = 0;
        
        if (trick?.currentTrick && Array.isArray(trick.currentTrick)) {
            const leader = trick.leader || 0;
            for (let i = 0; i < trick.currentTrick.length; i++) {
                const card = trick.currentTrick[i];
                if (card) {
                    const playerIndex = (leader + i) % 4;
                    playersWhoPlayed.add(playerIndex);
                    const cardStr = `${card.rank}${card.suit}`;
                    allCards.delete(cardStr);
                    cardsInCurrentTrick++;
                }
            }
        }
        
        // Calculate total cards played across all completed tricks
        const tricksCompleted = trick?.tricks || 0;
        const totalCardsPlayed = tricksCompleted * 4 + cardsInCurrentTrick;
        
        // Convert remaining cards to array and shuffle
        const remainingCards = Array.from(allCards);
        for (let i = remainingCards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ remainingCards[i], remainingCards[j] ] = [ remainingCards[j], remainingCards[i] ];
        }
        
        // Distribute remaining cards to other players based on how many they've played
        let cardIndex = 0;
        
        for (let i = 0; i < 4; i++) {
            if (i !== currentPlayerIndex) {
                /*
                 * Each player started with 5 cards
                 * They've played 1 per completed trick + possibly 1 in current trick
                 */
                const cardsPlayedByThisPlayer = tricksCompleted + (playersWhoPlayed.has(i) ? 1 : 0);
                const cardsRemainingForThisPlayer = 5 - cardsPlayedByThisPlayer;
                
                for (let j = 0; j < cardsRemainingForThisPlayer && cardIndex < remainingCards.length; j++) {
                    hands[i].push(Card.fromString(remainingCards[cardIndex++]));
                }
            }
        }
        
        return {
            ...(handlerData as unknown as GameState),
            hand: hands,
        };
    }
}
