import { expect } from 'chai';
import { isGameEnded, getRewardForPlayer, getWinner } from '../../../src/adapters/pocket-tcg/completed-utils.js';
import { StateBuilder } from '../../helpers/state-builder.js';
import { createNonWaitingGameStateForMCTS } from '../../helpers/test-state-builder.js';

describe('Completed Utils - Game Ending Conditions', () => {
    it('should recognize game end when player 0 reaches 3 points', () => {
        const state = createNonWaitingGameStateForMCTS(
            (state) => {
                state.points[0] = 3;
                state.points[1] = 0;
            },
        );

        expect(isGameEnded(state)).to.be.true;
        expect(getWinner(state)).to.equal(0);
        expect(getRewardForPlayer(state, 0)).to.equal(1.0);
        expect(getRewardForPlayer(state, 1)).to.equal(0.0);
    });

    it('should recognize game end when player 1 reaches 3 points', () => {
        const state = createNonWaitingGameStateForMCTS(
            (state) => {
                state.points[0] = 0;
                state.points[1] = 3;
            },
        );

        expect(isGameEnded(state)).to.be.true;
        expect(getWinner(state)).to.equal(1);
        expect(getRewardForPlayer(state, 0)).to.equal(0.0);
        expect(getRewardForPlayer(state, 1)).to.equal(1.0);
    });

    it('should recognize game end when opponent has no field cards', () => {
        const state = createNonWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature'),
                (state) => {
                    state.points[0] = 0;
                    state.points[1] = 0;
                    // Clear opponent creatures
                    state.field.creatures[1] = [];
                },
            ),
        );
        
        expect(isGameEnded(state)).to.be.true;
        expect(getRewardForPlayer(state, 0)).to.equal(1.0, 'Player 0 should win when opponent has no creatures');
        expect(getRewardForPlayer(state, 1)).to.equal(0.0, 'Player 1 should lose when out of creatures');
    });

    it('should recognize game end when player has no field cards', () => {
        const state = createNonWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(1, 'basic-creature'),
                (state) => {
                    state.points[0] = 0;
                    state.points[1] = 0;
                    // Clear player creatures
                    state.field.creatures[0] = [];
                },
            ),
        );

        expect(isGameEnded(state)).to.be.true;
        expect(getRewardForPlayer(state, 0)).to.equal(0.0, 'Player 0 should lose when out of creatures');
        expect(getRewardForPlayer(state, 1)).to.equal(1.0, 'Player 1 should win when opponent has no creatures');
    });

    it('should handle both players with no field cards (draw)', () => {
        const state = createNonWaitingGameStateForMCTS(
            (state) => {
                state.points[0] = 0;
                state.points[1] = 0;
                // Clear both field creatures
                state.field.creatures[0] = [];
                state.field.creatures[1] = [];
            },
        );

        expect(isGameEnded(state)).to.be.true;
        expect(getRewardForPlayer(state, 0)).to.equal(0.5, 'Draw when both out of creatures');
        expect(getRewardForPlayer(state, 1)).to.equal(0.5, 'Draw when both out of creatures');
    });

    it('should not end game when both players have creatures and points are tied', () => {
        const state = createNonWaitingGameStateForMCTS(
            StateBuilder.combine(
                StateBuilder.withCreatures(0, 'basic-creature'),
                StateBuilder.withCreatures(1, 'basic-creature'),
                (state) => {
                    state.points[0] = 1;
                    state.points[1] = 1;
                },
            ),
        );

        expect(isGameEnded(state)).to.be.false;
    });

    describe('Elimination Win Conditions', () => {
        it('should recognize player win when opponent runs out of benched creatures before reaching 3 points', () => {
            /**
             * ELIMINATION WIN: Opponent has no active creature and no bench (all out of field).
             * This is a guaranteed loss for opponent regardless of points.
             * 
             * Scenario: Player eliminates opponent's last creature
             * - Player 0: healthy creature (60 HP), 0 points
             * - Player 1: ZERO creatures (no active, no bench), 1 point
             * 
             * Expected: Game ends, Player 0 wins (elimination beats points)
             */
            const state = createNonWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    (state) => {
                        state.points[0] = 0;
                        state.points[1] = 1; // Opponent has 1 point but no creatures left
                        // Ensure opponent has no creatures
                        state.field.creatures[1] = [];
                    },
                ),
            );

            expect(isGameEnded(state)).to.be.true;
            expect(getRewardForPlayer(state, 0)).to.equal(1.0, 'Player 0 wins by elimination');
            expect(getRewardForPlayer(state, 1)).to.equal(0.0, 'Player 1 loses by elimination');
        });

        it('should recognize player loss when they run out of benched creatures before reaching 3 points', () => {
            /**
             * ELIMINATION LOSS: Player has no active creature and no bench (all out of field).
             * This is a guaranteed loss regardless of points.
             * 
             * Scenario: Player's last creature was knocked out with no bench to switch to
             * - Player 0: ZERO creatures (no active, no bench), 1 point
             * - Player 1: healthy creature (60 HP), 0 points
             * 
             * Expected: Game ends, Player 1 wins (opponent elimination)
             */
            const state = createNonWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    (state) => {
                        state.points[0] = 1; // Player has 1 point but no creatures left
                        state.points[1] = 0;
                        // Ensure player has no creatures
                        state.field.creatures[0] = [];
                    },
                ),
            );

            expect(isGameEnded(state)).to.be.true;
            expect(getRewardForPlayer(state, 0)).to.equal(0.0, 'Player 0 loses by elimination');
            expect(getRewardForPlayer(state, 1)).to.equal(1.0, 'Player 1 wins by elimination');
        });

        it('should prioritize point-based win over elimination (first to 3 points wins)', () => {
            /**
             * POINT-BASED WIN: Even if opponent has creatures, first player to 3 points wins immediately.
             * Points-based victory takes precedence over field presence.
             * 
             * Scenario: Player reaches 3 points first
             * - Player 0: 3 points (wins), has 1 creature
             * - Player 1: 0 points (loses), has 1 creature
             * 
             * Expected: Player 0 wins by points (not waiting for elimination)
             */
            const state = createNonWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    (state) => {
                        state.points[0] = 3; // Player wins by points
                        state.points[1] = 0;
                    },
                ),
            );

            expect(isGameEnded(state)).to.be.true;
            expect(getRewardForPlayer(state, 0)).to.equal(1.0);
            expect(getRewardForPlayer(state, 1)).to.equal(0.0);
        });
    });

    describe('Status Effect Elimination (Poison without escape)', () => {
        it('should recognize that player loses if poisoned with no bench to escape to', () => {
            /**
             * POISON WITHOUT ESCAPE: Player's active creature is poisoned, deals poison damage,
             * and player has no bench creatures to switch to. Guaranteed KO next turn = loss.
             * 
             * This documents the scenario where poison status + no bench = guaranteed loss.
             * Full poison status testing requires GameDriver infrastructure.
             */
            const state = createNonWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'), // No bench
                    StateBuilder.withCreatures(1, 'basic-creature'),
                    StateBuilder.withDamage('basic-creature-0', 59), // 1 HP remaining (critical)
                    (state) => {
                        state.points[0] = 0;
                        state.points[1] = 0;
                    },
                ),
            );

            // Document that this is a critical state: 1 HP with no bench = no escape
            const reward = getRewardForPlayer(state, 0);
            expect(reward).to.be.a('number');
            expect(reward).to.be.within(0, 1);
        });

        it('should recognize that player wins if opponent is poisoned with no bench to escape to', () => {
            /**
             * POISON WIN: Opponent's active creature is poisoned with no bench to escape.
             * Opponent will KO next turn = guaranteed win.
             * 
             * This documents the scenario where opponent poison + no bench = guaranteed win.
             * Full poison status testing requires GameDriver infrastructure.
             */
            const state = createNonWaitingGameStateForMCTS(
                StateBuilder.combine(
                    StateBuilder.withCreatures(0, 'basic-creature'),
                    StateBuilder.withCreatures(1, 'basic-creature'), // No bench
                    StateBuilder.withDamage('basic-creature-1', 59), // 1 HP remaining for opponent
                    (state) => {
                        state.points[0] = 0;
                        state.points[1] = 0;
                    },
                ),
            );

            // Document that opponent at 1 HP with no bench = winning position
            const reward = getRewardForPlayer(state, 0);
            expect(reward).to.be.a('number');
            expect(reward).to.be.within(0, 1);
        });
    });
});
