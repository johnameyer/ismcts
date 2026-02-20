# Game Adapter Implementation Guide

This guide explains how to implement a new game adapter for the generified ISMCTS framework. The framework supports any card game by implementing the `GameAdapterConfig` interface.

## Overview

The ISMCTS framework is now game-agnostic. All game-specific logic is encapsulated in a `GameAdapterConfig` that defines four key functions:

1. **ActionsGenerator** - Generate candidate actions from game state
2. **DriverFactory** - Create game driver instances for validation
3. **GameEndDetector** - Determine if the game has ended
4. **RewardCalculator** - Calculate outcome scores from a player's perspective

## GameAdapterConfig Interface

```typescript
export interface GameAdapterConfig {
    /**
     * Game-specific action generation logic.
     * Generates candidate actions based on visible game state.
     */
    actionsGenerator: ActionsGenerator;

    /**
     * Game-specific driver factory for validation.
     * Creates a game driver to validate candidate actions.
     */
    driverFactory: DriverFactory;

    /**
     * Game-specific end condition detector.
     * Determines if the game has ended based on game rules.
     */
    isGameEnded: GameEndDetector;

    /**
     * Game-specific reward calculator.
     * Computes the outcome of a game from a player's perspective.
     */
    getRewardForPlayer: RewardCalculator;
}
```

## Implementation Steps

### Step 1: Create Your Game Adapter Directory and Files

Create a new directory like `src/adapters/your-game/` and files within it:
- `src/adapters/your-game/actions-generator.ts` - ActionsGenerator implementation
- `src/adapters/your-game/handler.ts` - Game handler (optional, for handler-based dispatch)
- `src/adapters/your-game/index.ts` - Export all adapter components

### Step 2: Implement ActionsGenerator

This is the interface that generates candidate actions:

```typescript
import { ActionsGenerator, ValidationDriver } from '../../game-adapter-config.js';
import { ResponseMessage } from '@your-game/dist/messages/response-message.js';
import { HandlerData } from '@your-game/dist/game-handler.js';

export class YourGameActionsGenerator implements ActionsGenerator {
    constructor(private cardRepository: CardRepository) {}

    generateCandidateActions(
        handlerData: HandlerData,
        currentPlayer: number,
        expectedResponseTypes: readonly (ResponseMessage['type'])[],
    ): ResponseMessage[] {
        // Implement your game's action generation logic
        // Return ALL possible candidate actions for the current player
        // The LegalActionsGenerator will validate and filter these
        
        const candidates: ResponseMessage[] = [];
        
        // Example: generate play actions, attack actions, end turn, etc.
        candidates.push(...this.generatePlayActions(handlerData, currentPlayer));
        candidates.push(...this.generateAttackActions(handlerData, currentPlayer));
        candidates.push(...this.generateSpecialActions(handlerData, currentPlayer));
        
        // Return only actions of expected types
        return candidates.filter(action => expectedResponseTypes.includes(action.type));
    }

    private generatePlayActions(handlerData: HandlerData, player: number): ResponseMessage[] {
        // Your game-specific play action generation
        return [];
    }

    private generateAttackActions(handlerData: HandlerData, player: number): ResponseMessage[] {
        // Your game-specific attack action generation
        return [];
    }

    private generateSpecialActions(handlerData: HandlerData, player: number): ResponseMessage[] {
        // Any other game-specific actions
        return [];
    }
}
```

### Step 3: Implement DriverFactory

The driver factory creates game driver instances for validation:

```typescript
export type DriverFactory = (
    gameState: ControllerState<Controllers>,
    playerNames: string[],
) => ValidationDriver;

export function createYourGameDriverFactory(
    cardRepository: CardRepository,
): DriverFactory {
    return (gameState: ControllerState<Controllers>, playerNames: string[]) => {
        // Instantiate your game driver with the given state
        // The driver needs to support validation of actions
        
        const driver = yourGameFactory(cardRepository).create(gameState, playerNames);
        
        return {
            getValidationError(playerIndex: number, message: ResponseMessage) {
                // Return undefined if action is valid, otherwise return error details
                return driver.getValidationError(playerIndex, message);
            }
        };
    };
}
```

**Important:** The driver must implement `getValidationError()` - it should return `undefined` for valid actions and an error object/string for invalid actions.

### Step 4: Implement GameEndDetector

The end detector determines if the game has concluded:

```typescript
export type GameEndDetector = (gameState: GameState | HandlerData) => boolean;

export function createYourGameGameEndDetector(): GameEndDetector {
    return (gameState: GameState | HandlerData) => {
        // Implement your game's end condition logic
        // Return true if the game has ended, false otherwise
        
        // Example for a trick-taking game:
        if (gameState.roundsPlayed >= gameState.maxRounds) {
            return true;
        }
        
        // Example for an elimination game:
        if (gameState.players.some(p => p.health <= 0)) {
            return true;
        }
        
        return false;
    };
}
```

**Important Considerations:**
- This should check the actual game state, not just player perspective
- Must work with both `GameState` (full) and `HandlerData` (player view)
- Should check all end conditions your game supports (points, elimination, rounds, etc.)

### Step 5: Implement RewardCalculator

The reward calculator computes game outcomes:

```typescript
export type RewardCalculator = (gameState: GameState | HandlerData, playerIndex: number) => number;

export function createYourGameRewardCalculator(): RewardCalculator {
    return (gameState: GameState | HandlerData, playerIndex: number) => {
        // Return:
        // - 1.0 for a win from this player's perspective
        // - 0.5 for draw/incomplete/timeout
        // - 0.0 for a loss from this player's perspective
        
        // Example for a points-based game:
        if (gameState.points[playerIndex] > gameState.points[1 - playerIndex]) {
            return 1.0;
        } else if (gameState.points[playerIndex] < gameState.points[1 - playerIndex]) {
            return 0.0;
        } else {
            return 0.5;
        }
    };
}
```

**Important Considerations:**
- Always evaluate from the given `playerIndex` perspective
- A win for player 0 is 1.0, loss is 0.0
- For player 1, a win is still 1.0, loss is 0.0 (perspective-relative)
- Use 0.5 for incomplete/draw states or when the algorithm times out mid-simulation

### Step 6: Export All Factory Functions

At the end of your adapter file:

```typescript
export const YourGameAdapterConfig = {
    actionsGenerator: new YourGameActionsGenerator(cardRepository),
    driverFactory: createYourGameDriverFactory(cardRepository),
    isGameEnded: createYourGameGameEndDetector(),
    getRewardForPlayer: createYourGameRewardCalculator(),
};
```

## Step 7: Integrate into Your Game Handler

In your game handler file (e.g., `src/handlers/your-game-bot-handler.ts`):

```typescript
import { GameAdapterConfig } from '../../game-adapter-config.js';
import { 
    YourGameActionsGenerator, 
    createYourGameDriverFactory, 
    createYourGameGameEndDetector, 
    createYourGameRewardCalculator 
} from '../../adapters/your-game/actions-generator.js';

export class YourGameBotHandler extends GameHandler {
    constructor(cardRepository: CardRepository) {
        super();
        
        const gameAdapterConfig: GameAdapterConfig = {
            actionsGenerator: new YourGameActionsGenerator(cardRepository),
            driverFactory: createYourGameDriverFactory(cardRepository),
            isGameEnded: createYourGameGameEndDetector(),
            getRewardForPlayer: createYourGameRewardCalculator(),
        };
        
        this.ismcts = new ISMCTSModular(
            cardRepository,
            gameAdapterConfig,
            ismctsConfig,
        );
    }
}
```

## Testing Your Adapter

Create tests to verify each component:

```typescript
describe('Your Game Adapter', () => {
    describe('ActionsGenerator', () => {
        it('should generate valid candidate actions', () => {
            const generator = new YourGameActionsGenerator(cardRepository);
            const handlerData = createGameStateForTest();
            const actions = generator.generateCandidateActions(
                handlerData,
                0,
                ['your-response-type'],
            );
            
            expect(actions).to.be.an('array');
            expect(actions.length).to.be.greaterThan(0);
        });
    });
    
    describe('GameEndDetector', () => {
        it('should detect game end correctly', () => {
            const endDetector = createYourGameGameEndDetector();
            const winState = createWinStateForTest();
            
            expect(endDetector(winState)).to.be.true;
        });
    });
    
    describe('RewardCalculator', () => {
        it('should return 1.0 for player win', () => {
            const rewardCalc = createYourGameRewardCalculator();
            const winState = createWinStateForPlayer0();
            
            expect(rewardCalc(winState, 0)).to.equal(1.0);
            expect(rewardCalc(winState, 1)).to.equal(0.0);
        });
    });
});
```

## Common Patterns

### Round-Based Games (Euchre, Bid Whist)

For games that have rounds rather than complete games:

```typescript
export function createEuchreGameEndDetector(): GameEndDetector {
    return (gameState) => {
        // End of round (trick all played)
        if (gameState.trickCount >= 5) {
            return true;
        }
        
        // End of game (someone reached required points)
        if (gameState.score[0] >= GAME_WINNING_POINTS || 
            gameState.score[1] >= GAME_WINNING_POINTS) {
            return true;
        }
        
        return false;
    };
}
```

### Multi-Player Games

The framework currently uses `playerIndex` (0, 1) for 2-player games. For multi-player games, you may need to:

1. Adapt the reward calculator to handle multiple perspectives
2. Modify the MCTS tree structure if needed
3. Update the game adapter config if additional metadata is needed

### Games with Hidden Information

The framework supports determinization through `ISMCTSDeterminization`. If implementing a game with hidden information:

1. Implement opponent deck inference in your adapter
2. Seed random playouts with determinized states
3. See `ismcts-determinization.ts` for the determinization interface

## Debugging Tips

1. **Use logging**: Add console logs to your adapter functions to verify they're being called correctly
2. **Test in isolation**: Unit test each adapter function separately before integration
3. **Validate driver integration**: Ensure `getValidationError()` returns correct values
4. **Check state types**: Ensure your adapter handles both `GameState` and `HandlerData` correctly
5. **Verify rewards**: Test that reward calculation matches your game's actual win conditions

## Architecture Notes

- **Dependency Injection**: All game-specific dependencies are injected into `ISMCTSModular`
- **Pure Functions**: Driver factory and end detector should be pure (no side effects)
- **Stateless**: Reward calculator should compute rewards deterministically from state alone
- **Validation**: LegalActionsGenerator will validate all candidates from ActionsGenerator
- **Performance**: Keep action generation efficient - it's called frequently during search

## Future Extensions

The architecture supports additional game-specific callbacks as needed. Common candidates:

- `HeuristicEvaluator` - Position evaluation for non-terminal states
- `MetaDeckProvider` - Pre-defined decks for determinization
- `StateNormalizer` - Canonical state representation for tree caching
- `ActionPrioritizer` - Heuristic move ordering for better alpha-beta pruning

These can be added to `GameAdapterConfig` when needed without breaking existing code.
