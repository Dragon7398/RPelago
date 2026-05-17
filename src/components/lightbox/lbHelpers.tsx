import { TILE_TRAITS, NAME_COLORS } from '../../lib/constants';

export function resolveNameColor(colorId: string | undefined): string | undefined {
  if (!colorId || colorId === 'default') return undefined;
  return NAME_COLORS.find(c => c.id === colorId)?.value;
}

export type TraitEffect =
  | { kind: 'negated';  item: string }
  | { kind: 'modified'; item: string; newValue: number }
  | { kind: 'none' };

export function traitEffect(traitId: string, value: number, inventory: Record<string, number>): TraitEffect {
  const has = (id: string) => (inventory[id] ?? 0) > 0;
  switch (traitId) {
    case 'magicresist': case 'physresist':
      if (has('wand_of_piercing'))   return { kind: 'negated',  item: 'Wand of Piercing' };
      break;
    case 'aerial':
      if (has('throwing_dagger'))    return { kind: 'negated',  item: 'Throwing Dagger' };
      break;
    case 'agile':
      if (has('throwing_dagger'))    return { kind: 'modified', item: 'Throwing Dagger', newValue: Math.round(value * 1.25) };
      break;
    case 'cursed': case 'stunning':
      if (has('ring_of_resistance')) return { kind: 'negated',  item: 'Ring of Resistance' };
      break;
    case 'horde':
      if (has('warhammer'))          return { kind: 'modified', item: 'Warhammer', newValue: Math.max(1, value - 1) };
      break;
    case 'sturdy':
      if (has('warhammer'))          return { kind: 'modified', item: 'Warhammer', newValue: Math.round(value * 0.5) };
      break;
  }
  return { kind: 'none' };
}

export function renderTraitDesc(description: string, traitIds: readonly string[]): React.ReactNode {
  if (traitIds.length === 0) return description;
  const refs = TILE_TRAITS.filter(t => traitIds.includes(t.id));
  if (refs.length === 0) return description;
  const pattern = new RegExp(
    `(${refs.map(t => t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'g',
  );
  const parts = description.split(pattern);
  return (
    <>
      {parts.map((part, i) => {
        const trait = refs.find(t => t.name === part);
        if (trait) {
          const tip = trait.description.replace('{value}', String(trait.defaultValue));
          return <span key={i} className="trait-ref" data-tooltip={tip}>{part}</span>;
        }
        return part;
      })}
    </>
  );
}
