# ISMCTS Test Suite

Comprehensive automated test coverage for the Information Set Monte Carlo Tree Search implementation.

## Test Organization

```
spec/
├── integration/                 # Full game flow tests
│   ├── full-game-completion.spec.ts  # Complete game playthrough
│   └── ...                           # Other integration tests
├── unit/                        # Component unit tests
│   ├── legal-actions-generator.spec.ts  # Action generation tests
│   └── ...                              # Other unit tests
├── helpers/                     # Shared test utilities
│   ├── game-test-helpers.ts     # Game execution utilities
│   ├── game-outcome-validator.ts # Outcome verification
│   ├── event-capturing-strategy.ts # Event logging for tests
│   └── ...                          # Other helpers
└── README.md                    # This file
```

## Test Categories

### Integration Tests (spec/integration/)

**Full game flow with real game drivers**
- `full-game-completion.spec.ts` - Bot vs bot complete game validation

Tests validate:
- ✅ No tie games (both players ending at 0 points)
- ✅ Manual event validation/merging
- ✅ Turn structure (end-turn < 50% of events)
- ✅ Legal action generation consistency

### Unit Tests (spec/unit/)

**Component-level testing with isolated dependencies**
- `legal-actions-generator.spec.ts` - Action generation and validation

Tests validate:
- ✅ Creature play generation
- ✅ Evolution generation
- ✅ Attack generation
- ✅ Energy attachment
- ✅ Ability usage

### Test Helpers (spec/helpers/)

Shared utilities used by all test categories:
- `game-test-helpers.ts` - Execute games with bots, capture state
- `game-outcome-validator.ts` - Verify game results (points, outcomes)
- `event-capturing-strategy.ts` - Wrap decision strategy to log events

## Key Test Scenarios

### Algorithm Correctness

- ✅ Legal action generation in various game states
- ✅ State mutation prevention (deep copying)
- ✅ Game state simulation to completion
- ✅ Action validation per game rules

### Strategic Decision Making

- ✅ Action selection varies based on game state
- ✅ Bots prefer beneficial actions over random ones
- ✅ Multiple bots produce different games
- ✅ Games complete without errors

### Game Integration

- ✅ Full bot vs bot games complete
- ✅ Turn sequences are valid
- ✅ Game points are calculated correctly
- ✅ Games end in determined states (not ties)

## Running Tests

### Run All Tests

```bash
cd ismcts && pnpm test
```

### Run Specific Test Files

```bash
# Integration tests
pnpm test -- spec/integration/full-game-completion.spec.ts

# Unit tests
pnpm test -- spec/unit/legal-actions-generator.spec.ts
```

### Run by Pattern

```bash
# All tests with "game" in the name
pnpm test -- --grep "game"

# All integration tests
pnpm test -- --grep "integration" --recursive spec/
```

### Watch Mode

```bash
pnpm test -- --watch
```

## Test Execution Flow

### Integration Test: Full Game Completion

1. Create game state with two test decks
2. Create two ISMCTS bot handlers (one per player)
3. Wrap handlers with `EventCapturingStrategy` to log events
4. Run game until completion
5. Validate outcomes:
   - Neither player at 0 points (no ties)
   - Events were captured and can be validated
   - Turn ratios are reasonable
   - Actions generated match expectations

### Unit Test: Legal Actions Generator

1. Create game state with known player hand/board
2. Generate legal actions
3. Validate each action:
   - Action type is as expected
   - Action targets are valid
   - Action is in `expectedResponseTypes` if specified
   - Action passes game driver validation

## Test Helpers API

### game-test-helpers.ts

```typescript
// Run a complete game between two bots
const { events, gameOutcome } = await runGameWithBots(
  deck1, deck2, 
  { iterations: 50 }
);

// Get game state at specific turn
const state = getGameStateAtTurn(events, turn);

// Verify game outcome
const isValid = validateGameOutcome(gameOutcome);
```

### game-outcome-validator.ts

```typescript
// Check for tie games
if (gameOutcome.p1Points === 0 && gameOutcome.p2Points === 0) {
  throw new Error('BUG DETECTED: Tie game (0-0)');
}

// Validate points
validatePointsCalculation(gameOutcome);

// Check winner
const winner = getWinner(gameOutcome);
```

### event-capturing-strategy.ts

```typescript
// Wrap bot handler to capture decision events
const capturingStrategy = new EventCapturingStrategy(
  originalStrategy
);

// Access captured events
const events = capturingStrategy.getCapturedEvents();
```

## Test Maturity

### Automated Test Suite

- **Full game completion**: 1 test file
- **Unit components**: 1 test file
- **Test utilities**: 3+ helper modules
- **Coverage**: All main algorithm paths

Pass rate: **100%** (after state mutation fixes)

### Known Issues

**No current known issues** - The main issue was state mutation during simulation, which is fixed via deep copying.

## Future Test Additions

Potential areas for expansion:
- ❌ Multi-turn strategic planning validation
- ❌ Complex card interaction edge cases
- ❌ Performance benchmarks (iterations vs decision quality)
- ❌ Memory usage optimization tests
- ❌ Parallel simulation performance
- ❌ Coverage for new game adapters (Euchre, etc.)

## Debug Mode

Enable detailed logging in tests:

```typescript
// In test file
import { logger } from '../src/utils/log-utils.js';

logger.setLevel('debug'); // Enable debug logs
```

Debug output includes:
- Tree traversal (selection moves)
- Node expansion (new nodes added)
- Simulation playouts (random moves to terminal state)
- Backpropagation (score updates)
- Action generation details

## See Also

- `README.md` - Project overview
- `AGENTS.md` - Architectural patterns
- `../pocket-tcg/AGENTS.md` - Game framework conventions

