/**
 * Card type hierarchy configuration for hierarchical filtering
 * @module CardTypeHierarchy
 */

interface CardTypeOption {
  value: string;
  label: string;
  parent?: string;
}

interface CardTypeParent {
  value: string;
  label: string;
  children: CardTypeOption[];
}

/**
 * Hierarchical card type structure
 */
export const CARD_TYPE_HIERARCHY: CardTypeParent[] = [
  {
    value: 'pokemon',
    label: 'Pokémon',
    children: [
      { value: 'pokemon:basic', label: 'Basic', parent: 'pokemon' },
      { value: 'pokemon:stage1', label: 'Stage 1', parent: 'pokemon' },
      { value: 'pokemon:stage2', label: 'Stage 2', parent: 'pokemon' }
    ]
  },
  {
    value: 'trainer',
    label: 'Trainer',
    children: [
      { value: 'trainer:item', label: 'Item', parent: 'trainer' },
      { value: 'trainer:supporter', label: 'Supporter', parent: 'trainer' },
      { value: 'trainer:tool', label: 'Tool', parent: 'trainer' },
      { value: 'trainer:stadium', label: 'Stadium', parent: 'trainer' }
    ]
  },
  {
    value: 'energy',
    label: 'Energy',
    children: [
      { value: 'energy:basic', label: 'Basic', parent: 'energy' },
      { value: 'energy:special', label: 'Special', parent: 'energy' }
    ]
  }
];

/**
 * Get children values for a parent card type
 */
export function getChildrenForParent(parentValue: string): string[] {
  const parent = CARD_TYPE_HIERARCHY.find(p => p.value === parentValue);
  return parent ? parent.children.map(c => c.value) : [];
}

/**
 * Get parent value for a child card type
 */
export function getParentForChild(childValue: string): string | null {
  for (const parent of CARD_TYPE_HIERARCHY) {
    const child = parent.children.find(c => c.value === childValue);
    if (child) {
      return parent.value;
    }
  }
  return null;
}
