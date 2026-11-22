/-!
# Filtered list decoding

Models `decodeListIndex` in `src/lib/data/lists.ts` and proves that decoding only the rows whose
archetype `keep` accepts, each with its original position as `id`, gives exactly what the old code
gave: decode every row, then filter the records by `keep(record.archetype)`.

`payload.archetypes` is a list of optional labels (a hole or `null` reads as `''` through `??`).
Rows are abstract; `archOf row` is `row[3]`, the row's archetype index. `decode row id` stands for
`decodeRow(context, row, id)`, and `archetype` reads a record's `archetype` field.
-/

variable {Row Rec : Type}

/-- `payload.archetypes[i] ?? ''`: the label a record carries, empty when the index is missing. -/
def labelAt (archetypes : List (Option String)) (i : Nat) : String :=
  (archetypes[i]?.bind id).getD ""

/-- `kept = payload.archetypes.map(label => keep(label ?? ''))`: `keep` once per archetype. -/
def keptTable (archetypes : List (Option String)) (keep : String → Bool) : List Bool :=
  archetypes.map fun label => keep (label.getD "")

/-- `kept[i] ?? keep('')`: the precomputed verdict, or `keep('')` past the end of the table. -/
def keptAt (kept : List Bool) (keep : String → Bool) (i : Nat) : Bool :=
  kept[i]?.getD (keep "")

/-- `decodeListIndex`: `payload.decks.forEach((row, id) => { if (kept[row[3]] ?? keep('')) ... })`
pushes `decodeRow(context, row, id)` for each kept row, in order. -/
def decodeListIndex (archetypes : List (Option String)) (archOf : Row → Nat)
    (decode : Row → Nat → Rec) (keep : String → Bool) (rows : List Row) : List Rec :=
  let kept := keptTable archetypes keep
  ((rows.zipIdx).filter fun p => keptAt kept keep (archOf p.1)).map fun p => decode p.1 p.2

/-- The old code: `payload.decks.map((row, id) => decodeRow(context, row, id))`, then
`.filter(record => keep(record.archetype))`. -/
def decodeThenFilter (archetype : Rec → String) (decode : Row → Nat → Rec)
    (keep : String → Bool) (rows : List Row) : List Rec :=
  (rows.mapIdx fun id row => decode row id).filter fun r => keep (archetype r)

/-- The table lookup agrees with calling `keep` on the label, in range or not. -/
theorem keptAt_eq (archetypes : List (Option String)) (keep : String → Bool) (i : Nat) :
    keptAt (keptTable archetypes keep) keep i = keep (labelAt archetypes i) := by
  unfold keptAt keptTable labelAt
  rw [List.getElem?_map]
  cases archetypes[i]? <;> rfl

/-- Headline: when a decoded record's archetype is its row's label, filtering rows before decoding
returns the same records, with the same ids, in the same order, as decoding then filtering. -/
theorem decodeListIndex_eq (archetypes : List (Option String)) (archOf : Row → Nat)
    (archetype : Rec → String) (decode : Row → Nat → Rec) (keep : String → Bool)
    (hdecode : ∀ row id, archetype (decode row id) = labelAt archetypes (archOf row))
    (rows : List Row) :
    decodeListIndex archetypes archOf decode keep rows = decodeThenFilter archetype decode keep rows := by
  unfold decodeListIndex decodeThenFilter
  rw [List.mapIdx_eq_zipIdx_map, List.filter_map]
  dsimp only
  congr 1
  apply List.filter_congr
  intro p _
  simp [keptAt_eq, hdecode]

#print axioms keptAt_eq
#print axioms decodeListIndex_eq
