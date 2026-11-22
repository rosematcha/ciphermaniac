/-!
# Order-free route reduction

Models `reduceToSingleEdges` in `shared/data/canonicalCardRoute.ts` and proves that it no longer
needs its input sorted: for each variant key, the edge it keeps is the unique least edge by
`(to, variantUid)` among the non-self edges from that key, so any two edge lists with the same
elements give the same map. The old code, which sorted by `(from, to, variantUid)` and then kept
the first edge with the smallest `to`, keeps that same edge.

Strings are an abstract type `α` with a decidable strict total order `<` (JS string order).
`Edge` is `RouteEdge`: `src` is `from` (a Lean keyword), `dst` is `to`, `uid` is `variantUid`,
and `data` stands for `toSet`, `toNumber` and `canonicalUid`. The `Map` is a function
`α → Option Edge`; `Map.get` is application and `Map.set` is `setKey`. Edges come from
`Object.entries(synonyms)`, so `variantUid` identifies an edge (`UidKey`).
-/

variable {α β : Type}

/-- `RouteEdge`. -/
structure Edge (α β : Type) where
  src : α
  dst : α
  uid : α
  data : β

structure StrictTotalOrder (α : Type) [LT α] : Prop where
  irrefl : ∀ x : α, ¬ x < x
  trans : ∀ {x y z : α}, x < y → y < z → x < z
  trichotomy : ∀ x y : α, x < y ∨ x = y ∨ y < x

section
variable [DecidableEq α]

/-- `chosen.set(k, e)`. -/
def setKey (m : α → Option (Edge α β)) (k : α) (e : Edge α β) : α → Option (Edge α β) :=
  fun k' => if k' = k then some e else m k'

/-- `!existing || better(edge, existing)`: whether `e` takes the slot. -/
def replaces (better : Edge α β → Edge α β → Bool) : Option (Edge α β) → Edge α β → Bool
  | none, _ => true
  | some x, e => better e x

/-- One loop iteration: skip a self-edge, otherwise set the slot for `e.src` when `e` replaces it. -/
def step (better : Edge α β → Edge α β → Bool) (m : α → Option (Edge α β)) (e : Edge α β) :
    α → Option (Edge α β) :=
  if e.src = e.dst then m
  else if replaces better (m e.src) e then setKey m e.src e else m

/-- The `for (const edge of edges)` loop from an empty `Map`, for a given replacement test. -/
def reduceWith (better : Edge α β → Edge α β → Bool) (edges : List (Edge α β)) :
    α → Option (Edge α β) :=
  edges.foldl (step better) fun _ => none

/-- What the slot for one key does on one edge. -/
def pick (b : Edge α β → Edge α β → Bool) (o : Option (Edge α β)) (e : Edge α β) :
    Option (Edge α β) :=
  if replaces b o e then some e else o

/-- The edges that compete for key `k`: from `k`, and not self-edges. -/
def cands (k : α) (edges : List (Edge α β)) : List (Edge α β) :=
  edges.filter fun e => decide (e.src = k) && !decide (e.src = e.dst)

/-- One loop step, read at key `k`, is `pick` on a competing edge and nothing otherwise. -/
theorem step_at (b : Edge α β → Edge α β → Bool) (m : α → Option (Edge α β)) (e : Edge α β)
    (k : α) : step b m e k =
      if (decide (e.src = k) && !decide (e.src = e.dst)) = true then pick b (m k) e else m k := by
  by_cases h1 : e.src = e.dst
  · simp [step, h1]
  · by_cases h2 : e.src = k
    · subst h2
      by_cases h3 : replaces b (m e.src) e = true <;> simp [step, pick, setKey, h1, h3]
    · have h2' : k ≠ e.src := fun h => h2 h.symm
      by_cases h3 : replaces b (m e.src) e = true <;> simp [step, setKey, h1, h2, h2', h3]

/-- The `Map` read at `k` is a fold of `pick` over the edges competing for `k`. -/
theorem foldl_step_at (b : Edge α β → Edge α β → Bool) (k : α) :
    ∀ (L : List (Edge α β)) (m : α → Option (Edge α β)),
      L.foldl (step b) m k = (cands k L).foldl (pick b) (m k)
  | [], _ => rfl
  | e :: L, m => by
    rw [List.foldl_cons, foldl_step_at b k L, step_at]
    simp only [cands, List.filter_cons]
    split <;> rfl

theorem cands_mem {k : α} {L : List (Edge α β)} {f : Edge α β} :
    f ∈ cands k L ↔ f ∈ L ∧ f.src = k ∧ f.src ≠ f.dst := by
  simp [cands]

end

section
variable [LT α]

/-- The `(to, variantUid)` order the new test reads. -/
def keyLt (e f : Edge α β) : Prop := e.dst < f.dst ∨ (e.dst = f.dst ∧ e.uid < f.uid)

/-- The old sort comparator returning `-1`: by `from`, then `to`, then `variantUid`. -/
def sortLt (e f : Edge α β) : Prop := e.src < f.src ∨ (e.src = f.src ∧ keyLt e f)

/-- `variantUid` is an object key, so it identifies the edge. -/
def UidKey (edges : List (Edge α β)) : Prop :=
  ∀ e ∈ edges, ∀ f ∈ edges, e.uid = f.uid → e = f

/-- Any two edges in the list are equal or ordered by `keyLt`. -/
def Keyed (S : List (Edge α β)) : Prop :=
  ∀ e ∈ S, ∀ f ∈ S, e = f ∨ keyLt e f ∨ keyLt f e

/-- `e` is in `S` and below every other edge of `S`. -/
def Least (S : List (Edge α β)) (e : Edge α β) : Prop :=
  e ∈ S ∧ ∀ f ∈ S, f ≠ e → keyLt e f

/-- The slot holds the least edge of `S`, or nothing when `S` is empty. -/
def IsLeast (S : List (Edge α β)) : Option (Edge α β) → Prop
  | none => S = []
  | some e => Least S e

theorem least_cons {T : List (Edge α β)} {e w : Edge α β} (h : Least T e)
    (hw : w ≠ e → keyLt e w) : Least (w :: T) e := by
  refine ⟨List.mem_cons_of_mem w h.1, fun f hf hne => ?_⟩
  rcases List.mem_cons.1 hf with rfl | hf
  · exact hw hne
  · exact h.2 f hf hne

theorem least_congr {S T : List (Edge α β)} {e : Edge α β} (h : ∀ f, f ∈ S ↔ f ∈ T) :
    Least S e → Least T e
  | ⟨he, hlt⟩ => ⟨(h e).1 he, fun f hf => hlt f ((h f).2 hf)⟩

theorem isLeast_congr {S T : List (Edge α β)} (h : ∀ f, f ∈ S ↔ f ∈ T) :
    ∀ {o : Option (Edge α β)}, IsLeast S o → IsLeast T o
  | none, hS => List.eq_nil_iff_forall_not_mem.2 fun f hf =>
    List.eq_nil_iff_forall_not_mem.1 hS f ((h f).2 hf)
  | some _, hS => least_congr h hS

section
variable (ord : StrictTotalOrder α)
include ord

theorem keyLt_trans {e f g : Edge α β} : keyLt e f → keyLt f g → keyLt e g := by
  unfold keyLt
  rintro (h1 | ⟨h1, h1'⟩) (h2 | ⟨h2, h2'⟩)
  · exact Or.inl (ord.trans h1 h2)
  · exact Or.inl (h2 ▸ h1)
  · exact Or.inl (h1 ▸ h2)
  · exact Or.inr ⟨h1.trans h2, ord.trans h1' h2'⟩

theorem keyLt_irrefl (e : Edge α β) : ¬ keyLt e e := by
  rintro (h | ⟨_, h⟩) <;> exact ord.irrefl _ h

theorem keyed_of_uidKey {L : List (Edge α β)} (h : UidKey L) : Keyed L := by
  intro e he f hf
  rcases ord.trichotomy e.dst f.dst with hd | hd | hd
  · exact Or.inr (Or.inl (Or.inl hd))
  · rcases ord.trichotomy e.uid f.uid with hu | hu | hu
    · exact Or.inr (Or.inl (Or.inr ⟨hd, hu⟩))
    · exact Or.inl (h e he f hf hu)
    · exact Or.inr (Or.inr (Or.inr ⟨hd.symm, hu⟩))
  · exact Or.inr (Or.inr (Or.inl hd))

/-- An edge above some member of `T` is above the least one. -/
theorem least_lt {T : List (Edge α β)} {e z w : Edge α β} (h : Least T e) (hz : z ∈ T)
    (hzw : keyLt z w) : keyLt e w := by
  by_cases hze : z = e
  · exact hze ▸ hzw
  · exact keyLt_trans ord (h.2 z hz hze) hzw

theorem isLeast_unique {S : List (Edge α β)} :
    ∀ {o o' : Option (Edge α β)}, IsLeast S o → IsLeast S o' → o = o'
  | none, none, _, _ => rfl
  | none, some _, h, h' => absurd (h ▸ h'.1) (List.not_mem_nil)
  | some _, none, h, h' => absurd (h' ▸ h.1) (List.not_mem_nil)
  | some e, some e', h, h' => by
    by_cases hee : e' = e
    · rw [hee]
    · exact absurd (keyLt_trans ord (h.2 e' h'.1 hee) (h'.2 e h.1 fun x => hee x.symm))
        (keyLt_irrefl ord e)

end

end

section
variable [DecidableEq α] [LT α] [DecidableRel (α := α) (· < ·)]

/-- The new test: `edge.to < existing.to || (edge.to === existing.to && edge.variantUid <
existing.variantUid)`. -/
def better (e x : Edge α β) : Bool :=
  decide (e.dst < x.dst) || (decide (e.dst = x.dst) && decide (e.uid < x.uid))

/-- The old test: `edge.to < existing.to`. -/
def betterOld (e x : Edge α β) : Bool := decide (e.dst < x.dst)

/-- `reduceToSingleEdges` now. -/
def reduceToSingleEdges : List (Edge α β) → α → Option (Edge α β) := reduceWith better

/-- `reduceToSingleEdges` before, which ran on the output of the sort in `collectRouteEdges`. -/
def reduceOld : List (Edge α β) → α → Option (Edge α β) := reduceWith betterOld

theorem better_eq_true {e x : Edge α β} : better e x = true ↔ keyLt e x := by
  simp [better, keyLt]

section
variable (ord : StrictTotalOrder α)
include ord

omit [DecidableEq α] in
/-- Below `keyLt`, the old test never fires: a later, larger edge has no smaller `to`. -/
theorem betterOld_false {x y : Edge α β} (h : keyLt x y) : betterOld y x = false := by
  simp only [betterOld, decide_eq_false_iff_not]
  intro hyx
  rcases h with h | ⟨h, _⟩
  · exact ord.irrefl _ (ord.trans h hyx)
  · exact ord.irrefl _ (h ▸ hyx)

/-- The slot, seeded with `x`, ends on the least edge of `x :: S`. -/
theorem foldl_pick_least :
    ∀ {S : List (Edge α β)} {x : Edge α β}, Keyed (x :: S) →
      ∃ e, S.foldl (pick better) (some x) = some e ∧ Least (x :: S) e
  | [], x, _ => ⟨x, rfl, List.mem_singleton_self x, fun f hf hne => absurd (List.mem_singleton.1 hf) hne⟩
  | y :: S, x, hk => by
    have hxy := hk x (List.mem_cons_self ..) y (List.mem_cons_of_mem x (List.mem_cons_self ..))
    rw [List.foldl_cons]
    by_cases hb : better y x = true
    · have hyx := better_eq_true.1 hb
      obtain ⟨e, he, hl⟩ := foldl_pick_least (S := S) (x := y)
        fun a ha b hb' => hk a (List.mem_cons_of_mem x ha) b (List.mem_cons_of_mem x hb')
      refine ⟨e, by simpa [pick, replaces, hb] using he, least_cons hl fun _ => ?_⟩
      exact least_lt ord hl (List.mem_cons_self ..) hyx
    · have hsub : ∀ a ∈ x :: S, a ∈ x :: y :: S := by simp +contextual
      obtain ⟨e, he, hl⟩ := foldl_pick_least (S := S) (x := x)
        fun a ha b hb' => hk a (hsub a ha) b (hsub b hb')
      refine ⟨e, by simpa [pick, replaces, hb] using he, least_congr (S := y :: x :: S) ?_ (least_cons hl ?_)⟩
      · intro f; simp only [List.mem_cons]; exact or_left_comm
      · intro hne
        rcases hxy with rfl | hlt | hlt
        · exact hl.2 x (List.mem_cons_self ..) hne
        · exact least_lt ord hl (List.mem_cons_self ..) hlt
        · exact absurd (better_eq_true.2 hlt) hb

/-- Over keyed edges, the new slot ends on the least one, whatever their order. -/
theorem foldl_pick_isLeast {S : List (Edge α β)} (hk : Keyed S) :
    IsLeast S (S.foldl (pick better) none) := by
  cases S with
  | nil => rfl
  | cons y S =>
    obtain ⟨e, he, hl⟩ := foldl_pick_least ord hk
    show IsLeast _ ((S.foldl (pick better) (some y)))
    rw [he]
    exact hl

omit [DecidableEq α] in
/-- Over edges increasing by `keyLt`, the old slot keeps the first, which is the least. -/
theorem foldl_pickOld_isLeast :
    ∀ {S : List (Edge α β)}, S.Pairwise keyLt → IsLeast S (S.foldl (pick betterOld) none)
  | [], _ => rfl
  | x :: xs, h => by
    rw [List.pairwise_cons] at h
    have keep : ∀ ys : List (Edge α β), (∀ y ∈ ys, keyLt x y) →
        ys.foldl (pick betterOld) (some x) = some x := by
      intro ys
      induction ys with
      | nil => intro _; rfl
      | cons y ys ih =>
        intro hy
        rw [List.foldl_cons]
        simp only [pick, replaces, betterOld_false ord (hy y (List.mem_cons_self ..))]
        exact ih fun z hz => hy z (List.mem_cons_of_mem y hz)
    show IsLeast _ (xs.foldl (pick betterOld) (some x))
    rw [keep xs h.1]
    refine ⟨List.mem_cons_self .., fun f hf hne => ?_⟩
    rcases List.mem_cons.1 hf with rfl | hf
    · exact absurd rfl hne
    · exact h.1 f hf

/-- The new reduction keeps, for each key, the least competing edge. -/
theorem reduceToSingleEdges_isLeast {L : List (Edge α β)} (huid : UidKey L) (k : α) :
    IsLeast (cands k L) (reduceToSingleEdges L k) := by
  rw [reduceToSingleEdges, reduceWith, foldl_step_at]
  exact foldl_pick_isLeast ord fun e he f hf =>
    keyed_of_uidKey ord huid e (cands_mem.1 he).1 f (cands_mem.1 hf).1

/-- The old reduction on sorted input keeps, for each key, the least competing edge. -/
theorem reduceOld_isLeast {S : List (Edge α β)} (hsorted : S.Pairwise sortLt) (k : α) :
    IsLeast (cands k S) (reduceOld S k) := by
  rw [reduceOld, reduceWith, foldl_step_at]
  refine foldl_pickOld_isLeast ord ((hsorted.filter _).imp_of_mem fun ha hb hab => ?_)
  have hsrc : _ = _ := (cands_mem.1 ha).2.1.trans (cands_mem.1 hb).2.1.symm
  rcases hab with h | ⟨_, h⟩
  · exact absurd (hsrc ▸ h) (ord.irrefl _)
  · exact h

/-- Headline: for edges whose `variantUid`s are distinct, `reduceToSingleEdges` keeps for every
key the least edge by `(to, variantUid)` among the non-self edges from that key; any list with the
same elements gives the same map; and the old reduction over the sorted list gives that map too. -/
theorem reduceToSingleEdges_eq {L L' S : List (Edge α β)} (huid : UidKey L)
    (hsame : ∀ e, e ∈ L' ↔ e ∈ L) (hperm : S.Perm L) (hsorted : S.Pairwise sortLt) :
    (∀ k, IsLeast (cands k L) (reduceToSingleEdges L k)) ∧
      reduceToSingleEdges L' = reduceToSingleEdges L ∧
      reduceOld S = reduceToSingleEdges L := by
  have hc : ∀ {T : List (Edge α β)}, (∀ e, e ∈ T ↔ e ∈ L) → ∀ k f, f ∈ cands k T ↔ f ∈ cands k L :=
    fun hT k f => by simp only [cands_mem, hT f]
  have huid' : UidKey L' := fun e he f hf => huid e ((hsame e).1 he) f ((hsame f).1 hf)
  refine ⟨reduceToSingleEdges_isLeast ord huid, funext fun k => ?_, funext fun k => ?_⟩
  · exact isLeast_unique ord (isLeast_congr (hc hsame k) (reduceToSingleEdges_isLeast ord huid' k))
      (reduceToSingleEdges_isLeast ord huid k)
  · exact isLeast_unique ord
      (isLeast_congr (hc (fun e => hperm.mem_iff) k) (reduceOld_isLeast ord hsorted k))
      (reduceToSingleEdges_isLeast ord huid k)

end

end

#print axioms foldl_step_at
#print axioms foldl_pick_isLeast
#print axioms reduceToSingleEdges_eq
