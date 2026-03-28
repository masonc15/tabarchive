# Inline tab deletion and keyboard navigation

Two improvements to the popup's tab list: a subtle delete button on each item
for pruning tabs while browsing, and keyboard navigation for faster list
traversal and actions.

## Feature 1: Inline tab deletion

### Summary

Each tab row gets a small "X" button so users can delete archived tabs
one-at-a-time as they browse. The goal is low-friction cleanup without leaving
the list view.

### Existing plumbing

The `useNativeMessaging` hook already exposes `deleteTab(id: number)` which
sends `{ action: "delete", id }` to the native host. The native host handles
this with a `DELETE FROM tabs WHERE id = ?`. None of this code needs to change.

### UI changes

Add a delete button to `TabItem`, positioned to the left of the existing
restore button. The two buttons sit side-by-side at the right edge of each row.

**Delete button appearance:**
- Same size and border-radius as the restore button (padding 8px, border-radius 6px)
- Background: transparent by default, `#3b3b5c` on hover
- Icon: a small X (stroke-based SVG, 14px, `#71717a` color to keep it subtle)
- Hover state: icon color brightens to `#a1a1aa`

The button is visually recessive compared to the restore button. Restore has a
solid background (`#3b3b5c`); delete has a transparent background until hovered.

**Delete button behavior:**
- `onClick` calls `e.stopPropagation()` then `onDelete(tab)`
- While the delete request is in-flight, show the same mini spinner used by the
  restore button
- No confirmation dialog. The action is lightweight and final.

### Data flow

`popup.tsx` wires `deleteTab` from the hook into a `handleDelete` callback:

```
const handleDelete = useCallback(async (tab: ArchivedTab) => {
  setActionError(null);
  try {
    await deleteTab(tab.id);
    setTabs(prev => prev.filter(t => t.id !== tab.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed';
    setActionError(message);
  }
}, [deleteTab]);
```

This callback is passed through `TabList` to each `TabItem` as `onDelete`.

### Component interface changes

**TabItem** gains:
- `onDelete: (tab: ArchivedTab) => Promise<void> | void` prop
- Internal `deleting` state (mirrors existing `restoring` state)

**TabList** gains:
- `onDelete: (tab: ArchivedTab) => Promise<void> | void` prop (passed through
  to TabItem via `ItemData`)

### Prop threading

```
popup.tsx (handleDelete)
  -> TabList (onDelete prop)
    -> Row (via itemData)
      -> TabItem (onDelete prop)
```

Same pattern already used for `onRestore`.

## Feature 2: Keyboard navigation

### Summary

Arrow keys navigate the tab list. Enter restores, Delete/Backspace deletes.
Escape returns focus to the search bar.

### Keyboard bindings

| Key              | Action                                    |
|------------------|-------------------------------------------|
| Down arrow       | Move focus to next item                   |
| Up arrow         | Move focus to previous item               |
| Enter            | Restore focused tab                       |
| Delete/Backspace | Delete focused tab                        |
| Escape           | Return focus to search bar, clear focus   |

### Focus model

A `focusedIndex` state lives in `TabList`. This is a logical index into the
`tabs` array, not DOM focus. The focused row gets a visible highlight style
(background `#2d2d44`).

This approach avoids fighting `react-window`'s virtualization, which
mounts/unmounts row DOM nodes as they scroll in and out of view. Tracking focus
as an index in the parent means focus survives row recycling.

Individual `TabItem` rows keep their existing `tabIndex={0}` and
`role="button"` for mouse and screen-reader users. The keyboard navigation
system is additive.

### Focus transitions

- Popup opens: focus is in the search bar (unchanged)
- Down arrow from search bar: focus moves to first list item (index 0)
- Down arrow at last item: no-op (stay on last item)
- Up arrow at first item: return focus to search bar
- Delete/restore removes a tab: focus moves to the next item at the same index
  (or previous item if the deleted tab was the last in the list)
- New search results: reset `focusedIndex` to null (no item focused)

### Scroll tracking

When `focusedIndex` changes, call `listRef.current.scrollToItem(focusedIndex)`
on the `react-window` List ref to keep the focused item in the viewport.

### Implementation in TabList

TabList gains:
- `focusedIndex` state (number | null, starts null)
- A `ref` on the `react-window` List for `scrollToItem`
- A `keydown` handler on the list container div
- `onDelete` prop (from Feature 1) used by the Delete/Backspace binding
- Pass `focusedIndex` through `itemData` so `Row` can apply a highlight style

### Implementation in TabItem

TabItem gains:
- `focused: boolean` prop
- When `focused` is true, apply background `#2d2d44` to the container

### Search bar integration

The search bar needs to forward Down arrow presses to the list. Two options:

**Option chosen:** `SearchBar` accepts an `onDownArrow` callback prop.
When the search input receives a Down arrow keypress, it calls
`onDownArrow()`. In `popup.tsx`, this callback calls a `focusList` function
exposed by `TabList` via a ref (or a simple prop). `TabList` responds by
setting `focusedIndex` to 0 and moving DOM focus to the list container div.

### Scope boundary

Keyboard navigation covers the tab list only. No shortcuts for switching
Search/Settings views, toggling pause, or any header controls.

## Files changed

| File | Change |
|------|--------|
| `extension/popup/components/TabItem.tsx` | Add delete button, `onDelete` prop, `focused` prop with highlight style |
| `extension/popup/components/TabList.tsx` | Add `focusedIndex` state, keyboard handler, pass `onDelete`/`focused` through itemData |
| `extension/popup/popup.tsx` | Wire `deleteTab` into `handleDelete`, pass to TabList. Add search bar Down arrow forwarding. |
| `extension/popup/components/SearchBar.tsx` | Accept `onDownArrow` callback prop, fire on Down key |
| `extension/tests/TabItem.test.tsx` | Test delete button rendering, click, spinner, stopPropagation |
| `extension/tests/TabList.test.tsx` | Test keyboard nav (arrow keys, Enter, Delete, Escape) |
| `extension/tests/popup.test.tsx` | Test delete flow end-to-end, integration with keyboard nav |
| `extension/tests/SearchBar.test.tsx` | Test Down arrow callback |
