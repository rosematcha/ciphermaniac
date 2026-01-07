/**
 * Card type hierarchy configuration for hierarchical filtering
 * @module CardTypeHierarchy
 */

export interface CardTypeOption {
  value: string;
  label: string;
  parent?: string;
}

export interface CardTypeParent {
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
 * Get all flat card type options (parents + children)
 */
export function getAllCardTypeOptions(): CardTypeOption[] {
  const options: CardTypeOption[] = [];

  for (const parent of CARD_TYPE_HIERARCHY) {
    options.push({
      value: parent.value,
      label: parent.label
    });
    options.push(...parent.children);
  }

  return options;
}

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

/**
 * Check if a value is a parent category
 */
export function isParentCategory(value: string): boolean {
  return CARD_TYPE_HIERARCHY.some(p => p.value === value);
}

/**
 * Expand selection to include parent if all children are selected
 */
export function normalizeSelection(selected: string[]): string[] {
  const normalized = new Set(selected);

  // For each parent, check if all children are selected
  for (const parent of CARD_TYPE_HIERARCHY) {
    const allChildrenSelected = parent.children.every(child => normalized.has(child.value));

    if (allChildrenSelected && parent.children.length > 0) {
      // Remove all children and add parent instead
      parent.children.forEach(child => normalized.delete(child.value));
      normalized.add(parent.value);
    }
  }

  return Array.from(normalized);
}

/**
 * Expand parent selections to their children
 * This is used when a parent is selected to select all its children
 */
export function expandParentSelections(selected: string[]): string[] {
  const expanded = new Set<string>();

  for (const value of selected) {
    if (isParentCategory(value)) {
      // Add all children
      const children = getChildrenForParent(value);
      children.forEach(child => expanded.add(child));
    } else {
      // Add the value itself
      expanded.add(value);
    }
  }

  return Array.from(expanded);
}
