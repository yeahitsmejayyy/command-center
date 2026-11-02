# 004 — The reserved prop that broke every drag

*2026-08-19*

The board rendered. Columns, counts, cards, the empty-state copy, the lift-and-tilt styling for a held card — all of it correct on screen. Then I tried to move a task from Todo to In Progress and nothing happened. No error, no warning, no console output. The card sat there. The cursor dragged across it the way a cursor drags across a paragraph of text.

A thing that looks finished and does nothing is the worst shape a bug can take, because every instinct says the problem is somewhere other than the code.

## What I decided it was

I decided it was the harness.

Drag and drop is a gesture, and I was trying to perform it through automation — synthetic pointer events, a driver, coordinates. That is genuinely a fiddly thing to get right. `PointerSensor` is configured with `activationConstraint: { distance: 8 }`, so a drag only begins after eight pixels of travel; a synthetic pointerdown followed immediately by pointerup never crosses that threshold. There was a real, plausible, documented reason for the thing I was seeing, and I had found it in about four minutes.

So I explained it. I wrote that drag could not be verified by automation and would need a human hand on a real mouse, and I moved on to the next item.

That explanation was wrong, and worse than wrong, it was *load-bearing* — it gave me permission to stop looking. The eight-pixel constraint was real. It just wasn't what was happening. A drag performed by an actual hand on an actual trackpad, travelling far more than eight pixels, also did nothing.

## What it actually was

`useSortable` returns `setNodeRef`, a callback dnd-kit uses to get a handle on the DOM node for the card. Without that node it has nothing to measure: no rect, no position, no way to know what the pointer is over. The card is registered as draggable in the abstract and attached to nothing.

`Card` passes that callback down to a shared `CardBody` component, because the same markup is used twice — once for the card sitting in a column and once for the copy that follows the cursor while you drag. And I had named the prop the obvious thing:

```tsx
<CardBody ref={setNodeRef} ... />
```

React 18 treats `ref` as reserved. On a function component it is pulled out of the props object and handled by React itself before the component is ever called, so `CardBody` received no `ref`, passed no `ref` to its `<article>`, and `setNodeRef` was never invoked with anything. Not once. dnd-kit's own `useDroppable` ref in `Column.tsx` went straight onto a `<div>` in the same file and worked perfectly, which is why the columns behaved and the cards did not — the only broken ref was the one that had to cross a component boundary to reach its element.

React says nothing about this. It is not a mistake, as far as React is concerned; `ref` means something specific and that meaning was honoured. The prop was consumed exactly as designed, by a design I had forgotten about.

The fix is a rename, and the prop is called `nodeRef` now, with a comment on the interface saying why so that nobody helpfully tidies it back:

> Deliberately not called `ref`.

Four characters of bug. Two hours of it.

## The part worth writing down

The code mistake is a trivia question. The reasoning mistake is the entry.

I had direct evidence that the feature did not work — I could not make it work — and I converted that evidence into a statement about my *tools*. "This can't be driven from here" is a much more comfortable conclusion than "this is broken," and it comes with a ready-made next step: write the caveat, move on, let someone verify it by hand later. That caveat would have shipped. The milestone would have closed with drag and drop listed as done and untestable, and the first person to open the board would have found a kanban that ignores the mouse.

What made it comfortable is that the explanation was *technically accurate*. The activation constraint does exist. Synthetic events do fail against it. I wasn't inventing a story; I was picking a true fact and letting it stand in for a cause I hadn't looked for. That is harder to catch than a guess, because it survives the first round of checking — I confirmed the constraint was there, and treated the confirmation as a diagnosis.

The rule I'd write for myself from this: **not being able to drive something is a symptom, not an environment note.** If I can't operate the feature, the default assumption is that the feature doesn't work, and the burden is on me to prove the harness guilty rather than to accept its confession. A harness problem looks like a harness problem *everywhere* — if automation can lift a card but not drop it, that's the driver. If nothing happens at all, in automation and by hand alike, that's the product.

And the second rule, smaller: anything named for what it *is* in the framework's vocabulary — `ref`, `key`, `children` — is not available to mean what I want it to mean. I knew that. Knowing it and noticing it in the moment I typed it are different skills.

## What holds it now

Not a test, honestly. There is no clean unit-level assertion that a callback ref reached a DOM node without standing up a renderer and a pointer, and the place this would have been caught is a level above unit tests.

What holds it is that the gesture is now part of what "done" means for this milestone: the board is driven, card by card, across every column transition, before the item closes. `planDrop` has real tests covering where a card lands — up versus down, empty column, cross-column — and those passed throughout. They were testing the arithmetic of a drag that could not begin. Green tests over a dead feature, which is its own small lesson about what a passing suite is evidence of.

Next: the drop preview, and making the board agree with itself about where a card is going to land.
