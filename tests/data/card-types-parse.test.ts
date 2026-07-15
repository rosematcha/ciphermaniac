/**
 * parseCardPage — the Limitless card-page parser behind build-card-types.mjs.
 * Fixtures mirror the live markup shapes verified against
 * limitlesstcg.com/cards/{ASC/142, MEG/114, TWM/130, TWM/167} (July 2026).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCardPage } from '../../scripts/build-card-types.mjs';

const POKEMON_PAGE = `
<div class="card-text">
  <div class="card-text-section">
    <p class="card-text-title">
      <span class="card-text-name"><a href="/cards/ASC/142">Fezandipiti ex</a></span>
        - Darkness               - 210 HP         </p>
    <p class="card-text-type">
      Pokémon
        - Basic
    </p>
  </div>
  <div class="card-text-section">
    <div class="card-text-ability">
      <p class="card-text-ability-info">
        Ability:
         Flip the Script                     </p>
      <p class="card-text-ability-effect">
         Once during your turn, if any of your Pokémon were Knocked Out during your opponent's last turn, you may draw 3 cards.                     </p>
    </div>
    <div class="card-text-attack">
      <p class="card-text-attack-info">
        <span class="ptcg-symbol">CCC</span>
        Cruel Arrow
      </p>
      <p class="card-text-attack-effect">
         This attack does 100 damage to 1 of your opponent's Pokémon. <span class="reminder-text">(Don't apply Weakness and Resistance for Benched Pokémon.)</span>     </p>
    </div>
  </div>
  <div class="card-text-section">
    <p class="card-text-wrr">
      Weakness: Fighting <br>
      Resistance: none <br>
      Retreat: 1 <br>
    </p>
  </div>
  <div class="card-text-section card-text-artist">
    Illustrated by
    <a href="/cards?q=!artist:takuyoa">
      takuyoa
    </a>
  </div>
</div>
<div class="card-legality">
  <div class="regulation-mark">
    H Regulation Mark •  <a class="formats-link" href="#">More formats</a>
  </div>
  <div class="card-legality-group">
    <div class="card-legality-item">
      <div><a href="/cards?q=format:standard">Standard</a></div>
      <div class="legal"> legal </div>
    </div>
    <div class="card-legality-item">
      <div><a href="/cards/jp?q=format:standard-jp">Standard (JP)</a></div>
      <div class="legal"> legal </div>
    </div>
    <div class="card-legality-item">
      <div><a href="/cards?q=format:expanded">Expanded</a></div>
      <div class="legal"> legal </div>
    </div>
  </div>
</div>
<div class="card-prints">
  <div class="card-prints-current">
    <a href=/cards/ASC>
      <div class="prints-current-details">
        <span class="text-lg">
          Ascended Heroes (ASC)
        </span>
        <span>
          #142 · Double Rare
        </span>
      </div>
    </a>
  </div>
</div>`;

const DAMAGE_ATTACK_PAGE = `
<p class="card-text-title">
  <span class="card-text-name"><a href="/cards/TWM/130">Dragapult ex</a></span>
    - Dragon - 320 HP </p>
<p class="card-text-type">
  Pokémon
    - Stage 2 - Evolves from Drakloak
</p>
<div class="card-text-section">
  <div class="card-text-attack">
    <p class="card-text-attack-info"> <span class="ptcg-symbol">C</span> Jet Headbutt 70 </p>
    <p class="card-text-attack-effect"> </p>
  </div>
  <div class="card-text-attack">
    <p class="card-text-attack-info"> <span class="ptcg-symbol">RP</span> Phantom Dive 200 </p>
    <p class="card-text-attack-effect"> Put 6 damage counters on your opponent's Benched Pokémon in any way you like. </p>
  </div>
</div>`;

const TRAINER_PAGE = `
<p class="card-text-title">
  <span class="card-text-name"><a href="/cards/MEG/114">Boss's Orders</a></span>
</p>
<p class="card-text-type">
  Trainer
    - Supporter
</p>
<div class="card-text-section">
  Switch 1 of your opponent's Benched Pokémon with their Active Pokémon.
</div>
<div class="card-text-section card-text-artist">
  Illustrated by
  <a href="/cards?q=!artist:nc_empire">
    NC Empire
  </a>
</div>
<div class="card-legality">
  <div class="regulation-mark">
    I Regulation Mark •
  </div>
</div>
<div class="card-prints-current">
  <div class="prints-current-details">
    <span class="text-lg">Mega Evolution (MEG)</span>
    <span>#114 · Uncommon</span>
  </div>
</div>`;

const ACE_SPEC_TRAINER_PAGE = `
<p class="card-text-type">
  Trainer
    - Item
    - ACE SPEC
</p>
<div class="card-text-section">
  Switch in 1 of your opponent's Benched Pokémon to the Active Spot.
</div>`;

const SPECIAL_ENERGY_PAGE = `
<p class="card-text-title">
  <span class="card-text-name"><a href="/cards/TWM/167">Legacy Energy</a></span>
</p>
<p class="card-text-type">
  Energy
    - Special Energy
</p>
<div class="card-text-section">
  As long as this card is attached to a Pokémon, it provides every type of Energy but provides only 1 Energy at a time.<br><br>If the Pokémon this card is attached to is Knocked Out, that player takes 1 fewer Prize card.
</div>`;

void test('parses full Pokémon enrichment: HP, type, WRR, rarity, artist, legality', () => {
  const parsed = parseCardPage(POKEMON_PAGE);
  assert.ok(parsed);
  assert.equal(parsed.metadataVersion, 2);
  assert.equal(parsed.cardType, 'pokemon');
  assert.equal(parsed.evolutionInfo, 'Basic');
  assert.equal(parsed.fullType, 'Pokémon - Basic');
  assert.equal(parsed.stage, 'basic');
  assert.deepEqual(parsed.mechanicSubtypes, ['ex']); // "Fezandipiti ex"
  assert.equal(parsed.regulationMark, 'H');
  assert.equal(parsed.hp, 210);
  assert.equal(parsed.pokemonType, 'Darkness');
  assert.deepEqual(parsed.weakness, { type: 'Fighting', modifier: null });
  assert.equal(parsed.resistance, undefined); // "none" is omitted
  assert.equal(parsed.retreatCost, 1);
  assert.equal(parsed.rarity, 'Double Rare');
  assert.equal(parsed.artist, 'takuyoa');
  // legacy name arrays keep their semantics (archetype-title matching)
  assert.deepEqual(parsed.abilities, ['Flip the Script']);
  assert.deepEqual(parsed.attacks, ['Cruel Arrow']);
  // detailed structures
  assert.deepEqual(parsed.abilityDetails, [
    {
      name: 'Flip the Script',
      effect:
        "Once during your turn, if any of your Pokémon were Knocked Out during your opponent's last turn, you may draw 3 cards."
    }
  ]);
  assert.equal(parsed.attackDetails?.length, 1);
  assert.equal(parsed.attackDetails?.[0].cost, 'CCC');
  assert.equal(parsed.attackDetails?.[0].name, 'Cruel Arrow');
  assert.equal(parsed.attackDetails?.[0].damage, null);
  assert.match(parsed.attackDetails?.[0].effect ?? '', /^This attack does 100 damage/);
  // JP formats are excluded
  assert.deepEqual(parsed.legality, { standard: 'legal', expanded: 'legal' });
});

void test('parses attack damage and stage/evolves-from', () => {
  const parsed = parseCardPage(DAMAGE_ATTACK_PAGE);
  assert.ok(parsed);
  assert.equal(parsed.hp, 320);
  assert.equal(parsed.pokemonType, 'Dragon');
  assert.equal(parsed.stage, 'stage2');
  assert.deepEqual(parsed.mechanicSubtypes, ['ex']); // "Dragapult ex"
  assert.equal(parsed.evolutionInfo, 'Stage 2 - Evolves from Drakloak');
  assert.deepEqual(parsed.attacks, ['Jet Headbutt', 'Phantom Dive']);
  assert.deepEqual(parsed.attackDetails, [
    { cost: 'C', name: 'Jet Headbutt', damage: '70', effect: null },
    {
      cost: 'RP',
      name: 'Phantom Dive',
      damage: '200',
      effect: "Put 6 damage counters on your opponent's Benched Pokémon in any way you like."
    }
  ]);
});

void test('parses trainer rules text, subtype, rarity, artist', () => {
  const parsed = parseCardPage(TRAINER_PAGE);
  assert.ok(parsed);
  assert.equal(parsed.cardType, 'trainer');
  assert.equal(parsed.subType, 'supporter');
  assert.equal(parsed.regulationMark, 'I');
  assert.equal(parsed.rarity, 'Uncommon');
  assert.equal(parsed.artist, 'NC Empire');
  assert.equal(parsed.text, "Switch 1 of your opponent's Benched Pokémon with their Active Pokémon.");
  assert.equal(parsed.hp, undefined);
  assert.equal(parsed.pokemonType, undefined);
});

void test('flags trainer ACE SPEC and forces tool subtype', () => {
  const parsed = parseCardPage(ACE_SPEC_TRAINER_PAGE);
  assert.ok(parsed);
  assert.equal(parsed.aceSpec, true);
  assert.equal(parsed.subType, 'tool');
});

void test('parses special energy with multi-paragraph rules text', () => {
  const parsed = parseCardPage(SPECIAL_ENERGY_PAGE);
  assert.ok(parsed);
  assert.equal(parsed.cardType, 'energy');
  assert.equal(parsed.subType, 'special');
  // Limitless does not mark energy ACE SPECs; the name heuristic stays downstream
  assert.equal(parsed.aceSpec, undefined);
  assert.match(parsed.text ?? '', /provides every type of Energy/);
  assert.match(parsed.text ?? '', /\n\n/); // <br><br> preserved as paragraph break
});

void test('returns null when no type line exists', () => {
  assert.equal(parseCardPage('<html><body>nothing here</body></html>'), null);
});
