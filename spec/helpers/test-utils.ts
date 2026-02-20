import { gameFactory } from '@cards-ts/pocket-tcg/dist/game-factory.js';
import { HandlerChain, ControllerState } from '@cards-ts/core';
import { CardRepository } from '@cards-ts/pocket-tcg/dist/repository/card-repository.js';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import type { CreatureData, SupporterData, ItemData, ToolData } from '@cards-ts/pocket-tcg/dist/repository/card-types.js';
import { InstancedFieldCard } from '@cards-ts/pocket-tcg/dist/repository/card-types.js';
import { GameParams } from '@cards-ts/pocket-tcg/dist/game-params.js';
import { RandomDecisionStrategy } from '../../src/strategies/random-decision-strategy.js';
import { createPocketTCGAdapterConfig } from '../../src/adapters/pocket-tcg/adapter.js';

/**
 * Re-export CardRepository as MockCardRepository for tests.
 * When called with no args, provides default test creatures.
 */
export class MockCardRepository extends CardRepository {
    constructor(options?: {
        creatures?: Map<string, CreatureData>,
        supporters?: Map<string, SupporterData>,
        items?: Map<string, ItemData>,
        tools?: Map<string, ToolData>
    }) {
        // Merge default creatures with any custom ones provided
        const creatures = options?.creatures 
            ? new Map([ ...DEFAULT_TEST_CREATURES, ...options.creatures ])
            : DEFAULT_TEST_CREATURES;
        
        const supporters = options?.supporters
            ? new Map([ ...DEFAULT_TEST_SUPPORTERS, ...options.supporters ])
            : DEFAULT_TEST_SUPPORTERS;
        
        const tools = options?.tools
            ? new Map([ ...DEFAULT_TEST_TOOLS, ...options.tools ])
            : DEFAULT_TEST_TOOLS;
        
        super(
            creatures,
            supporters,
            options?.items,
            tools,
        );
    }
}

/**
 * Default test creatures for use in tests
 */
const DEFAULT_TEST_CREATURES = new Map<string, CreatureData>([
    [ 'basic-creature', {
        templateId: 'basic-creature',
        name: 'Basic Creature',
        maxHp: 60,
        type: 'fire',
        weakness: 'water',
        retreatCost: 1,
        attacks: [{ name: 'Basic Attack', damage: 20, energyRequirements: [{ type: 'fire', amount: 1 }] }],
    }],
    [ 'multi-attack-creature', {
        templateId: 'multi-attack-creature',
        name: 'Multi Attack Creature',
        maxHp: 80,
        type: 'water',
        weakness: 'grass',
        retreatCost: 2,
        attacks: [
            { name: 'Attack 1', damage: 30, energyRequirements: [{ type: 'water', amount: 1 }] },
            { name: 'Attack 2', damage: 50, energyRequirements: [{ type: 'water', amount: 2 }] },
        ],
    }],
    [ 'fragile-pokemon', {
        templateId: 'fragile-pokemon',
        name: 'Fragile Pokemon',
        maxHp: 30,
        type: 'grass',
        weakness: 'fire',
        retreatCost: 1,
        attacks: [{ name: 'Weak Attack', damage: 10, energyRequirements: [{ type: 'grass', amount: 2 }] }],
    }],
    [ 'tank-pokemon', {
        templateId: 'tank-pokemon',
        name: 'Tank Pokemon',
        maxHp: 250,
        type: 'water',
        weakness: 'lightning',
        retreatCost: 3,
        attacks: [{ name: 'Heavy Attack', damage: 80, energyRequirements: [{ type: 'water', amount: 1 }] }],
    }],
    [ 'strong-attacker', {
        templateId: 'strong-attacker',
        name: 'Strong Attacker',
        maxHp: 100,
        type: 'fire',
        weakness: 'water',
        retreatCost: 2,
        attacks: [{ name: 'Strong Attack', damage: 70, energyRequirements: [{ type: 'fire', amount: 2 }] }],
    }],
    [ 'weak-defender', {
        templateId: 'weak-defender',
        name: 'Weak Defender',
        maxHp: 40,
        type: 'grass',
        weakness: 'fire',
        retreatCost: 1,
        attacks: [{ name: 'Weak Attack', damage: 10, energyRequirements: [{ type: 'grass', amount: 1 }] }],
    }],
    [ 'high-hp-creature', {
        templateId: 'high-hp-creature',
        name: 'High HP Creature',
        maxHp: 180,
        type: 'fighting',
        weakness: 'psychic',
        retreatCost: 3,
        attacks: [{ name: 'Strong Attack', damage: 60, energyRequirements: [{ type: 'fighting', amount: 2 }] }],
    }],
    [ 'evolved-creature', {
        templateId: 'evolved-creature',
        name: 'Evolved Creature',
        maxHp: 90,
        type: 'fire',
        weakness: 'water',
        retreatCost: 2,
        previousStageName: 'Basic Creature',
        attacks: [
            { name: 'Basic Attack', damage: 20, energyRequirements: [{ type: 'fire', amount: 1 }] },
            { name: 'Strong Attack', damage: 50, energyRequirements: [{ type: 'fire', amount: 2 }] },
        ],
    }],
    [ 'healing-creature', {
        templateId: 'healing-creature',
        name: 'Healing Creature',
        maxHp: 60,
        type: 'fire',
        weakness: 'water',
        retreatCost: 1,
        attacks: [{ name: 'Basic Attack', damage: 20, energyRequirements: [{ type: 'fire', amount: 1 }] }],
        ability: {
            name: 'Recover',
            description: 'Heal 20 damage from this creature',
            trigger: { type: 'manual', unlimited: true },
            effects: [
                { 
                    type: 'hp' as const, 
                    operation: 'heal' as const, 
                    amount: { type: 'constant' as const, value: 20 }, 
                    target: { type: 'fixed' as const, player: 'self' as const, position: 'active' as const },
                },
            ],
        },
    }],
]);

const DEFAULT_TEST_TOOLS = new Map<string, ToolData>([
    [ 'basic-tool', {
        templateId: 'basic-tool',
        name: 'Basic Tool',
        effects: [{ type: 'hp' as const, operation: 'heal' as const, amount: { type: 'constant' as const, value: 10 }, target: { type: 'fixed' as const, player: 'self' as const, position: 'active' as const }}],
    }],
]);

const DEFAULT_TEST_SUPPORTERS = new Map<string, SupporterData>([
    [ 'basic-supporter', {
        templateId: 'basic-supporter',
        name: 'Basic Supporter',
        effects: [], // Generic supporter with no effects for flexible testing
    }],
    [ '20-hp-heal-supporter', {
        templateId: '20-hp-heal-supporter',
        name: '20 HP Heal Supporter',
        effects: [
            {
                type: 'hp' as const,
                target: { type: 'fixed', player: 'self', position: 'active' },
                amount: { type: 'constant', value: 20 },
                operation: 'heal' as const,
            },
        ],
    }],
    [ 'full-heal-supporter', {
        templateId: 'full-heal-supporter',
        name: 'Full Heal Supporter',
        effects: [
            {
                type: 'hp' as const,
                target: { type: 'fixed', player: 'self', position: 'active' },
                amount: { type: 'constant', value: 60 },
                operation: 'heal' as const,
            },
        ],
    }],
]);

const DEFAULT_TEST_ITEMS = new Map<string, ItemData>([
    [ 'basic-item', {
        templateId: 'basic-item',
        name: 'Basic Item',
        effects: [],
    }],
]);

/**
 * Factory function to create a CardRepository with optional custom cards.
 * If no creatures provided, includes default test creatures.
 */
export function createMockCardRepository(options?: {
    creatures?: CreatureData[],
    supporters?: SupporterData[],
    items?: ItemData[],
    tools?: ToolData[]
}): CardRepository {
    // Convert arrays to Maps for CardRepository
    const creaturesMap = new Map(DEFAULT_TEST_CREATURES);
    if (options?.creatures) {
        for (const creature of options.creatures) {
            creaturesMap.set(creature.templateId, creature);
        }
    }
    
    const supportersMap = options?.supporters 
        ? new Map(options.supporters.map(s => [ s.templateId, s ]))
        : new Map(DEFAULT_TEST_SUPPORTERS);
    
    const itemsMap = options?.items
        ? new Map(options.items.map(i => [ i.templateId, i ]))
        : new Map(DEFAULT_TEST_ITEMS);
    
    const toolsMap = options?.tools
        ? new Map(options.tools.map(t => [ t.templateId, t ]))
        : new Map(DEFAULT_TEST_TOOLS);
    
    return new CardRepository(
        creaturesMap,
        supportersMap,
        itemsMap,
        toolsMap,
    );
}

export function createGameDriver(state: ControllerState<Controllers>, cardRepository: CardRepository) {
    const factory = gameFactory(cardRepository);
    
    // Create random handlers using adapter config
    const adapterConfig = createPocketTCGAdapterConfig(cardRepository);
    const randomHandler1 = adapterConfig.createHandler(new RandomDecisionStrategy(adapterConfig));
    const randomHandler2 = adapterConfig.createHandler(new RandomDecisionStrategy(adapterConfig));
    
     
    const players = [
        new HandlerChain([ randomHandler1 ]),
         
        new HandlerChain([ randomHandler2 ]),
    ];
    
    const params: GameParams = {
        initialDecks: [[], []],
        playerEnergyTypes: [[ 'fire' ], [ 'water' ]],
        maxHandSize: 10,
        maxTurns: 30,
    };
     
    const playerNames = Array.isArray(state.names) ? state.names : [ 'Player 1', 'Player 2' ];
    
    return factory.getGameDriver(players, params, playerNames, state);
}

/**
 * Creates a properly-formed InstancedFieldCard for testing
 */
export function createInstancedFieldCard(templateId: string, fieldInstanceId: string, damageTaken: number = 0): InstancedFieldCard {
    return {
        fieldInstanceId,
        evolutionStack: [
            {
                instanceId: fieldInstanceId,
                templateId,
            },
        ],
        damageTaken,
        turnLastPlayed: 0,
    };
}
