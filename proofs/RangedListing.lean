/-!
# Ranged R2 listing

Models `.github/scripts/lib/build/rangedListing.ts` and proves that `listR2ObjectsInRanges`
returns the sorted listing exactly: every range worker returns its slice of the listing whether or
not R2 honors `StartAfter`, and the slices cover the listing once, in order.

Keys carry a strict order `<` (R2's UTF-8 byte order); `key <= bound` is read as `¬ bound < key`.
Totality is not needed.
-/

variable {α : Type}

/-- On a sorted list, a test that stays false once it fails keeps a prefix. -/
theorem takeWhile_eq_filter {r : α → α → Prop} {p : α → Bool}
    (hp : ∀ x y, r x y → p x = false → p y = false) :
    ∀ {M : List α}, M.Pairwise r → M.takeWhile p = M.filter p
  | [], _ => rfl
  | x :: xs, h => by
    rw [List.pairwise_cons] at h
    cases hx : p x
    · simp only [List.takeWhile_cons, List.filter_cons, hx]
      exact (List.filter_eq_nil_iff.2 fun y hy => by simp [hp x y (h.1 y hy) hx]).symm
    · simp [hx, takeWhile_eq_filter hp h.2]

/-- That prefix and the rest, put back together, give the list. -/
theorem filter_append_filter_not {r : α → α → Prop} {p : α → Bool}
    (hp : ∀ x y, r x y → p x = false → p y = false) :
    ∀ {M : List α}, M.Pairwise r → M.filter p ++ M.filter (fun x => !p x) = M
  | [], _ => rfl
  | x :: xs, h => by
    rw [List.pairwise_cons] at h
    cases hx : p x
    · have hf : ∀ y ∈ xs, p y = false := fun y hy => hp x y (h.1 y hy) hx
      simp only [List.filter_cons, hx]
      rw [List.filter_eq_nil_iff.2 fun y hy => by simp [hf y hy],
        List.filter_eq_self.2 fun y hy => by simp [hf y hy]]
      rfl
    · simp [hx, filter_append_filter_not hp h.2]

structure StrictOrder (α : Type) [LT α] : Prop where
  irrefl : ∀ x : α, ¬ x < x
  trans : ∀ {x y z : α}, x < y → y < z → x < z

variable [LT α] [DecidableRel (α := α) (· < ·)]

/-- `pastBound(key, bound)`: the key sorts after the bound. -/
def pastBound (key bound : α) : Bool := decide (bound < key)

/-- The lower test in `listRange`: keys past `after`, or every key when `after` is undefined. -/
def above : Option α → α → Bool
  | none, _ => true
  | some a, x => pastBound x a

/-- The upper test in `listRange`: keys not past `upTo`, or every key when `upTo` is undefined. -/
def within : Option α → α → Bool
  | none, _ => true
  | some b, x => !pastBound x b

/-- `listRange`: `start` is every page R2 returned, joined. Skip keys at or below `after`, stop at
the first key past `upTo`. -/
def listRange (start : List α) (after upTo : Option α) : List α :=
  (start.filter (above after)).takeWhile (within upTo)

/-- The `ranges` array: `(undefined, b1), (b1, b2), ..., (bk, undefined)`. -/
def ranges (after : Option α) : List α → List (Option α × Option α)
  | [] => [(after, none)]
  | b :: bs => (after, some b) :: ranges (some b) bs

/-- `listR2ObjectsInRanges`: `results.flat()` over the workers. `start a` is what R2 lists for
`StartAfter: a`. -/
def listR2ObjectsInRanges (start : Option α → List α) (boundaries : List α) : List α :=
  ((ranges none boundaries).map fun r => listRange (start r.1) r.1 r.2).flatten

/-- What R2 may list for `StartAfter: after`: a suffix of the full listing `L` that holds every key
past `after`. Honoring `StartAfter` gives the shortest such suffix; ignoring it gives `L`. -/
def ValidStart (L : List α) (after : Option α) (S : List α) : Prop :=
  S <:+ L ∧ ∀ x ∈ L, above after x → x ∈ S

section
variable (ord : StrictOrder α)
include ord

theorem within_stays_false (upTo : Option α) :
    ∀ x y : α, x < y → within upTo x = false → within upTo y = false := by
  intro x y hxy
  cases upTo <;> simp [within, pastBound]
  exact fun h => ord.trans h hxy

/-- Worker correctness: whatever valid suffix R2 starts from, `listRange` returns the keys of the
listing in `(after, upTo]`. -/
theorem listRange_eq_filter {L S : List α} {after upTo : Option α}
    (hL : L.Pairwise (· < ·)) (hS : ValidStart L after S) :
    listRange S after upTo = L.filter fun x => above after x && within upTo x := by
  obtain ⟨⟨P, rfl⟩, hmem⟩ := hS
  rw [List.pairwise_append] at hL
  have hP : ∀ x ∈ P, ¬ above after x := fun x hx hab =>
    ord.irrefl x (hL.2.2 x hx x (hmem x (List.mem_append_left S hx) hab))
  rw [listRange, takeWhile_eq_filter (within_stays_false ord upTo)
    (hL.2.1.sublist List.filter_sublist), List.filter_filter, List.filter_append,
    (List.filter_eq_nil_iff (l := P)).2 fun x hx => by simp [hP x hx]]
  simp [Bool.and_comm]

/-- Cover: the range slices, joined in order, are the listing past `after`. -/
theorem ranges_cover {L : List α} (hL : L.Pairwise (· < ·)) :
    ∀ {bs : List α} {after : Option α}, bs.Pairwise (· < ·) → (∀ b ∈ bs, above after b) →
      ((ranges after bs).map fun r => L.filter fun x => above r.1 x && within r.2 x).flatten =
        L.filter (above after)
  | [], _, _, _ => by simp [ranges, within]
  | b :: bs, after, hbs, hab => by
    rw [List.pairwise_cons] at hbs
    have ih := ranges_cover hL hbs.2 (after := some b) (by simpa [above, pastBound] using hbs.1)
    have hM := filter_append_filter_not (within_stays_false ord (some b))
      (hL.sublist (List.filter_sublist (p := above after)))
    simp only [ranges, List.map_cons, List.flatten_cons, ih]
    rw [← hM, List.filter_filter, List.filter_filter]
    congr 1
    · simp [Bool.and_comm]
    · apply List.filter_congr
      intro x _
      rcases after with _ | a
      · simp [above, within, pastBound]
      · have hb : a < b := by simpa [above, pastBound] using hab b (List.mem_cons_self ..)
        simp only [above, within, pastBound, Bool.not_not]
        cases h : decide (b < x) <;> simp_all
        exact ord.trans hb h

/-- Headline: for a sorted listing and strictly increasing boundaries, `listR2ObjectsInRanges`
returns the listing exactly, whether or not R2 honors `StartAfter`. -/
theorem listR2ObjectsInRanges_eq {L bs : List α} {start : Option α → List α}
    (hL : L.Pairwise (· < ·)) (hbs : bs.Pairwise (· < ·))
    (hstart : ∀ after, ValidStart L after (start after)) :
    listR2ObjectsInRanges start bs = L := by
  have := ranges_cover ord hL hbs (after := none) (by simp [above])
  rw [(List.filter_eq_self (p := above none)).2 fun _ _ => rfl] at this
  rw [← this, listR2ObjectsInRanges]
  congr 1
  exact List.map_congr_left fun r _ => listRange_eq_filter ord hL (hstart r.1)

end

#print axioms listRange_eq_filter
#print axioms ranges_cover
#print axioms listR2ObjectsInRanges_eq
